import { describe, expect, it } from 'vitest';
import { parseM3u } from '../src/index.js';

describe('parseM3u', () => {
  it('parses international metadata and safe playback headers', () => {
    const result = parseM3u(`\uFEFF#EXTM3U
#EXTINF:-1 tvg-id="cafe" tvg-name="Café 日本" tvg-logo="https://img.test/a.png" group-title="Noticias",Café TV
#EXTVLCOPT:http-user-agent=OriVue Test
https://user:secret@example.test/live.m3u8?token=private|Referer=https%3A%2F%2Fapp.test&X-Injection=no
`);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toMatchObject({
      name: 'Café TV',
      tvgId: 'cafe',
      groupName: 'Noticias',
      headers: { 'User-Agent': 'OriVue Test', Referer: 'https://app.test' },
    });
    expect(result.warnings.some((warning) => warning.code === 'unsafe-header')).toBe(true);
    expect(JSON.stringify(result.warnings)).not.toContain('private');
  });

  it('keeps IDs stable when credentials and tokens rotate', () => {
    const first = parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-id="news",News\nhttps://a:p@host.test/live?token=one',
      { sourceId: 'playlist-1' },
    );
    const second = parseM3u(
      '#EXTM3U\n#EXTINF:-1 tvg-id="news",News\nhttps://b:q@host.test/live?token=two',
      { sourceId: 'playlist-1' },
    );
    expect(first.channels[0]?.id).toBe(second.channels[0]?.id);
  });

  it('recovers from malformed entries without exposing their contents', () => {
    const result = parseM3u(`#EXTINF:-1,Broken
not a URL
#EXTINF:-1,Missing
#EXTINF:-1,Valid
https://example.test/video.ts
https://example.test/orphan.ts`);
    expect(result.channels).toHaveLength(2);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['missing-header', 'invalid-url', 'missing-url', 'missing-extinf']),
    );
  });

  it('parses 10,000 entries and can handle a 100,000-entry fixture', () => {
    const makeFixture = (count: number) =>
      `#EXTM3U\n${Array.from({ length: count }, (_, index) => `#EXTINF:-1 tvg-id="id-${index}" group-title="Demo",Channel ${index}\nhttps://fixture.invalid/${index}.m3u8`).join('\n')}`;
    expect(parseM3u(makeFixture(10_000)).channels).toHaveLength(10_000);

    const started = performance.now();
    expect(parseM3u(makeFixture(100_000)).channels).toHaveLength(100_000);
    // Generous regression guard: intended to catch accidental quadratic parsing.
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 25_000);
});
