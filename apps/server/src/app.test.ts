import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

let app: Awaited<ReturnType<typeof buildApp>> | undefined;
afterEach(async () => app?.close());
const headers = { host: '127.0.0.1' };
describe('local API', () => {
  it('imports a fixture playlist and exposes channels without source secrets', async () => {
    app = await buildApp({ dbPath: ':memory:', logger: false, allowPrivateNetwork: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      headers,
      payload: {
        name: 'Demo',
        content:
          '#EXTM3U\n#EXTINF:-1 tvg-id="demo" group-title="News",Demo News\nhttps://example.test/live.m3u8',
      },
    });
    expect(response.statusCode).toBe(201);
    const channels = await app.inject({ method: 'GET', url: '/api/channels', headers });
    expect(channels.json().items).toHaveLength(1);
    expect(channels.body).not.toContain('live.m3u8');
  });
  it('rejects a foreign web origin', async () => {
    app = await buildApp({ dbPath: ':memory:', logger: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { ...headers, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });
  it('supports authenticated Tauri CORS requests without opening CORS globally', async () => {
    app = await buildApp({ dbPath: ':memory:', logger: false, apiToken: 'desktop-secret-token' });
    const origin = 'http://tauri.localhost';
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        ...headers,
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-orivue-token',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { ...headers, origin, 'x-orivue-token': 'desktop-secret-token' },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.headers['access-control-allow-origin']).toBe(origin);
    const missingToken = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { ...headers, origin },
    });
    expect(missingToken.statusCode).toBe(403);
  });
  it('allows only one active playback session', async () => {
    app = await buildApp({ dbPath: ':memory:', logger: false, allowPrivateNetwork: true });
    const created = await app.inject({
      method: 'POST',
      url: '/api/playlists',
      headers,
      payload: {
        name: 'Demo',
        content:
          '#EXTM3U\n#EXTINF:-1,One\nhttps://example.test/one.m3u8\n#EXTINF:-1,Two\nhttps://example.test/two.m3u8',
      },
    });
    expect(created.statusCode).toBe(201);
    const channels = (await app.inject({ method: 'GET', url: '/api/channels', headers })).json()
      .items as Array<{ id: string }>;
    const first = (
      await app.inject({
        method: 'POST',
        url: '/api/playback/sessions',
        headers,
        payload: { channelId: channels[0]!.id },
      })
    ).json().session;
    const second = await app.inject({
      method: 'POST',
      url: '/api/playback/sessions',
      headers,
      payload: { channelId: channels[1]!.id },
    });
    expect(second.statusCode).toBe(201);
    expect(
      (await app.inject({ method: 'GET', url: `/api/playback/sessions/${first.id}`, headers }))
        .statusCode,
    ).toBe(404);
  });
});
