import type { Channel, PlayableStream, StreamResolver } from '@orivue/core';

export type StreamResolverErrorCode =
  | 'unsupported-stream'
  | 'acestream-unavailable'
  | 'acestream-timeout'
  | 'acestream-invalid-response'
  | 'acestream-stop-failed';

export class StreamResolverError extends Error {
  readonly code: StreamResolverErrorCode;

  constructor(code: StreamResolverErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StreamResolverError';
    this.code = code;
  }
}

abstract class BaseUrlResolver implements StreamResolver {
  readonly #sessions = new Set<string>();

  abstract supports(channel: Channel): boolean;
  protected abstract kind(): PlayableStream['kind'];

  resolve(channel: Channel, signal?: AbortSignal): Promise<PlayableStream> {
    signal?.throwIfAborted();
    if (!this.supports(channel))
      throw new StreamResolverError(
        'unsupported-stream',
        'This resolver does not support the selected stream.',
      );
    const sessionId = createSessionId(this.kind());
    this.#sessions.add(sessionId);
    return Promise.resolve({
      sessionId,
      url: channel.url,
      kind: this.kind(),
      ...(channel.headers ? { headers: channel.headers } : {}),
    });
  }

  stop(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    return Promise.resolve();
  }
}

export class HlsResolver extends BaseUrlResolver {
  supports(channel: Channel): boolean {
    try {
      const url = new URL(channel.url);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') && /\.m3u8$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  protected kind(): 'hls' {
    return 'hls';
  }
}

export class HttpResolver extends BaseUrlResolver {
  readonly #hls = new HlsResolver();

  supports(channel: Channel): boolean {
    try {
      const protocol = new URL(channel.url).protocol;
      return (protocol === 'http:' || protocol === 'https:') && !this.#hls.supports(channel);
    } catch {
      return false;
    }
  }

  protected kind(): 'http' {
    return 'http';
  }
}

export interface AceStreamResolverConfig {
  /** Local Ace Stream-compatible engine endpoint. Remote hosts are rejected by default. */
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly healthPath?: string | false;
  readonly resolvePath?: (contentId: string) => string;
  readonly resolveMode?: 'url' | 'json';
  readonly stopPath?: (sessionId: string) => string;
  readonly requestTimeoutMs?: number;
  readonly allowRemoteEndpoint?: boolean;
  readonly allowRemotePlaybackUrl?: boolean;
  readonly checkAvailability?: boolean;
}

interface ActiveAceSession {
  readonly controller: AbortController;
  readonly engineSessionId?: string;
}

export class AceStreamResolver implements StreamResolver {
  readonly #endpoint: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #healthPath: string | false;
  readonly #resolvePath: (contentId: string) => string;
  readonly #resolveMode: 'url' | 'json';
  readonly #stopPath: ((sessionId: string) => string) | undefined;
  readonly #requestTimeoutMs: number;
  readonly #allowRemotePlaybackUrl: boolean;
  readonly #checkAvailability: boolean;
  readonly #sessions = new Map<string, ActiveAceSession>();

  constructor(config: AceStreamResolverConfig = {}) {
    this.#endpoint = parseEngineEndpoint(
      config.endpoint ?? 'http://127.0.0.1:6878',
      config.allowRemoteEndpoint ?? false,
    );
    this.#fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.#healthPath = config.healthPath ?? '/webui/api/service?method=get_version';
    this.#resolvePath =
      config.resolvePath ?? ((contentId) => `/ace/getstream?id=${encodeURIComponent(contentId)}`);
    this.#resolveMode = config.resolveMode ?? 'url';
    this.#stopPath = config.stopPath;
    this.#requestTimeoutMs = config.requestTimeoutMs ?? 3_000;
    this.#allowRemotePlaybackUrl = config.allowRemotePlaybackUrl ?? false;
    this.#checkAvailability = config.checkAvailability ?? true;
  }

  supports(channel: Channel): boolean {
    return extractAceContentId(channel.url) !== undefined;
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    if (this.#healthPath === false) return true;
    try {
      const response = await this.#request(this.#healthPath, { method: 'GET' }, signal);
      return response.ok;
    } catch {
      return false;
    }
  }

  async resolve(channel: Channel, signal?: AbortSignal): Promise<PlayableStream> {
    signal?.throwIfAborted();
    const contentId = extractAceContentId(channel.url);
    if (!contentId)
      throw new StreamResolverError(
        'unsupported-stream',
        'This resolver does not support the selected stream.',
      );
    const sessionId = createSessionId('ace');
    const controller = new AbortController();
    this.#sessions.set(sessionId, { controller });
    try {
      if (
        this.#checkAvailability &&
        !(await this.isAvailable(combineSignals(signal, controller.signal)))
      ) {
        throw new StreamResolverError(
          'acestream-unavailable',
          'The optional Ace Stream engine is not available on the configured local endpoint.',
        );
      }
      const path = this.#resolvePath(contentId);
      let playbackUrl: URL;
      if (this.#resolveMode === 'json') {
        const response = await this.#request(
          path,
          { method: 'GET' },
          combineSignals(signal, controller.signal),
        );
        if (!response.ok)
          throw new StreamResolverError(
            'acestream-invalid-response',
            'The Ace Stream engine could not resolve this content.',
          );
        const body: unknown = await response.json().catch(() => undefined);
        const resolved = parsePlaybackResponse(body);
        playbackUrl = resolved.url;
        if (resolved.engineSessionId)
          this.#sessions.set(sessionId, { controller, engineSessionId: resolved.engineSessionId });
      } else {
        playbackUrl = new URL(path, this.#endpoint);
      }
      if (!this.#allowRemotePlaybackUrl && playbackUrl.origin !== this.#endpoint.origin) {
        throw new StreamResolverError(
          'acestream-invalid-response',
          'The Ace Stream engine returned an untrusted playback address.',
        );
      }
      return { sessionId, url: playbackUrl.toString(), kind: 'http' };
    } catch (error) {
      this.#sessions.delete(sessionId);
      if (error instanceof StreamResolverError) throw error;
      if (isAbortError(error)) throw error;
      throw new StreamResolverError(
        'acestream-unavailable',
        'The optional Ace Stream engine could not be contacted.',
      );
    }
  }

  async stop(sessionId: string): Promise<void> {
    const active = this.#sessions.get(sessionId);
    if (!active) return;
    active.controller.abort();
    this.#sessions.delete(sessionId);
    if (!this.#stopPath) return;
    try {
      const response = await this.#request(this.#stopPath(active.engineSessionId ?? sessionId), {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('non-success response');
    } catch {
      throw new StreamResolverError(
        'acestream-stop-failed',
        'The Ace Stream session could not be stopped cleanly.',
      );
    }
  }

  async #request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const url = new URL(path, this.#endpoint);
    if (url.origin !== this.#endpoint.origin) {
      throw new StreamResolverError(
        'acestream-invalid-response',
        'An engine request path resolved outside the configured endpoint.',
      );
    }
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#requestTimeoutMs);
    try {
      const requestSignal = combineSignals(signal, timeout.signal);
      return await this.#fetch(url, {
        ...init,
        redirect: 'error',
        ...(requestSignal ? { signal: requestSignal } : {}),
      });
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) {
        throw new StreamResolverError(
          'acestream-timeout',
          'The optional Ace Stream engine did not respond in time.',
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface ResolverRegistryConfig {
  readonly aceStream?: AceStreamResolverConfig | false;
  readonly extraResolvers?: readonly StreamResolver[];
}

export class StreamResolverRegistry implements StreamResolver {
  readonly #resolvers: readonly StreamResolver[];
  readonly #sessions = new Map<string, StreamResolver>();

  constructor(resolvers: readonly StreamResolver[]) {
    this.#resolvers = [...resolvers];
  }

  supports(channel: Channel): boolean {
    return this.#resolvers.some((resolver) => resolver.supports(channel));
  }

  async resolve(channel: Channel, signal?: AbortSignal): Promise<PlayableStream> {
    const resolver = this.#resolvers.find((candidate) => candidate.supports(channel));
    if (!resolver)
      throw new StreamResolverError(
        'unsupported-stream',
        'No resolver supports the selected stream.',
      );
    const stream = await resolver.resolve(channel, signal);
    this.#sessions.set(stream.sessionId, resolver);
    return stream;
  }

  async stop(sessionId: string): Promise<void> {
    const resolver = this.#sessions.get(sessionId);
    if (!resolver) return;
    this.#sessions.delete(sessionId);
    await resolver.stop(sessionId);
  }
}

export function createDefaultResolverRegistry(
  config: ResolverRegistryConfig = {},
): StreamResolverRegistry {
  const resolvers: StreamResolver[] = [...(config.extraResolvers ?? [])];
  if (config.aceStream !== false) resolvers.push(new AceStreamResolver(config.aceStream));
  resolvers.push(new HlsResolver(), new HttpResolver());
  return new StreamResolverRegistry(resolvers);
}

export function extractAceContentId(value: string): string | undefined {
  const direct = /^(?:acestream:\/\/)?([a-f\d]{40})$/i.exec(value.trim());
  if (direct?.[1]) return direct[1].toLowerCase();
  try {
    const url = new URL(value);
    for (const key of ['id', 'content_id', 'infohash']) {
      const candidate = url.searchParams.get(key);
      if (candidate && /^[a-f\d]{40}$/i.test(candidate)) return candidate.toLowerCase();
    }
  } catch {
    // Not a URL or compatible bare content ID.
  }
  return undefined;
}

function parseEngineEndpoint(value: string, allowRemote: boolean): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new TypeError('The Ace Stream endpoint is not a valid URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    throw new TypeError('The Ace Stream endpoint must use HTTP or HTTPS.');
  if (endpoint.username || endpoint.password)
    throw new TypeError('Credentials are not allowed in the Ace Stream endpoint URL.');
  const localHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);
  if (!allowRemote && !localHosts.has(endpoint.hostname.toLowerCase())) {
    throw new TypeError(
      'The Ace Stream endpoint must be local unless remote endpoints are explicitly enabled.',
    );
  }
  endpoint.pathname = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

function parsePlaybackResponse(value: unknown): { url: URL; engineSessionId?: string } {
  if (!value || typeof value !== 'object')
    throw new StreamResolverError(
      'acestream-invalid-response',
      'The Ace Stream engine returned an invalid response.',
    );
  const record = value as Record<string, unknown>;
  const candidate = record.playbackUrl ?? record.playback_url ?? record.url;
  if (typeof candidate !== 'string')
    throw new StreamResolverError(
      'acestream-invalid-response',
      'The Ace Stream engine returned an invalid response.',
    );
  try {
    const engineSessionId = record.sessionId ?? record.session_id;
    return {
      url: new URL(candidate),
      ...(typeof engineSessionId === 'string' && engineSessionId ? { engineSessionId } : {}),
    };
  } catch {
    throw new StreamResolverError(
      'acestream-invalid-response',
      'The Ace Stream engine returned an invalid playback address.',
    );
  }
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

let sessionSequence = 0;
function createSessionId(prefix: string): string {
  sessionSequence = (sessionSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${sessionSequence.toString(36)}`;
}

export type { Channel, PlayableStream, StreamResolver } from '@orivue/core';
