import {
  refineStreamKind,
  type EnginePlatform,
  type FetchedGuide,
  type PlayableStream,
} from '@orivue/engine';
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type {
  AppPlatform,
  DeviceInfo,
  NativePlayerApi,
  NativePlayerEvent,
  NativeTrack,
  StreamHandle,
} from './types';

interface RustDeviceInfo {
  platform: string;
  version: string;
  mobile: boolean;
  debug: boolean;
}

interface SessionInfo {
  id: string;
  url: string;
  contentType: string | null;
  status: number;
}

interface NativeDeviceInfo {
  tv: boolean;
  touchscreen: boolean;
  manufacturer: string;
  model: string;
  playerAvailable: boolean;
}

function message(error: unknown): string {
  return typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
}

function createEnginePlatform(): EnginePlatform {
  return {
    name: 'tauri',
    kv: {
      async get<T>(key: string) {
        const raw = await invoke<string | null>('kv_get', { key });
        if (raw === null || raw === undefined) return undefined;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return undefined;
        }
      },
      set: (key, value) => invoke<void>('kv_set', { key, value: JSON.stringify(value) }),
      delete: (key) => invoke<void>('kv_delete', { key }),
    },
    async fetchText(url, options = {}) {
      try {
        const bytes = await invoke<ArrayBuffer | Uint8Array>('fetch_source', {
          args: {
            url,
            headers: options.headers ?? {},
            maxBytes: options.maxBytes,
            timeoutMs: options.timeoutMs,
            allowPrivate: options.allowPrivateNetwork ?? false,
          },
        });
        return new TextDecoder().decode(bytes);
      } catch (error) {
        throw new Error(message(error));
      }
    },
    async fetchGuide(url, options) {
      try {
        const bytes = await invoke<ArrayBuffer | Uint8Array>('fetch_epg', {
          args: {
            url,
            headers: options.headers ?? {},
            sinceMs: Math.floor(options.sinceMs),
            untilMs: Math.ceil(options.untilMs),
            timeoutMs: options.timeoutMs,
            allowPrivate: options.allowPrivateNetwork ?? false,
          },
        });
        return JSON.parse(new TextDecoder().decode(bytes)) as FetchedGuide;
      } catch (error) {
        throw new Error(message(error));
      }
    },
  };
}

function createNativeApi(): NativePlayerApi {
  const call = <T>(command: string, request?: unknown) =>
    invoke<T>(`plugin:orivue-native|${command}`, request === undefined ? {} : { request });
  return {
    load: (request) => call<void>('load', request),
    stop: () => call<void>('stop'),
    seek: (positionSeconds) => call<void>('seek', { positionSeconds }),
    setPaused: (paused) => call<void>('set_paused', { paused }),
    setVolume: (volume, muted) => call<void>('set_volume', { volume, muted }),
    setAspect: (mode) => call<void>('set_aspect', { mode }),
    selectTrack: (kind, id) => call<void>('select_track', { kind, id }),
    getTracks: () => call<{ audio: NativeTrack[]; text: NativeTrack[] }>('get_tracks'),
    async subscribe(listener) {
      const unlistenState = await addPluginListener<{ state: string; message?: string }>(
        'orivue-native',
        'state',
        (payload) =>
          listener({
            type: 'state',
            state: payload.state as Extract<NativePlayerEvent, { type: 'state' }>['state'],
            ...(payload.message ? { message: payload.message } : {}),
          }),
      );
      const unlistenPosition = await addPluginListener<{ position: number; duration: number }>(
        'orivue-native',
        'position',
        (payload) =>
          listener({ type: 'position', position: payload.position, duration: payload.duration }),
      );
      const unlistenTracks = await addPluginListener<{ audio: NativeTrack[]; text: NativeTrack[] }>(
        'orivue-native',
        'tracks',
        (payload) => listener({ type: 'tracks', audio: payload.audio, text: payload.text }),
      );
      return () => {
        void unlistenState.unregister();
        void unlistenPosition.unregister();
        void unlistenTracks.unregister();
      };
    },
  };
}

export async function createTauriPlatform(): Promise<AppPlatform> {
  const info = await invoke<RustDeviceInfo>('device_info');
  let nativeInfo: NativeDeviceInfo | null = null;
  if (info.mobile) {
    try {
      nativeInfo = await invoke<NativeDeviceInfo>('plugin:orivue-native|get_device_info', {});
    } catch {
      nativeInfo = null;
    }
  }
  const device: DeviceInfo = {
    platform: info.platform,
    tauri: true,
    mobile: info.mobile,
    tv: nativeInfo?.tv ?? false,
    touchscreen: (nativeInfo?.touchscreen ?? !info.mobile) ? false : true,
    nativePlayer: nativeInfo?.playerAvailable ?? false,
    version: info.version,
  };
  const native = device.nativePlayer ? createNativeApi() : null;
  let backListeners = 0;
  return {
    engine: createEnginePlatform(),
    native,
    device: () => Promise.resolve(device),
    playback: {
      async open(playable: PlayableStream): Promise<StreamHandle> {
        let session: SessionInfo;
        try {
          session = await invoke<SessionInfo>('open_playback', {
            request: {
              url: playable.url,
              headers: playable.headers,
              allowLoopback: playable.allowLoopback,
              allowPrivate: playable.allowLoopback && playable.kind !== 'acestream',
            },
          });
        } catch (error) {
          throw new Error(message(error));
        }
        return {
          id: session.id,
          url: session.url,
          title: playable.title,
          live: playable.live,
          upstreamUrl: playable.url,
          kind: refineStreamKind(
            playable.kind === 'acestream' ? 'unknown' : playable.kind,
            session.contentType,
          ),
          headers: playable.headers,
          contentType: session.contentType,
        };
      },
      async close(id) {
        await invoke<boolean>('close_playback', { id }).catch(() => false);
      },
    },
    async exit() {
      if (!info.mobile) return;
      await invoke('plugin:orivue-native|exit_app', {}).catch(() => undefined);
    },
    onBack(handler) {
      if (!info.mobile) return () => undefined;
      let active = true;
      backListeners += 1;
      void invoke('plugin:orivue-native|set_back_handling', { request: { enabled: true } }).catch(
        () => undefined,
      );
      const subscription = addPluginListener('orivue-native', 'back', () => {
        if (active) handler();
      });
      return () => {
        active = false;
        backListeners -= 1;
        void subscription.then((listener) => listener.unregister());
        if (backListeners === 0)
          void invoke('plugin:orivue-native|set_back_handling', {
            request: { enabled: false },
          }).catch(() => undefined);
      };
    },
  };
}
