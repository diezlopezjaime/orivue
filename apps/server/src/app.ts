import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrivueDatabase } from './database.js';
import { newId, refreshEpg, refreshPlaylist } from './importer.js';
import { PlaybackManager, playbackError } from './playback.js';
import { publicError, sanitizeUrl } from './redact.js';
import { assertLocalRequest, isAllowedOrigin } from './security.js';

const booleanQuery = z
  .preprocess((value) => value === 'true' || value === true, z.boolean())
  .optional();
const channelQuery = z.object({
  playlistId: z.string().optional(),
  groupId: z.string().optional(),
  search: z.string().max(200).optional(),
  favorite: booleanQuery,
  recent: booleanQuery,
  includeHidden: booleanQuery,
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export interface AppOptions {
  dbPath?: string;
  apiToken?: string;
  allowPrivateNetwork?: boolean;
  logger?: boolean;
  aceEndpoint?: string;
  aceResolvePath?: string;
  aceStopPath?: string;
}

function publicPlaylist<T extends { url: string | null; epgUrl: string | null }>(
  playlist: T,
): Omit<T, 'url' | 'epgUrl'> & { url: string | null; epgUrl: string | null } {
  return { ...playlist, url: sanitizeUrl(playlist.url), epgUrl: sanitizeUrl(playlist.epgUrl) };
}

function publicChannel(channel: ReturnType<OrivueDatabase['getChannel']>) {
  if (!channel) return null;
  const safe: Partial<typeof channel> = { ...channel };
  delete safe.streamUrl;
  delete safe.headers;
  return safe as Omit<typeof channel, 'streamUrl' | 'headers'>;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const dbPath =
    options.dbPath ??
    process.env.ORIVUE_DB_PATH ??
    join(process.env.ORIVUE_DATA_DIR ?? join(homedir(), '.orivue'), 'orivue.db');
  const db = new OrivueDatabase(dbPath);
  const allowPrivateNetwork =
    options.allowPrivateNetwork ?? process.env.ORIVUE_ALLOW_PRIVATE_NETWORK === '1';
  const aceStopPath = options.aceStopPath ?? process.env.ORIVUE_ACESTREAM_STOP_PATH;
  const playback = new PlaybackManager({
    allowPrivateNetwork,
    aceEndpoint:
      options.aceEndpoint ?? process.env.ORIVUE_ACESTREAM_ENDPOINT ?? 'http://127.0.0.1:6878',
    aceResolvePath:
      options.aceResolvePath ??
      process.env.ORIVUE_ACESTREAM_RESOLVE_PATH ??
      '/ace/getstream?id={id}',
    ...(aceStopPath ? { aceStopPath } : {}),
  });
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024 * 1024,
    requestTimeout: 30_000,
    disableRequestLogging: true,
    genReqId: () => randomBytes(12).toString('hex'),
  });
  app.decorate('orivueDb', db);
  app.addHook('onRequest', async (request, reply) => {
    try {
      assertLocalRequest(
        request,
        request.method === 'OPTIONS'
          ? undefined
          : (options.apiToken ?? process.env.ORIVUE_LOCAL_TOKEN),
      );
      const origin = request.headers.origin;
      if (origin && isAllowedOrigin(origin))
        reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      if (request.method === 'OPTIONS')
        await reply
          .header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
          .header('access-control-allow-headers', 'content-type, x-orivue-token')
          .header('access-control-max-age', '600')
          .code(204)
          .send();
    } catch (error) {
      await reply.code(403).send({ error: publicError(error) });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store');
    return payload;
  });
  app.addHook('onClose', async () => {
    await playback.stopAll();
    db.close();
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    playback: playback.status(),
  }));
  app.get('/api/playlists', async () => ({ items: db.listPlaylists().map(publicPlaylist) }));
  app.post('/api/playlists', async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120),
        url: z.string().url().optional(),
        content: z
          .string()
          .max(30 * 1024 * 1024)
          .optional(),
        epgUrl: z.string().url().optional(),
        autoRefreshMinutes: z.number().int().min(0).max(10080).optional(),
      })
      .refine((v) => Boolean(v.url || v.content), 'A URL or content is required')
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const id = newId('pl');
    db.createPlaylist({ id, ...parsed.data });
    try {
      const result = await refreshPlaylist(db, id, { allowPrivateNetwork });
      return reply.code(201).send({ playlist: publicPlaylist(db.getPlaylist(id)!), ...result });
    } catch (error) {
      return reply
        .code(422)
        .send({ error: publicError(error), playlist: publicPlaylist(db.getPlaylist(id)!) });
    }
  });
  app.patch('/api/playlists/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        url: z.string().url().nullable().optional(),
        epgUrl: z.string().url().nullable().optional(),
        autoRefreshMinutes: z.number().int().min(0).max(10080).optional(),
      })
      .parse(request.body);
    if (!db.updatePlaylist(params.id, body))
      return reply.code(404).send({ error: 'Playlist not found' });
    return { playlist: publicPlaylist(db.getPlaylist(params.id)!) };
  });
  app.delete('/api/playlists/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!db.deletePlaylist(id)) return reply.code(404).send({ error: 'Playlist not found' });
    return reply.code(204).send();
  });
  app.post('/api/playlists/:id/refresh', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      return await refreshPlaylist(db, id, { allowPrivateNetwork });
    } catch (error) {
      return reply.code(422).send({ error: publicError(error) });
    }
  });
  app.post('/api/playlists/:id/epg/refresh', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const playlist = db.getPlaylist(id);
    if (!playlist?.epgUrl) return reply.code(404).send({ error: 'EPG source not configured' });
    try {
      return await refreshEpg(db, id, playlist.epgUrl, { allowPrivateNetwork });
    } catch (error) {
      return reply.code(422).send({ error: publicError(error) });
    }
  });

  app.get('/api/groups', async (request) => {
    const { playlistId } = z.object({ playlistId: z.string().optional() }).parse(request.query);
    return { items: db.listGroups(playlistId) };
  });
  app.patch('/api/groups/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { hidden } = z.object({ hidden: z.boolean() }).parse(request.body);
    if (!db.setGroupHidden(id, hidden)) return reply.code(404).send({ error: 'Group not found' });
    return { ok: true };
  });
  app.get('/api/channels', async (request) => {
    const result = db.listChannels(channelQuery.parse(request.query));
    return { ...result, items: result.items.map(publicChannel) };
  });
  app.get('/api/channels/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const channel = publicChannel(db.getChannel(id));
    return channel ? { channel } : reply.code(404).send({ error: 'Channel not found' });
  });
  app.patch('/api/channels/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        hidden: z.boolean().optional(),
        name: z.string().trim().min(1).max(160).nullable().optional(),
        groupId: z.string().nullable().optional(),
      })
      .parse(request.body);
    if (!db.updateChannel(id, body)) return reply.code(404).send({ error: 'Channel not found' });
    return { channel: publicChannel(db.getChannel(id)) };
  });
  app.get('/api/favorites', async () => {
    const result = db.listChannels({ favorite: true, limit: 500 });
    return { ...result, items: result.items.map(publicChannel) };
  });
  app.post('/api/favorites/:channelId', async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string() }).parse(request.params);
    if (!db.setFavorite(channelId, true))
      return reply.code(404).send({ error: 'Channel not found' });
    return reply.code(201).send({ ok: true });
  });
  app.delete('/api/favorites/:channelId', async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string() }).parse(request.params);
    if (!db.setFavorite(channelId, false))
      return reply.code(404).send({ error: 'Channel not found' });
    return reply.code(204).send();
  });
  app.get('/api/recents', async () => {
    const result = db.listChannels({ recent: true, limit: 100 });
    return { ...result, items: result.items.map(publicChannel) };
  });

  app.get('/api/epg/now', async (request) => {
    const { channelIds } = z.object({ channelIds: z.string().optional() }).parse(request.query);
    return { items: db.epgNow(channelIds?.split(',').slice(0, 500)) };
  });
  app.get('/api/epg/timeline', async (request) => {
    const now = Date.now();
    const q = z
      .object({
        from: z
          .string()
          .datetime()
          .default(new Date(now - 3_600_000).toISOString()),
        to: z
          .string()
          .datetime()
          .default(new Date(now + 6 * 3_600_000).toISOString()),
        channelIds: z.string().optional(),
      })
      .parse(request.query);
    return { items: db.timeline(q.from, q.to, q.channelIds?.split(',').slice(0, 100)) };
  });
  app.put('/api/epg/mappings/:channelId', async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string() }).parse(request.params);
    const { epgChannelId } = z.object({ epgChannelId: z.string().min(1) }).parse(request.body);
    if (!db.mapEpg(channelId, epgChannelId))
      return reply.code(404).send({ error: 'Channel not found' });
    return { ok: true };
  });

  app.post('/api/playback/sessions', async (request, reply) => {
    const { channelId } = z.object({ channelId: z.string() }).parse(request.body);
    const channel = db.getChannel(channelId);
    if (!channel) return reply.code(404).send({ error: 'Channel not found' });
    try {
      const session = await playback.create(channel);
      db.markRecent(channelId);
      return reply.code(201).send({
        session: {
          id: session.id,
          channelId,
          state: session.state,
          resolver: session.resolver,
          type: session.resolver === 'http' ? 'http' : 'hls',
          streamUrl: `/api/playback/sessions/${session.id}/stream`,
        },
      });
    } catch (error) {
      return reply.code(422).send({ error: playbackError(error) });
    }
  });
  app.get('/api/playback/sessions/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const session = playback.get(id);
    return session
      ? {
          session: {
            id,
            state: session.state,
            channelId: session.channelId,
            resolver: session.resolver,
          },
        }
      : reply.code(404).send({ error: 'Session not found' });
  });
  app.delete('/api/playback/sessions/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (!(await playback.stop(id))) return reply.code(404).send({ error: 'Session not found' });
    return reply.code(204).send();
  });
  app.get('/api/playback/sessions/:id/events', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const session = playback.get(id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    reply
      .header('content-type', 'text/event-stream')
      .send(`event: state\ndata: ${JSON.stringify({ state: session.state })}\n\n`);
  });
  app.get('/api/playback/sessions/:id/stream', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const session = playback.get(id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    return playback.proxy(
      session,
      session.playableUrl,
      request.headers as Record<string, string | undefined>,
      reply,
    );
  });
  app.get('/api/playback/sessions/:id/proxy', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { url } = z.object({ url: z.string().url() }).parse(request.query);
    const session = playback.get(id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    try {
      return await playback.proxy(
        session,
        url,
        request.headers as Record<string, string | undefined>,
        reply,
      );
    } catch (error) {
      if (!reply.sent) return reply.code(502).send({ error: playbackError(error) });
      return reply;
    }
  });
  app.get('/api/integrations/acestream/status', async () => {
    const endpoint =
      options.aceEndpoint ?? process.env.ORIVUE_ACESTREAM_ENDPOINT ?? 'http://127.0.0.1:6878';
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(1500),
        redirect: 'error',
      });
      return {
        configured: true,
        available: response.status < 500,
        endpoint: sanitizeUrl(endpoint),
      };
    } catch {
      return { configured: true, available: false, endpoint: sanitizeUrl(endpoint) };
    }
  });
  app.get('/api/diagnostics', async () => ({
    version: '0.1.0',
    runtime: process.version,
    platform: process.platform,
    database: 'available',
    playlistCount: db.listPlaylists().length,
    playback: playback.status(),
    privateNetworkSourcesAllowed: allowPrivateNetwork,
    telemetry: false,
  }));

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: 'Invalid request',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    return reply.code(500).send({ error: publicError(error) });
  });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    orivueDb: OrivueDatabase;
  }
}
