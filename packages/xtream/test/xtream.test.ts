import { describe, expect, it } from 'vitest';
import {
  buildApiUrl,
  buildEpgUrl,
  buildPlaylistUrl,
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
