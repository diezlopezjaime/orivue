import { describe, expect, it } from 'vitest';
import {
  buildApiUrl,
  buildEpgUrl,
  buildEpisodeUrl,
  buildLiveUrl,
  buildMovieUrl,
  buildPlaylistUrl,
  buildSeriesInfoUrl,
  isVodStreamUrl,
  parseCategories,
  parseLiveStreams,
  parseMovies,
  parseSeriesInfo,
  parseSeriesList,
  createXtreamCredentials,
  fetchAccountInfo,
  parseAccountInfo,
  parseXtreamUrl,
  redactXtreamUrl,
  XtreamError,
} from '../src/index.js';

const PANEL = 'http://panel.example:8080';

describe('parseXtreamUrl', () => {
  it('recognises get.php playlist URLs', () => {
    expect(
      parseXtreamUrl(`${PANEL}/get.php?username=alice&password=s3cret&type=m3u_plus&output=ts`),
    ).toEqual({ baseUrl: PANEL, username: 'alice', password: 's3cret' });
  });

  it('keeps a path prefix and handles the other panel scripts', () => {
    expect(parseXtreamUrl(`${PANEL}/iptv/player_api.php?username=a&password=b`)).toEqual({
      baseUrl: `${PANEL}/iptv`,
      username: 'a',
      password: 'b',
    });
    expect(parseXtreamUrl(`${PANEL}/xmltv.php?password=b&username=a`)?.username).toBe('a');
  });

  it('recognises stream URLs with embedded credentials', () => {
    expect(parseXtreamUrl(`${PANEL}/live/alice/s3cret/42.ts`)).toEqual({
      baseUrl: PANEL,
      username: 'alice',
      password: 's3cret',
    });
  });

  it('ignores plain playlists and invalid input', () => {
    expect(parseXtreamUrl('https://example.test/lista.m3u')).toBeUndefined();
    expect(parseXtreamUrl(`${PANEL}/get.php?type=m3u`)).toBeUndefined();
    expect(parseXtreamUrl('not a url')).toBeUndefined();
    expect(parseXtreamUrl('ftp://panel/get.php?username=a&password=b')).toBeUndefined();
  });
});

describe('URL builders', () => {
  const credentials = createXtreamCredentials('panel.example:8080/get.php', ' alice ', 's3cret');

  it('normalises a host typed without scheme', () => {
    expect(credentials).toEqual({ baseUrl: PANEL, username: 'alice', password: 's3cret' });
  });

  it('builds playlist, EPG and API URLs', () => {
    expect(buildPlaylistUrl(credentials)).toBe(
      `${PANEL}/get.php?username=alice&password=s3cret&type=m3u_plus&output=ts`,
    );
    expect(buildPlaylistUrl(credentials, 'm3u8')).toContain('output=m3u8');
    expect(buildEpgUrl(credentials)).toBe(`${PANEL}/xmltv.php?username=alice&password=s3cret`);
    expect(buildApiUrl(credentials, 'get_live_categories')).toContain('action=get_live_categories');
  });

  it('requires both username and password', () => {
    expect(() => createXtreamCredentials(PANEL, 'alice', '')).toThrow();
  });
});

describe('account info', () => {
  const payload = {
    user_info: {
      username: 'alice',
      status: 'Active',
      exp_date: '1900000000',
      is_trial: '0',
      active_cons: '1',
      max_connections: '2',
      allowed_output_formats: ['m3u8', 'ts', 'rtmp'],
      auth: 1,
    },
    server_info: { timezone: 'Europe/Madrid' },
  };

  it('normalises the player_api payload', () => {
    expect(parseAccountInfo(payload)).toEqual({
      status: 'Active',
      expiresAt: new Date(1_900_000_000_000).toISOString(),
      isTrial: false,
      activeConnections: 1,
      maxConnections: 2,
      allowedOutputFormats: ['m3u8', 'ts'],
      serverTimezone: 'Europe/Madrid',
    });
  });

  it('rejects failed authentication and empty responses', () => {
    expect(() => parseAccountInfo({ user_info: { auth: 0, status: 'Disabled' } })).toThrow(
      XtreamError,
    );
    expect(() => parseAccountInfo({})).toThrow(/account information/);
  });

  it('wraps network failures', async () => {
    const credentials = createXtreamCredentials(PANEL, 'a', 'b');
    await expect(
      fetchAccountInfo(credentials, () => Promise.reject(new Error('offline'))),
    ).rejects.toMatchObject({ code: 'network' });
    await expect(
      fetchAccountInfo(credentials, () => Promise.resolve(payload)),
    ).resolves.toMatchObject({ status: 'Active' });
  });
});

describe('redactXtreamUrl', () => {
  it('hides credentials in queries and stream paths', () => {
    expect(redactXtreamUrl(`${PANEL}/get.php?username=alice&password=s3cret&type=m3u_plus`)).toBe(
      `${PANEL}/get.php?username=%5Bredacted%5D&password=%5Bredacted%5D&type=m3u_plus`,
    );
    const live = redactXtreamUrl(`${PANEL}/live/alice/s3cret/42.ts`);
    expect(live).not.toContain('alice');
    expect(live).not.toContain('s3cret');
    const legacy = redactXtreamUrl(`${PANEL}/alice/s3cret/42`);
    expect(legacy).not.toContain('s3cret');
    expect(redactXtreamUrl('nope')).toBe('[invalid or redacted URL]');
  });
});

describe('VOD catalogue', () => {
  const credentials = createXtreamCredentials(PANEL, 'alice', 's3cret');

  it('parses categories, movies and series lists tolerantly', () => {
    expect(
      parseCategories([
        { category_id: 1, category_name: 'Acción' },
        { category_id: '2', category_name: 'Drama' },
        { category_id: '3' },
      ]),
    ).toEqual([
      { id: '1', name: 'Acción' },
      { id: '2', name: 'Drama' },
    ]);
    const movies = parseMovies([
      {
        stream_id: 10,
        name: 'Película',
        category_id: '1',
        stream_icon: 'http://img/1.jpg',
        rating: '7.5',
        container_extension: 'mkv',
        added: '1700000000',
      },
      { name: 'sin id' },
    ]);
    expect(movies).toEqual([
      {
        id: '10',
        name: 'Película',
        categoryId: '1',
        poster: 'http://img/1.jpg',
        rating: 7.5,
        year: null,
        containerExtension: 'mkv',
        addedAt: new Date(1_700_000_000_000).toISOString(),
      },
    ]);
    expect(
      parseSeriesList([{ series_id: 5, name: 'Serie', cover: 'c.jpg', releaseDate: '2021-05-01' }]),
    ).toEqual([
      {
        id: '5',
        name: 'Serie',
        categoryId: null,
        poster: 'c.jpg',
        rating: null,
        year: '2021',
        plot: null,
      },
    ]);
  });

  it('parses series info in object and array layouts', () => {
    const object = parseSeriesInfo({
      info: { plot: 'Trama' },
      episodes: {
        '2': [
          {
            id: '22',
            episode_num: 2,
            title: 'B',
            container_extension: 'mp4',
            info: { duration_secs: 1500 },
          },
        ],
        '1': [{ id: '11', episode_num: '1', title: 'A' }],
      },
    });
    expect(object.plot).toBe('Trama');
    expect(object.seasons.map((season) => season.season)).toEqual([1, 2]);
    expect(object.seasons[1]?.episodes[0]).toMatchObject({ id: '22', durationSeconds: 1500 });
    const array = parseSeriesInfo({ episodes: [[{ id: '1' }], [{ id: '2', episode_num: 1 }]] });
    expect(array.seasons.map((season) => season.episodes[0]?.id)).toEqual(['1', '2']);
  });

  it('parses live streams and builds their URLs', () => {
    expect(
      parseLiveStreams([
        {
          num: 7,
          name: ' Canal Uno ',
          stream_type: 'live',
          stream_id: 42,
          stream_icon: 'http://img/1.png',
          epg_channel_id: 'uno.es',
          category_id: 3,
        },
        { name: 'Radio', stream_type: 'radio_streams', stream_id: 43 },
        { name: 'Sin id' },
        { stream_id: '44', name: 'Mínimo' },
      ]),
    ).toEqual([
      {
        id: '42',
        name: 'Canal Uno',
        categoryId: '3',
        icon: 'http://img/1.png',
        epgChannelId: 'uno.es',
        number: 7,
      },
      { id: '44', name: 'Mínimo', categoryId: null, icon: null, epgChannelId: null, number: null },
    ]);
    expect(parseLiveStreams({ error: 'x' })).toEqual([]);
    expect(buildLiveUrl(credentials, '42')).toBe(`${PANEL}/live/alice/s3cret/42.ts`);
    expect(buildLiveUrl(credentials, '42', 'm3u8')).toBe(`${PANEL}/live/alice/s3cret/42.m3u8`);
  });

  it('builds VOD URLs and recognises them', () => {
    expect(buildMovieUrl(credentials, '10', 'mkv')).toBe(`${PANEL}/movie/alice/s3cret/10.mkv`);
    expect(buildEpisodeUrl(credentials, '22')).toBe(`${PANEL}/series/alice/s3cret/22.mp4`);
    expect(buildSeriesInfoUrl(credentials, '5')).toContain('action=get_series_info&series_id=5');
    expect(isVodStreamUrl(`${PANEL}/movie/alice/s3cret/10.mkv`)).toBe(true);
    expect(isVodStreamUrl(`${PANEL}/live/alice/s3cret/10.ts`)).toBe(false);
  });
});
