import type { EnginePlatform, PlayableStream, StreamKind } from '@orivue/engine';

export interface StreamHandle {
  readonly id: string;
  /** URL the web player loads (loopback proxy under Tauri, direct URL in the browser). */
  readonly url: string;
  /** Upstream URL for native players that fetch on their own. */
  readonly upstreamUrl: string;
  readonly kind: StreamKind;
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string | null;
}

export interface PlaybackBridge {
  open(playable: PlayableStream): Promise<StreamHandle>;
  close(id: string): Promise<void>;
}

export interface DeviceInfo {
  readonly platform: string;
  readonly tauri: boolean;
  readonly mobile: boolean;
  readonly tv: boolean;
  readonly touchscreen: boolean;
  readonly nativePlayer: boolean;
  readonly version: string;
}

export interface NativeTrack {
  readonly id: string;
  readonly label: string;
  readonly language?: string | null;
  readonly selected?: boolean;
}

export type NativePlayerEvent =
  | {
      type: 'state';
      state: 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
      message?: string;
    }
  | { type: 'tracks'; audio: NativeTrack[]; text: NativeTrack[] };

export interface NativePlayerApi {
  load(request: {
    url: string;
    headers: Readonly<Record<string, string>>;
    kind: StreamKind;
    title: string;
  }): Promise<void>;
  stop(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  setVolume(volume: number, muted: boolean): Promise<void>;
  setAspect(mode: 'contain' | 'cover' | 'fill'): Promise<void>;
  selectTrack(kind: 'audio' | 'text', id: string | null): Promise<void>;
  getTracks(): Promise<{ audio: NativeTrack[]; text: NativeTrack[] }>;
  subscribe(listener: (event: NativePlayerEvent) => void): Promise<() => void>;
}

export interface AppPlatform {
  readonly engine: EnginePlatform;
  readonly playback: PlaybackBridge;
  readonly native: NativePlayerApi | null;
  device(): Promise<DeviceInfo>;
  /** Enables hardware back interception and delivers presses to the handler. */
  onBack(handler: () => void): () => void;
  /** Leaves the application where the platform allows it (Android, Fire TV). */
  exit(): Promise<void>;
}
