import { describe, expect, it } from 'vitest';
import { memoryKeyValueStore, OrivueEngine, type EnginePlatform } from '../src/index.js';

/**
 * Scale check: 30 000 channels and a guide with 1 000 channels × 7 days.
 * Skipped unless ORIVUE_PERF=1 because it takes a while under fake-indexeddb,
 * which is much slower than a browser's IndexedDB.
 */
const enabled = process.env.ORIVUE_PERF === '1';
const CHANNELS = Number(process.env.ORIVUE_PERF_CHANNELS ?? 30_000);
const EPG_CHANNELS = Number(process.env.ORIVUE_PERF_EPG_CHANNELS ?? 1_000);
const DAYS = 7;

function playlist(count: number): string {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < count; index += 1) {
    const group = `Group ${String(index % 120).padStart(3, '0')}`;
    const id = `fixture.${String(index % EPG_CHANNELS).padStart(6, '0')}`;
    lines.push(
      `#EXTINF:-1 tvg-id="${id}" group-title="${group}",Fixture channel ${index}`,
      `https://example.invalid/live/${index}.ts`,
    );
  }
  return lines.join('\n');
}

function guide(now: number): string {
  const parts = ['<tv>'];
  const stamp = (ms: number) => {
    const d = new Date(ms);
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
  };
  const start = now - 3_600_000;
  for (let c = 0; c < EPG_CHANNELS; c += 1) {
    const id = `fixture.${String(c).padStart(6, '0')}`;
    parts.push(`<channel id="${id}"><display-name>Fixture ${c}</display-name></channel>`);
    for (let slot = 0; slot < DAYS * 24; slot += 1) {
      const from = start + slot * 3_600_000;
      parts.push(
        `<programme start="${stamp(from)}" stop="${stamp(from + 3_600_000)}" channel="${id}"><title>Programme ${slot}</title></programme>`,
      );
    }
  }
  parts.push('</tv>');
  return parts.join('\n');
}

describe.skipIf(!enabled)('engine at scale', () => {
  it('imports, searches and resolves the guide within budget', async () => {
    const now = Date.now();
    const m3u = playlist(CHANNELS);
    const xml = guide(now);
    const platform: EnginePlatform = {
      name: 'browser',
      kv: memoryKeyValueStore(),
      fetchText: (url) => Promise.resolve(url.endsWith('.xml') ? xml : m3u),
    };
    const engine = new OrivueEngine({ platform, databaseName: 'orivue-perf' });
    await engine.init();
    const source = await engine.addSource({
      kind: 'm3u',
      name: 'Perf',
      url: 'https://perf.test/list.m3u',
      epgUrl: 'https://perf.test/guide.xml',
    });
    const timings: Record<string, number> = {};
    let t0 = performance.now();
    const result = await engine.refreshSource(source.id);
    timings.import = performance.now() - t0;
    expect(result.channelCount).toBe(CHANNELS);
    expect(result.programCount).toBeGreaterThan(EPG_CHANNELS * 48);

    t0 = performance.now();
    const all = engine.listChannels({ limit: 5000 });
    timings.list = performance.now() - t0;
    expect(all.total).toBe(CHANNELS);

    t0 = performance.now();
    const search = engine.listChannels({ search: 'channel 2999' });
    timings.search = performance.now() - t0;
    expect(search.total).toBeGreaterThan(0);

    t0 = performance.now();
    const groups = engine.listGroups();
    timings.groups = performance.now() - t0;
    expect(groups).toHaveLength(120);

    const ids = all.items.slice(0, 500).map((channel) => channel.id);
    t0 = performance.now();
    const now500 = await engine.epgNow(ids);
    timings.epgNowCold = performance.now() - t0;
    expect(now500.filter((entry) => entry.current).length).toBe(500);
    t0 = performance.now();
    await engine.epgNow(ids);
    timings.epgNowWarm = performance.now() - t0;

    t0 = performance.now();
    const rows = await engine.timeline(
      new Date(now).toISOString(),
      new Date(now + 6 * 3_600_000).toISOString(),
      ids.slice(0, 200),
    );
    timings.timeline = performance.now() - t0;
    expect(rows[0]?.programs.length).toBeGreaterThanOrEqual(6);

    // Reopen from storage, as a cold app start would.
    engine.close();
    const reopened = new OrivueEngine({ platform, databaseName: 'orivue-perf' });
    t0 = performance.now();
    await reopened.init();
    timings.coldStart = performance.now() - t0;
    expect(reopened.listChannels().total).toBe(CHANNELS);

    console.table(
      Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, `${Math.round(v)} ms`])),
    );
    expect(timings.list).toBeLessThan(500);
    expect(timings.search).toBeLessThan(500);
    expect(timings.epgNowWarm).toBeLessThan(50);
  }, 600_000);
});
