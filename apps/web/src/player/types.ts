import type { StreamHandle } from '../platform';
import type { PlaybackStatus } from '../types';

export interface PlayerTrack {
  id: string;
  label: string;
}

export interface PlayerTracks {
  audio: PlayerTrack[];
  text: PlayerTrack[];
}

export interface PlayerCallbacks {
  onStatus(status: PlaybackStatus, message?: string): void;
  onTracks(tracks: PlayerTracks): void;
}

export type AspectMode = 'contain' | 'cover' | 'fill';

export interface Player {
  readonly kind: 'web' | 'native';
  load(stream: StreamHandle, title: string): Promise<void>;
  stop(): Promise<void>;
  setVolume(volume: number, muted: boolean): void;
  setPaused(paused: boolean): void;
  setAspect(mode: AspectMode): void;
  selectTrack(kind: 'audio' | 'text', id: string | null): void;
  destroy(): void;
}
