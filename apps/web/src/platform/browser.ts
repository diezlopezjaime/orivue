import { browserPlatform, detectStreamKind, type PlayableStream } from '@orivue/engine';
import type { AppPlatform, DeviceInfo, StreamHandle } from './types';

const TV_AGENT = /AFT[A-Z0-9]|Android TV|SmartTV|SMART-TV|BRAVIA|Fire ?TV|CrKey|Tizen|Web0S/i;

export function detectTvFromBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (TV_AGENT.test(navigator.userAgent)) return true;
  const coarse = window.matchMedia?.('(pointer: none), (hover: none) and (pointer: coarse)');
  return Boolean(coarse?.matches && window.innerWidth >= 1200 && !('ontouchstart' in window));
}

/**
 * Plain browser: used by `vite dev`, Playwright and any static deployment.
 * Sources are fetched through the Vite development proxy when available and
 * directly otherwise, so CORS decides what works.
 */
export function createBrowserPlatform(): AppPlatform {
  const dev = import.meta.env.DEV;
  const engine = browserPlatform({
    ...(dev ? { proxyPrefix: '/__orivue/fetch?url=' } : {}),
  });
  let counter = 0;
  const device: DeviceInfo = {
    platform: 'browser',
    tauri: false,
    mobile: /Android|iPhone|iPad/i.test(navigator.userAgent),
    tv: detectTvFromBrowser(),
    touchscreen: 'ontouchstart' in window,
    nativePlayer: false,
    version:
      typeof import.meta.env.VITE_APP_VERSION === 'string'
        ? import.meta.env.VITE_APP_VERSION
        : 'dev',
  };
  return {
    engine,
    native: null,
    device: () => Promise.resolve(device),
    playback: {
      open(playable: PlayableStream) {
        counter += 1;
        const url = dev ? `/__orivue/stream?url=${encodeURIComponent(playable.url)}` : playable.url;
        const handle: StreamHandle = {
          id: `browser-${counter}`,
          url,
          title: playable.title,
          live: playable.live,
          upstreamUrl: playable.url,
          kind: playable.kind === 'acestream' ? detectStreamKind(playable.url) : playable.kind,
          headers: playable.headers,
          contentType: null,
        };
        return Promise.resolve(handle);
      },
      close: () => Promise.resolve(),
    },
    onBack: () => () => undefined,
    exit: () => Promise.resolve(),
  };
}
