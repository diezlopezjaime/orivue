import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '@orivue/core';
import {
  AceStreamResolver,
  HlsResolver,
  HttpResolver,
  StreamResolverError,
  createDefaultResolverRegistry,
  extractAceContentId,
} from '../src/index.js';

const channel = (url: string): Channel => ({ id: 'fixture', name: 'Fixture', url });
const CONTENT_ID = '0123456789abcdef0123456789abcdef01234567';

describe('HTTP resolvers', () => {
  it('distinguishes HLS from direct HTTP while preserving headers', async () => {
    const hls = new HlsResolver();
    const direct = new HttpResolver();
    const source = {
      ...channel('https://fixture.invalid/live.m3u8?token=secret'),
      headers: { Referer: 'https://app.invalid' },
    };
    expect(hls.supports(source)).toBe(true);
    expect(direct.supports(source)).toBe(false);
    await expect(hls.resolve(source)).resolves.toMatchObject({
      kind: 'hls',
      headers: source.headers,
    });
    expect(direct.supports(channel('https://fixture.invalid/video.ts'))).toBe(true);
  });
});

describe('AceStreamResolver', () => {
  it('recognises scheme, bare and compatible query identifiers', () => {
    expect(extractAceContentId(`acestream://${CONTENT_ID}`)).toBe(CONTENT_ID);
    expect(extractAceContentId(CONTENT_ID)).toBe(CONTENT_ID);
    expect(extractAceContentId(`http://localhost/play?infohash=${CONTENT_ID}`)).toBe(CONTENT_ID);
    expect(extractAceContentId('acestream://not-real-content')).toBeUndefined();
  });

  it('resolves against a configurable simulated engine and stops its session', async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fakeFetch = vi.fn<typeof fetch>((input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/health')) return Promise.resolve(new Response('ok'));
      if (url.includes('/resolve/'))
        return Promise.resolve(
          Response.json({
            playback_url: 'http://127.0.0.1:9999/playback/fixture',
            session_id: 'engine-session',
          }),
        );
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const resolver = new AceStreamResolver({
      endpoint: 'http://127.0.0.1:9999',
      fetch: fakeFetch,
      healthPath: '/health',
      resolveMode: 'json',
      resolvePath: (id) => `/resolve/${id}`,
      stopPath: (sessionId) => `/stop/${sessionId}`,
    });
    const result = await resolver.resolve(channel(`acestream://${CONTENT_ID}`));
    expect(result).toMatchObject({ url: 'http://127.0.0.1:9999/playback/fixture', kind: 'http' });
    await resolver.stop(result.sessionId);
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'DELETE']);
    expect(requests.at(-1)?.url).toContain('/stop/engine-session');
  });

  it('returns a specific, sanitised error when the engine is unavailable', async () => {
    const resolver = new AceStreamResolver({
      endpoint: 'http://127.0.0.1:6878',
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token-from-network')),
    });
    const error = await resolver
      .resolve(channel(`acestream://${CONTENT_ID}`))
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StreamResolverError);
    expect((error as StreamResolverError).code).toBe('acestream-unavailable');
    expect((error as Error).message).not.toContain('secret-token-from-network');
  });

  it('rejects non-local endpoints by default', () => {
    expect(() => new AceStreamResolver({ endpoint: 'https://engine.example.test:6878' })).toThrow(
      /local/,
    );
  });

  it('integrates with the default registry', async () => {
    const registry = createDefaultResolverRegistry({
      aceStream: { checkAvailability: false, endpoint: 'http://127.0.0.1:6878' },
    });
    const result = await registry.resolve(channel(`acestream://${CONTENT_ID}`));
    expect(result.url).toContain(`/ace/getstream?id=${CONTENT_ID}`);
    await expect(registry.stop(result.sessionId)).resolves.toBeUndefined();
  });
});
