import { memoryKeyValueStore, OrivueEngine, type EnginePlatform } from '@orivue/engine';
import { setEngineForTests } from '../engine';
import type { AppPlatform, StreamHandle } from '../platform';

export const FIXTURE_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="aurora" group-title="Noticias",Canal Aurora
https://streams.test/aurora/index.m3u8
#EXTINF:-1 tvg-id="horizonte" group-title="Noticias",Canal Horizonte
https://streams.test/horizonte.ts
#EXTINF:-1 group-title="Cine",Cine Nocturno
https://streams.test/cine.mp4
`;

export const FIXTURE_EPG = (now = Date.now()) => {
  const stamp = (offset: number) => {
    const date = new Date(now + offset);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00 +0000`;
  };
  return `<tv><channel id="aurora"><display-name>Canal Aurora</display-name></channel>
<programme start="${stamp(-600_000)}" stop="${stamp(1_200_000)}" channel="aurora"><title>Boletín abierto</title></programme>
<programme start="${stamp(1_200_000)}" stop="${stamp(3_000_000)}" channel="aurora"><title>Debate</title></programme></tv>`;
};

let counter = 0;

export async function installTestEngine(
  responses: Record<string, string> = {
    'https://lists.test/demo.m3u': FIXTURE_PLAYLIST,
    'https://guide.test/epg.xml': FIXTURE_EPG(),
  },
): Promise<{ engine: OrivueEngine; opened: StreamHandle[] }> {
  counter += 1;
  const enginePlatform: EnginePlatform = {
    name: 'browser',
    kv: memoryKeyValueStore(),
    fetchText: (url) => {
      const body = responses[url];
      return body === undefined
        ? Promise.reject(new Error(`HTTP 404 for ${url}`))
        : Promise.resolve(body);
    },
  };
  const opened: StreamHandle[] = [];
  const platform: AppPlatform = {
    engine: enginePlatform,
    native: null,
    device: () =>
      Promise.resolve({
        platform: 'test',
        tauri: false,
        mobile: false,
        tv: false,
        touchscreen: false,
        nativePlayer: false,
        version: 'test',
      }),
    playback: {
      open: (playable) => {
        const handle: StreamHandle = {
          id: `h${opened.length + 1}`,
          url: playable.url,
          upstreamUrl: playable.url,
          kind: playable.kind,
          headers: playable.headers,
          contentType: null,
        };
        opened.push(handle);
        return Promise.resolve(handle);
      },
      close: () => Promise.resolve(),
    },
    onBack: () => () => undefined,
  };
  const engine = new OrivueEngine({
    platform: enginePlatform,
    databaseName: `web-test-${counter}`,
  });
  await engine.init();
  setEngineForTests(engine, platform, await platform.device());
  return { engine, opened };
}
