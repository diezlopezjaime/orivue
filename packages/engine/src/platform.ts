/**
 * Everything the engine needs from its host. The browser implementation is
 * enough for development and automated tests; Tauri provides a Rust-backed
 * implementation with SSRF protection and no CORS restrictions.
 */

export interface FetchTextOptions {
  readonly maxBytes?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly allowPrivateNetwork?: boolean | undefined;
}

/** Window of programmes to keep when a guide is read incrementally by the host. */
export interface FetchGuideOptions {
  readonly sinceMs: number;
  readonly untilMs: number;
  readonly timeoutMs?: number | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly allowPrivateNetwork?: boolean | undefined;
}

/** `[channel id, start ms, stop ms, title, description, category]`. */
export type GuideProgrammeRow = readonly [
  string,
  number,
  number,
  string,
  string | null,
  string | null,
];

export interface FetchedGuide {
  /** `[channel id, first display name]`. */
  readonly channels: ReadonlyArray<readonly [string, string]>;
  readonly programmes: readonly GuideProgrammeRow[];
  readonly skipped: number;
  readonly warnings: readonly string[];
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface EnginePlatform {
  readonly name: 'browser' | 'tauri';
  readonly kv: KeyValueStore;
  fetchText(url: string, options?: FetchTextOptions): Promise<string>;
  /**
   * Streams an XMLTV guide outside the webview and returns only the
   * programmes inside the window. Hosts without it fall back to
   * `fetchText` plus the in-process parser, bounded by `maxEpgBytes`.
   */
  fetchGuide?(url: string, options: FetchGuideOptions): Promise<FetchedGuide>;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function memoryKeyValueStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

export function webStorageKeyValueStore(storage: Storage, prefix = 'orivue:'): KeyValueStore {
  return {
    get: <T>(key: string) => {
      try {
        const raw = storage.getItem(prefix + key);
        return Promise.resolve(raw === null ? undefined : (JSON.parse(raw) as T));
      } catch {
        return Promise.resolve(undefined);
      }
    },
    set: (key, value) => {
      storage.setItem(prefix + key, JSON.stringify(value));
      return Promise.resolve();
    },
    delete: (key) => {
      storage.removeItem(prefix + key);
      return Promise.resolve();
    },
  };
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok)
    throw new FetchError(`Source returned HTTP ${response.status}`, response.status);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new FetchError('Source exceeds the configured size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new FetchError('Source exceeds the configured size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Plain-browser platform: subject to CORS, so it mostly works with sources
 * that send permissive headers or through the Vite development proxy.
 */
export function browserPlatform(options: { kv?: KeyValueStore; proxyPrefix?: string } = {}) {
  const kv =
    options.kv ??
    (typeof localStorage === 'undefined'
      ? memoryKeyValueStore()
      : webStorageKeyValueStore(localStorage));
  const platform: EnginePlatform = {
    name: 'browser',
    kv,
    async fetchText(url, fetchOptions = {}) {
      const target = options.proxyPrefix ? `${options.proxyPrefix}${encodeURIComponent(url)}` : url;
      const timeout = AbortSignal.timeout(fetchOptions.timeoutMs ?? 30_000);
      const signal = fetchOptions.signal
        ? AbortSignal.any([timeout, fetchOptions.signal])
        : timeout;
      let response: Response;
      try {
        response = await fetch(target, {
          signal,
          ...(fetchOptions.headers ? { headers: fetchOptions.headers } : {}),
        });
      } catch (error) {
        throw new FetchError(
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The source took too long to respond'
            : 'The source could not be reached',
        );
      }
      return readLimitedText(response, fetchOptions.maxBytes ?? 50 * 1024 * 1024);
    },
  };
  return platform;
}
