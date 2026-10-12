import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectStreamKind,
  memoryKeyValueStore,
  OrivueEngine,
  refineStreamKind,
  safeText,
  type EnginePlatform,
} from '../src/index.js';

const PANEL = 'http://panel.example:8080';
const NOW = Date.parse('2026-10-10T12:00:00Z');

const PLAYLIST = `#EXTM3U url-tvg="https://guide.test/epg.xml"
#EXTINF:-1 tvg-id="news.es" tvg-logo="https://logos.test/news.png" group-title="Noticias",Noticias 24
https://cdn.test/news/index.m3u8
#EXTINF:-1 tvg-id="movies.es" group-title="Cine",Cine Clásico
https://cdn.test/movies.ts|User-Agent=Orivue%20Test
#EXTINF:-1 group-title="Cine",Cine Infantil
https://cdn.test/kids.mp4
#EXTINF:-1 tvg-id="ace.demo" group-title="P2P",Demo Ace
acestream://0123456789abcdef0123456789abcdef01234567
`;

const XTREAM_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="news.es" tvg-name="Noticias 24" group-title="Noticias",Noticias 24
${PANEL}/live/alice/s3cret/1
#EXTINF:-1 tvg-id="sport.es" group-title="Deportes",Deporte Total
${PANEL}/live/alice/s3cret/2
`;

const LIVE_CATEGORIES = JSON.stringify([
  { category_id: '1', category_name: 'Noticias' },
  { category_id: '2', category_name: 'Deportes' },
]);

const LIVE_STREAMS = JSON.stringify([
  {
    num: 1,
    name: 'Noticias 24',
    stream_type: 'live',
    stream_id: 1,
    stream_icon: 'http://img/news.png',
    epg_channel_id: 'news.es',
    category_id: '1',
  },
  { num: 2, name: 'Deporte Total', stream_id: 2, epg_channel_id: 'sport.es', category_id: '2' },
  { num: 3, name: 'Deporte Total', stream_id: 2, epg_channel_id: 'sport.es', category_id: '2' },
  { num: 4, name: 'Sin id', category_id: '2' },
]);

const EPG = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="News.ES"><display-name>Noticias 24</display-name></channel>
  <channel id="movies.es"><display-name>Cine Clásico</display-name></channel>
  <programme start="20261010110000 +0000" stop="20261010123000 +0000" channel="News.ES"><title>Boletín</title><desc>Noticias de la mañana</desc></programme>
  <programme start="20261010123000 +0000" stop="20261010140000 +0000" channel="News.ES"><title>Debate</title></programme>
  <programme start="20261010100000 +0000" stop="20261010120000 +0000" channel="movies.es"><title>Terminada</title></programme>
  <programme start="20261010120000 +0000" stop="20261010150000 +0000" channel="movies.es"><title>Película</title></programme>
  <programme start="20261020120000 +0000" stop="20261020150000 +0000" channel="movies.es"><title>Fuera de horizonte</title></programme>
</tv>`;

const ACCOUNT = {
  user_info: { status: 'Active', exp_date: '1900000000', max_connections: '1', auth: 1 },
  server_info: { timezone: 'Europe/Madrid' },
};

function fakePlatform(responses: Record<string, string | (() => string)>) {
  const requests: string[] = [];
  const headersSeen: Record<string, string | undefined>[] = [];
  const platform: EnginePlatform = {
    name: 'browser',
    kv: memoryKeyValueStore(),
    fetchText: (url, options) => {
      requests.push(url);
      headersSeen.push({ ...(options?.headers ?? {}) });
      const match = Object.entries(responses)
        .sort((a, b) => b[0].length - a[0].length)
        .find(([prefix]) => url.startsWith(prefix));
      if (!match) return Promise.reject(new Error(`HTTP 404 for ${url}`));
      const body = match[1];
      return Promise.resolve(typeof body === 'function' ? body() : body);
    },
  };
  return { platform, requests, headersSeen };
}

let counter = 0;
async function createEngine(
  responses: Record<string, string | (() => string)>,
  randomId?: () => string,
) {
  const { platform, requests, headersSeen } = fakePlatform(responses);
  counter += 1;
  const engine = new OrivueEngine({
    platform,
    databaseName: `orivue-test-${counter}`,
    now: () => NOW,
    randomId: randomId ?? (() => `id${counter}-${Math.random().toString(36).slice(2, 8)}`),
  });
  await engine.init();
  return { engine, platform, requests, headersSeen };
}

describe('OrivueEngine sources', () => {
  it('imports an M3U URL, derives groups and discovers the EPG URL from the header', async () => {
    const { engine, requests } = await createEngine({
      'https://lists.test/mine.m3u': PLAYLIST,
      'https://guide.test/epg.xml': EPG,
    });
    const source = await engine.addSource({
      kind: 'm3u',
      name: 'Casa',
      url: 'https://lists.test/mine.m3u?token=abc',
    });
    expect(source.url).toContain('token=%5Bredacted%5D');
    const result = await engine.refreshSource(source.id);
    expect(result.channelCount).toBe(4);
    expect(result.programCount).toBe(4);
    expect(requests).toContain('https://guide.test/epg.xml');
    const refreshed = engine.getSource(source.id)!;
    expect(refreshed.status).toBe('ready');
    expect(refreshed.epgStatus).toBe('ready');
    expect(refreshed.epgUrl).toBe('https://guide.test/epg.xml');
    expect(engine.listGroups().map((group) => [group.name, group.channelCount])).toEqual([
      ['Noticias', 1],
      ['Cine', 2],
      ['P2P', 1],
    ]);
  });

  it('records errors without exposing secrets and keeps the previous revision', async () => {
    let fail = false;
    const { engine } = await createEngine({
      'https://lists.test/': () => {
        if (fail)
          throw new Error('Source returned HTTP 500 for https://lists.test/x?password=hunter2');
        return PLAYLIST;
      },
    });
    const source = await engine.addSource({ kind: 'm3u', name: 'A', url: 'https://lists.test/x' });
    await engine.refreshSource(source.id);
    fail = true;
    await expect(engine.refreshSource(source.id)).rejects.toThrow(/HTTP 500/);
    const failed = engine.getSource(source.id)!;
    expect(failed.status).toBe('error');
    expect(failed.lastError).not.toContain('hunter2');
    expect(engine.listChannels().total).toBe(4);
  });

  it('detects Xtream URLs pasted as M3U and builds the right requests', async () => {
    const { engine, requests } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_categories`]:
        LIVE_CATEGORIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_streams`]:
        LIVE_STREAMS,
      [`${PANEL}/get.php`]: () => {
        throw new Error('get.php must not be downloaded when the API works');
      },
      [`${PANEL}/xmltv.php`]: EPG,
    });
    const source = await engine.addSource({
      kind: 'm3u',
      name: 'Panel',
      url: `${PANEL}/get.php?username=alice&password=s3cret&type=m3u_plus&output=ts`,
    });
    expect(source.kind).toBe('xtream');
    expect(source.xtream).toEqual({ baseUrl: PANEL, username: 'alice', output: 'ts' });
    expect(JSON.stringify(source)).not.toContain('s3cret');
    const result = await engine.refreshSource(source.id);
    expect(result.channelCount).toBe(2);
    expect(requests.filter((url) => !url.includes('action='))).toEqual([
      `${PANEL}/player_api.php?username=alice&password=s3cret`,
      `${PANEL}/xmltv.php?username=alice&password=s3cret`,
    ]);
    expect(requests.filter((url) => url.includes('action='))).toHaveLength(6);
    expect(engine.getSource(source.id)?.account?.maxConnections).toBe(1);
    const channel = engine.listChannels().items[0]!;
    expect(channel.name).toBe('Noticias 24');
    expect(channel.groupName).toBe('Noticias');
    expect(channel.logo).toBe('http://img/news.png');
    expect(channel.streamKind).toBe('mpegts');
    expect(JSON.stringify(engine.listChannels())).not.toContain('s3cret');
    const playable = await engine.getPlayable(channel.id);
    expect(playable.url).toBe(`${PANEL}/live/alice/s3cret/1.ts`);
  });

  it('falls back to the get.php playlist when the live API is unavailable', async () => {
    const { engine, requests } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=`]: () => {
        throw new Error('HTTP 512');
      },
      [`${PANEL}/get.php`]: XTREAM_PLAYLIST,
    });
    const source = await engine.addSource({
      kind: 'xtream',
      name: 'Panel',
      host: PANEL,
      username: 'alice',
      password: 's3cret',
      output: 'm3u8',
    });
    const result = await engine.refreshSource(source.id);
    expect(result.channelCount).toBe(2);
    expect(result.warnings.some((warning) => warning.startsWith('Live API:'))).toBe(true);
    expect(requests).toContain(
      `${PANEL}/get.php?username=alice&password=s3cret&type=m3u_plus&output=m3u8`,
    );
  });

  it('keeps channel ids stable between the live API and the playlist', async () => {
    // Same source id in both engines so only the importer differs.
    const fixedId = () => 'source-fixed';
    const api = await createEngine(
      {
        [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
        [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_categories`]:
          LIVE_CATEGORIES,
        [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_streams`]:
          LIVE_STREAMS,
      },
      fixedId,
    );
    const playlist = await createEngine(
      {
        [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
        [`${PANEL}/get.php`]: XTREAM_PLAYLIST,
      },
      fixedId,
    );
    const input = { kind: 'xtream' as const, name: 'P', host: PANEL, username: 'alice' };
    const fromApi = await api.engine.addSource({ ...input, password: 's3cret' });
    const fromPlaylist = await playlist.engine.addSource({ ...input, password: 's3cret' });
    expect(fromApi.id).toBe(fromPlaylist.id);
    await api.engine.refreshSource(fromApi.id);
    await playlist.engine.refreshSource(fromPlaylist.id);
    const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));
    // Both channels carry an epg id, which is the identity the id derives from.
    expect(ids(api.engine.listChannels().items)).toEqual(ids(playlist.engine.listChannels().items));
  });

  it('reads the guide through the host when it can stream it', async () => {
    const calls: unknown[] = [];
    const { platform, requests } = fakePlatform({ 'https://lists.test/': PLAYLIST });
    const streaming: EnginePlatform = {
      ...platform,
      fetchGuide: (url, options) => {
        calls.push({ url, options });
        return Promise.resolve({
          channels: [['News.ES', 'Noticias 24']],
          programmes: [
            ['News.ES', NOW - 3_600_000, NOW + 1_800_000, 'Boletín', 'Noticias', 'News'],
            ['News.ES', NOW + 1_800_000, NOW + 7_200_000, 'Debate', null, null],
            ['News.ES', NOW - 10 * 3_600_000, NOW - 9 * 3_600_000, 'Antiguo', null, null],
          ],
          skipped: 3,
          warnings: ['the guide ended early with 1 element(s) still open'],
        });
      },
    };
    counter += 1;
    const engine = new OrivueEngine({
      platform: streaming,
      databaseName: `orivue-test-${counter}`,
      now: () => NOW,
    });
    await engine.init();
    await engine.updateSettings({ userAgent: 'MyPlayer/9', epgHorizonHours: 48 });
    const source = await engine.addSource({ kind: 'm3u', name: 'L', url: 'https://lists.test/a' });
    const result = await engine.refreshSource(source.id);
    // The guide never goes through fetchText.
    expect(requests.some((url) => url.includes('guide.test'))).toBe(false);
    expect(calls).toEqual([
      {
        url: 'https://guide.test/epg.xml',
        options: {
          sinceMs: NOW - 6 * 3_600_000,
          untilMs: NOW + 48 * 3_600_000,
          timeoutMs: 600_000,
          headers: { 'User-Agent': 'MyPlayer/9' },
          allowPrivateNetwork: false,
        },
      },
    ]);
    expect(result.programCount).toBe(2);
    expect(result.warnings).toContain('the guide ended early with 1 element(s) still open');
    const channel = engine.listChannels().items.find((c) => c.name === 'Noticias 24')!;
    const [now] = await engine.epgNow([channel.id]);
    expect(now?.current?.title).toBe('Boletín');
    expect(now?.next?.title).toBe('Debate');
  });

  it('sends the configured user agent to panels, lists and streams', async () => {
    const { engine, headersSeen } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_categories`]:
        LIVE_CATEGORIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_streams`]:
        LIVE_STREAMS,
      'https://lists.test/': PLAYLIST,
    });
    const plain = await engine.addSource({ kind: 'm3u', name: 'L', url: 'https://lists.test/a' });
    await engine.refreshSource(plain.id);
    expect(headersSeen.at(-1)).toEqual({});
    await engine.updateSettings({ userAgent: 'MyPlayer/9' });
    const panel = await engine.addSource({
      kind: 'xtream',
      name: 'P',
      host: PANEL,
      username: 'alice',
      password: 's3cret',
    });
    await engine.refreshSource(panel.id);
    const panelRequests = headersSeen.slice(-7);
    expect(panelRequests.every((headers) => headers['User-Agent'] === 'MyPlayer/9')).toBe(true);
    const channels = engine.listChannels().items;
    const live = await engine.getPlayable(channels.find((c) => c.name === 'Noticias 24')!.id);
    expect(live.headers['User-Agent']).toBe('MyPlayer/9');
    // A per-channel agent from the list wins over the global setting.
    const custom = await engine.getPlayable(channels.find((c) => c.name === 'Cine Clásico')!.id);
    expect(custom.headers).toEqual({ 'User-Agent': 'Orivue Test' });
  });

  it('explains the playlist size limit instead of leaking the transport error', async () => {
    const { engine } = await createEngine({
      [`${PANEL}/list.m3u`]: () => {
        throw new Error('the stream could not be reached: the source exceeds the size limit');
      },
    });
    const source = await engine.addSource({ kind: 'm3u', name: 'Big', url: `${PANEL}/list.m3u` });
    await expect(engine.refreshSource(source.id)).rejects.toThrow(
      /^Channels: the playlist exceeds the 120 MB limit/,
    );
  });

  it('creates Xtream sources from host, username and password and rejects bad credentials', async () => {
    const { engine } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify({ user_info: { auth: 0, status: 'Disabled' } }),
      [`${PANEL}/get.php`]: XTREAM_PLAYLIST,
    });
    await expect(engine.validateXtream('panel.example:8080', 'alice', 'bad')).rejects.toThrow(
      /rejected/,
    );
    const source = await engine.addSource({
      kind: 'xtream',
      name: 'Panel',
      host: 'panel.example:8080',
      username: 'alice',
      password: 'bad',
      output: 'm3u8',
    });
    await expect(engine.refreshSource(source.id)).rejects.toThrow(/rejected/);
    expect(engine.getSource(source.id)?.status).toBe('error');
  });

  it('imports local files, updates and removes sources', async () => {
    const { engine } = await createEngine({});
    const source = await engine.addSource({ kind: 'file', name: 'Local', content: PLAYLIST });
    await engine.refreshSource(source.id);
    expect(engine.listChannels().total).toBe(4);
    await engine.updateSource(source.id, { name: 'Renombrada', autoRefreshMinutes: 30 });
    expect(engine.getSource(source.id)?.name).toBe('Renombrada');
    expect(await engine.removeSource(source.id)).toBe(true);
    expect(engine.listSources()).toEqual([]);
    expect(engine.listChannels().total).toBe(0);
    expect(await engine.removeSource(source.id)).toBe(false);
  });

  it('survives a restart from persisted state', async () => {
    const { engine, platform } = await createEngine({ 'https://lists.test/': PLAYLIST });
    const source = await engine.addSource({ kind: 'm3u', name: 'A', url: 'https://lists.test/x' });
    await engine.refreshSource(source.id);
    await engine.setFavorite(engine.listChannels().items[0]!.id, true);
    engine.close();
    const reopened = new OrivueEngine({
      platform,
      databaseName: `orivue-test-${counter}`,
      now: () => NOW,
    });
    await reopened.init();
    expect(reopened.listSources()[0]?.channelCount).toBe(4);
    expect(reopened.listChannels({ favorite: true }).total).toBe(1);
  });

  it('refreshes only the sources whose interval elapsed', async () => {
    const { engine, requests } = await createEngine({ 'https://lists.test/': PLAYLIST });
    const due = await engine.addSource({
      kind: 'm3u',
      name: 'Due',
      url: 'https://lists.test/a',
      autoRefreshMinutes: 10,
    });
    const manual = await engine.addSource({
      kind: 'm3u',
      name: 'Manual',
      url: 'https://lists.test/b',
      autoRefreshMinutes: 0,
    });
    await engine.refreshSource(manual.id);
    expect(await engine.refreshDue()).toEqual([due.id]);
    expect(requests.filter((url) => url.startsWith('https://lists'))).toEqual([
      'https://lists.test/b',
      'https://lists.test/a',
    ]);
    expect(await engine.refreshDue()).toEqual([]);
  });

  it('finishes the first import of a manual source that never completed', async () => {
    const { engine } = await createEngine({
      'https://lists.test/ok': PLAYLIST,
      'https://lists.test/broken': () => {
        throw new Error('HTTP 503');
      },
    });
    const ok = await engine.addSource({
      kind: 'm3u',
      name: 'Interrupted',
      url: 'https://lists.test/ok',
      autoRefreshMinutes: 0,
    });
    const broken = await engine.addSource({
      kind: 'm3u',
      name: 'Broken',
      url: 'https://lists.test/broken',
      autoRefreshMinutes: 0,
    });
    expect(await engine.refreshDue()).toEqual([ok.id]);
    expect(engine.getSource(ok.id)?.status).toBe('ready');
    // The failed one is recorded as an error and is not retried in a loop.
    expect(engine.getSource(broken.id)?.status).toBe('error');
    expect(engine.getSource(broken.id)?.lastError).toMatch(/^Channels: /);
    expect(await engine.refreshDue()).toEqual([]);
  });

  it('reports the refresh step while it runs and keeps the warnings afterwards', async () => {
    const { engine } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_categories`]:
        LIVE_CATEGORIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_streams`]:
        LIVE_STREAMS,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=`]: () => {
        throw new Error('HTTP 500');
      },
      [`${PANEL}/xmltv.php`]: () => {
        throw new Error('the stream could not be reached: the source exceeds the size limit');
      },
    });
    const steps: (string | null)[] = [];
    engine.subscribe((event) => {
      if (event.type === 'refresh')
        steps.push(engine.getSource(event.sourceId)?.refreshing ?? null);
    });
    const source = await engine.addSource({
      kind: 'xtream',
      name: 'Panel',
      host: PANEL,
      username: 'alice',
      password: 's3cret',
    });
    expect(source.refreshing).toBeNull();
    const result = await engine.refreshSource(source.id);
    expect(steps).toEqual(['live', 'account', 'live', 'vod', 'epg', null]);
    expect(result.channelCount).toBe(2);
    const refreshed = engine.getSource(source.id)!;
    expect(refreshed.refreshing).toBeNull();
    expect(refreshed.status).toBe('ready');
    expect(refreshed.lastWarnings).toEqual([
      expect.stringMatching(/^VOD: /),
      expect.stringMatching(/^EPG: .*size limit/),
    ]);
    expect(JSON.stringify(refreshed.lastWarnings)).not.toContain('s3cret');
  });
});

describe('OrivueEngine library and queries', () => {
  let engine: OrivueEngine;
  beforeEach(async () => {
    ({ engine } = await createEngine({
      'https://lists.test/': PLAYLIST,
      'https://guide.test/epg.xml': EPG,
    }));
    const source = await engine.addSource({ kind: 'm3u', name: 'A', url: 'https://lists.test/x' });
    await engine.refreshSource(source.id);
  });

  it('searches, filters by group and paginates', () => {
    expect(engine.listChannels({ search: 'cine' }).items.map((c) => c.name)).toEqual([
      'Cine Clásico',
      'Cine Infantil',
    ]);
    expect(engine.listChannels({ search: 'CINE infantil' }).total).toBe(1);
    const group = engine.listGroups().find((item) => item.name === 'Cine')!;
    expect(engine.listChannels({ groupId: group.id, limit: 1, offset: 1 }).items[0]?.name).toBe(
      'Cine Infantil',
    );
    expect(engine.listChannels({ limit: 1 }).items[0]?.number).toBe(1);
  });

  it('tracks favourites, recents, hidden channels and custom names', async () => {
    const [news, movies] = engine.listChannels().items;
    await engine.setFavorite(news!.id, true);
    expect(engine.listChannels({ favorite: true }).items.map((c) => c.id)).toEqual([news!.id]);
    await engine.markRecent(movies!.id);
    await engine.markRecent(news!.id);
    expect(engine.listChannels({ recent: true }).items.map((c) => c.id)).toEqual([
      news!.id,
      movies!.id,
    ]);
    await engine.setChannelHidden(movies!.id, true);
    expect(engine.listChannels().total).toBe(3);
    expect(engine.listChannels({ includeHidden: true }).total).toBe(4);
    const group = engine.listGroups().find((item) => item.name === 'Cine')!;
    await engine.setGroupHidden(group.id, true);
    expect(engine.listChannels().total).toBe(2);
    expect(engine.listGroups().find((item) => item.id === group.id)?.hidden).toBe(true);
    await engine.renameChannel(news!.id, 'Mis noticias');
    expect(engine.getChannel(news!.id)?.name).toBe('Mis noticias');
    expect(engine.listChannels({ search: 'mis noticias' }).total).toBe(1);
    expect(await engine.setFavorite('missing', true)).toBe(false);
  });

  it('resolves now/next by tvg-id or display name and manual mappings', async () => {
    const channels = engine.listChannels().items;
    const news = channels.find((c) => c.name === 'Noticias 24')!;
    const movies = channels.find((c) => c.name === 'Cine Clásico')!;
    const kids = channels.find((c) => c.name === 'Cine Infantil')!;
    const [n, m, k] = await engine.epgNow([news.id, movies.id, kids.id]);
    expect(n?.current?.title).toBe('Boletín');
    expect(n?.next?.title).toBe('Debate');
    expect(m?.current?.title).toBe('Película');
    expect(m?.next).toBeNull();
    expect(k?.current).toBeNull();
    await engine.mapEpg(kids.id, 'News.ES');
    const [mapped] = await engine.epgNow([kids.id]);
    expect(mapped?.current?.title).toBe('Boletín');
    expect(engine.listEpgChannels(news.sourceId)).toEqual([
      { id: 'news.es', name: 'Noticias 24' },
      { id: 'movies.es', name: 'Cine Clásico' },
    ]);
  });

  it('builds a timeline bounded by the requested window', async () => {
    const news = engine.listChannels().items[0]!;
    const rows = await engine.timeline('2026-10-10T12:00:00.000Z', '2026-10-10T18:00:00.000Z', [
      news.id,
    ]);
    expect(rows[0]?.programs.map((p) => p.title)).toEqual(['Boletín', 'Debate']);
    const later = await engine.timeline('2026-10-10T13:00:00.000Z', '2026-10-10T18:00:00.000Z', [
      news.id,
    ]);
    expect(later[0]?.programs.map((p) => p.title)).toEqual(['Debate']);
  });

  it('describes playable streams and routes Ace Stream through the local engine', async () => {
    const channels = engine.listChannels().items;
    const movies = await engine.getPlayable(channels.find((c) => c.name === 'Cine Clásico')!.id);
    expect(movies.kind).toBe('mpegts');
    expect(movies.headers).toEqual({ 'User-Agent': 'Orivue Test' });
    expect(movies.allowLoopback).toBe(false);
    const ace = await engine.getPlayable(channels.find((c) => c.name === 'Demo Ace')!.id);
    expect(ace.kind).toBe('acestream');
    expect(ace.url).toBe(
      'http://127.0.0.1:6878/ace/getstream?id=0123456789abcdef0123456789abcdef01234567',
    );
    expect(ace.allowLoopback).toBe(true);
    expect(engine.listChannels({ recent: true }).total).toBe(2);
    await expect(engine.getPlayable('missing')).rejects.toThrow(/not found/);
  });
});

describe('stream kind detection', () => {
  it('classifies common IPTV URLs', () => {
    expect(detectStreamKind('https://h.test/a/index.m3u8?x=1')).toBe('hls');
    expect(detectStreamKind('https://h.test/a.ts')).toBe('mpegts');
    expect(detectStreamKind(`${PANEL}/live/u/p/12`)).toBe('mpegts');
    expect(detectStreamKind(`${PANEL}/u/p/12`)).toBe('mpegts');
    expect(detectStreamKind(`${PANEL}/movie/u/p/12.mkv`)).toBe('http');
    expect(detectStreamKind('https://h.test/clip.mp4')).toBe('http');
    expect(detectStreamKind('acestream://0123456789abcdef0123456789abcdef01234567')).toBe(
      'acestream',
    );
    expect(detectStreamKind('https://h.test/stream')).toBe('unknown');
    expect(detectStreamKind('nope')).toBe('unknown');
  });

  it('refines the kind from the content type', () => {
    expect(refineStreamKind('unknown', 'application/vnd.apple.mpegurl')).toBe('hls');
    expect(refineStreamKind('unknown', 'video/mp2t')).toBe('mpegts');
    expect(refineStreamKind('mpegts', 'video/mp4')).toBe('http');
    expect(refineStreamKind('hls', null)).toBe('hls');
    expect(refineStreamKind('unknown', 'video/x-matroska')).toBe('mpegts');
  });
});

describe('redaction', () => {
  it('hides credentials in free text', () => {
    expect(safeText(`Failed ${PANEL}/live/alice/s3cret/1 and ?password=x&user=y`)).toBe(
      `Failed ${PANEL}/live/[redacted]/[redacted]/1 and ?password=[redacted]&user=[redacted]`,
    );
  });
});

describe('Xtream VOD catalogue', () => {
  const MOVIES = JSON.stringify([
    {
      stream_id: 1,
      name: 'Película A',
      category_id: '10',
      container_extension: 'mkv',
      stream_icon: 'http://img/a.jpg',
    },
    { stream_id: 2, name: 'Película B', category_id: '11' },
  ]);
  const SERIES = JSON.stringify([
    { series_id: 7, name: 'Serie X', category_id: '20', cover: 'http://img/x.jpg' },
  ]);
  const SERIES_INFO = JSON.stringify({
    info: { plot: 'Trama' },
    episodes: { '1': [{ id: '701', episode_num: 1, title: 'Piloto', container_extension: 'mp4' }] },
  });
  const XTREAM_WITH_VOD = `${XTREAM_PLAYLIST}#EXTINF:-1 tvg-id="" group-title="VOD",Película A
${PANEL}/movie/alice/s3cret/1.mkv
`;

  async function createXtreamEngine() {
    const fixture = await createEngine({
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_vod_categories`]:
        JSON.stringify([
          { category_id: '10', category_name: 'Acción' },
          { category_id: '11', category_name: 'Drama' },
        ]),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_series_categories`]:
        JSON.stringify([{ category_id: '20', category_name: 'Comedia' }]),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_vod_streams`]: MOVIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_series`]: SERIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_series_info`]:
        SERIES_INFO,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_categories`]:
        LIVE_CATEGORIES,
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=get_live_streams`]:
        LIVE_STREAMS,
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/get.php`]: XTREAM_WITH_VOD,
      [`${PANEL}/xmltv.php`]: EPG,
    });
    const source = await fixture.engine.addSource({
      kind: 'xtream',
      name: 'Panel',
      host: PANEL,
      username: 'alice',
      password: 's3cret',
    });
    const result = await fixture.engine.refreshSource(source.id);
    return { ...fixture, source, result };
  }

  it('imports movies and series and removes them from the live list', async () => {
    const { engine, source, result } = await createXtreamEngine();
    expect(result).toMatchObject({ channelCount: 2, movieCount: 2, seriesCount: 1 });
    expect(engine.listChannels().items.map((c) => c.name)).toEqual([
      'Noticias 24',
      'Deporte Total',
    ]);
    expect(engine.getSource(source.id)).toMatchObject({ movieCount: 2, seriesCount: 1 });
    expect(engine.listVodCategories('movie').map((c) => [c.name, c.count])).toEqual([
      ['Acción', 1],
      ['Drama', 1],
    ]);
    const drama = engine.listVodCategories('movie')[1]!;
    expect(engine.listVod({ kind: 'movie', categoryId: drama.id }).items[0]?.name).toBe(
      'Película B',
    );
    expect(engine.listVod({ kind: 'series', search: 'serie' }).total).toBe(1);
  });

  it('plays movies and episodes with on-demand streams', async () => {
    const { engine } = await createXtreamEngine();
    const movie = engine.listVod({ kind: 'movie' }).items[0]!;
    const playable = await engine.getPlayableVod(movie.id);
    expect(playable).toMatchObject({
      live: false,
      kind: 'http',
      url: `${PANEL}/movie/alice/s3cret/1.mkv`,
    });
    const series = engine.listVod({ kind: 'series' }).items[0]!;
    const info = await engine.getSeriesInfo(series.id);
    expect(info.plot).toBe('Trama');
    expect(info.seasons[0]?.episodes[0]?.title).toBe('Piloto');
    const episode = await engine.getPlayableVod(series.id, '701');
    expect(episode.url).toBe(`${PANEL}/series/alice/s3cret/701.mp4`);
    expect(episode.title).toContain('1x01');
    await expect(engine.getPlayableVod(series.id)).rejects.toThrow(/episode/);
  });

  it('keeps the M3U VOD entries when the catalogue cannot be fetched', async () => {
    const { engine } = await createEngine({
      [`${PANEL}/player_api.php`]: JSON.stringify(ACCOUNT),
      [`${PANEL}/player_api.php?username=alice&password=s3cret&action=`]: () => {
        throw new Error('HTTP 500');
      },
      [`${PANEL}/get.php`]: XTREAM_WITH_VOD,
    });
    const source = await engine.addSource({
      kind: 'xtream',
      name: 'P',
      host: PANEL,
      username: 'alice',
      password: 's3cret',
    });
    const result = await engine.refreshSource(source.id);
    expect(result.channelCount).toBe(3);
    expect(result.warnings.some((warning) => warning.startsWith('VOD:'))).toBe(true);
    expect(engine.listVod({ kind: 'movie' }).total).toBe(0);
  });
});
