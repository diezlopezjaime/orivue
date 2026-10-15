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
  /** Only for on-demand streams; seconds. */
  onPosition(position: number, duration: number): void;
}

export type AspectMode = 'contain' | 'cover' | 'fill';

/** Live figures for the diagnostics panel (key I). */
export interface PlayerStats {
  /** Seconds of media buffered ahead of the playhead. */
  bufferedSeconds: number;
  /** Download speed reported by the demuxer, KB/s; null when unknown. */
  speedKBps: number | null;
  decodedFrames: number | null;
  droppedFrames: number | null;
  playbackRate: number;
}

export interface Player {
  readonly kind: 'web' | 'native';
  load(stream: StreamHandle, title: string): Promise<void>;
  stop(): Promise<void>;
  setVolume(volume: number, muted: boolean): void;
  setPaused(paused: boolean): void;
  setAspect(mode: AspectMode): void;
  seek(positionSeconds: number): void;
  selectTrack(kind: 'audio' | 'text', id: string | null): void;
  getStats?(): PlayerStats | undefined;
  destroy(): void;
}
