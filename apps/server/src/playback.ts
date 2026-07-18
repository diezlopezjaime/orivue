import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  createDefaultResolverRegistry,
  type StreamResolverRegistry,
} from '@orivue/stream-resolvers';
import type { FastifyReply } from 'fastify';
import { publicError } from './redact.js';
import { assertSafeRemoteUrl, limitedFetch, readLimitedText } from './security.js';
import type { ChannelRecord, PlaybackSession } from './types.js';

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'accept-ranges',
  'content-range',
  'cache-control',
] as const;
const FORWARDED_REQUEST_HEADERS = ['range', 'user-agent'] as const;

export class PlaybackManager {
  private readonly sessions = new Map<string, PlaybackSession>();
  private activeId: string | null = null;
  private readonly resolvers: StreamResolverRegistry;

  constructor(
    private readonly options: {
      allowPrivateNetwork: boolean;
      aceEndpoint: string;
      aceResolvePath: string;
      aceStopPath?: string;
    },
  ) {
    this.resolvers = createDefaultResolverRegistry({
      aceStream: {
        endpoint: options.aceEndpoint,
        resolvePath: (contentId) =>
          options.aceResolvePath.replace('{id}', encodeURIComponent(contentId)),
        ...(options.aceStopPath
          ? {
              stopPath: (sessionId) =>
                options.aceStopPath!.replace('{id}', encodeURIComponent(sessionId)),
            }
          : {}),
      },
    });
  }

  async create(channel: ChannelRecord): Promise<PlaybackSession> {
    if (this.activeId) await this.stop(this.activeId);
    const id = `play_${randomUUID()}`;
    const abortController = new AbortController();
    const resolved = await this.resolvers.resolve(
      {
        id: channel.id,
        name: channel.name,
        url: channel.streamUrl,
        ...(Object.keys(channel.headers).length ? { headers: channel.headers } : {}),
      },
      abortController.signal,
    );
    const playableUrl = resolved.url;
    const resolver = /^acestream:/i.test(channel.streamUrl) ? 'acestream' : resolved.kind;
    const stop = async () => this.resolvers.stop(resolved.sessionId);
    const origin = new URL(playableUrl).origin;
    const session: PlaybackSession = {
      id,
      channelId: channel.id,
      sourceUrl: channel.streamUrl,
      playableUrl,
      allowedOrigins: [origin],
      resolver,
      state: 'connecting',
      createdAt: new Date().toISOString(),
      abortController,
      stop,
    };
    this.sessions.set(id, session);
    this.activeId = id;
    return session;
  }

  get(id: string): PlaybackSession | undefined {
    return this.sessions.get(id);
  }

  async stop(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.abortController.abort();
    session.state = 'stopped';
    if (session.stop) await session.stop();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = null;
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }

  status(): { activeSessionId: string | null; sessionCount: number } {
    return { activeSessionId: this.activeId, sessionCount: this.sessions.size };
  }

  async proxy(
    session: PlaybackSession,
    rawUrl: string,
    requestHeaders: Record<string, string | undefined>,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const allowPrivate = this.options.allowPrivateNetwork || session.resolver === 'acestream';
    await assertSafeRemoteUrl(rawUrl, {
      allowPrivateNetwork: allowPrivate,
      expectedOrigins: session.allowedOrigins,
    });
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = requestHeaders[name];
      if (value) headers[name] = value;
    }
    const response = await limitedFetch(rawUrl, {
      allowPrivateNetwork: allowPrivate,
      expectedOrigins: session.allowedOrigins,
      headers,
      signal: session.abortController.signal,
      timeoutMs: 20_000,
      maxRedirects: 2,
    });
    if (!response.ok)
      return reply.code(response.status).send({ error: `Stream returned HTTP ${response.status}` });
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) reply.header(name, value);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(rawUrl)) {
      const manifest = await readLimitedText(response, 2 * 1024 * 1024);
      const base = new URL(rawUrl);
      const rewritten = manifest
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#'))
            return line.replace(
              /URI="([^"]+)"/g,
              (_match: string, uri: string) =>
                `URI="${this.proxyUrl(session.id, new URL(uri, base).toString())}"`,
            );
          return this.proxyUrl(session.id, new URL(trimmed, base).toString());
        })
        .join('\n');
      session.state = 'playing';
      return reply.header('content-type', 'application/vnd.apple.mpegurl').send(rewritten);
    }
    if (!response.body) return reply.code(502).send({ error: 'Stream returned no body' });
    session.state = 'playing';
    return reply.send(Readable.fromWeb(response.body as never));
  }

  private proxyUrl(sessionId: string, url: string): string {
    return `/api/playback/sessions/${encodeURIComponent(sessionId)}/proxy?url=${encodeURIComponent(url)}`;
  }
}

export function playbackError(error: unknown): string {
  return publicError(error);
}
