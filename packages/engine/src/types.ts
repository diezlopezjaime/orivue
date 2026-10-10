import type { XtreamAccountInfo, XtreamOutput } from '@orivue/xtream';

export type SourceKind = 'm3u' | 'xtream' | 'file';
export type SourceStatus = 'pending' | 'ready' | 'error';

export interface XtreamSourceConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly output: XtreamOutput;
}

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  /** Playlist URL for `m3u` sources. Never shown unredacted. */
  readonly url: string | null;
  readonly xtream: XtreamSourceConfig | null;
  readonly epgUrl: string | null;
  readonly autoRefreshMinutes: number;
  readonly status: SourceStatus;
  readonly lastUpdatedAt: string | null;
  readonly lastError: string | null;
  readonly epgStatus: SourceStatus;
  readonly epgUpdatedAt: string | null;
  readonly epgError: string | null;
  readonly channelCount: number;
  readonly programCount: number;
  readonly account: XtreamAccountInfo | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Public shape of a source: identical to {@link Source} but with secrets redacted. */
export type PublicSource = Omit<Source, 'url' | 'xtream'> & {
  readonly url: string | null;
  readonly xtream: Omit<XtreamSourceConfig, 'password'> | null;
};

export type AddSourceInput =
  | {
      kind: 'm3u';
      name: string;
      url: string;
      epgUrl?: string | undefined;
      autoRefreshMinutes?: number | undefined;
    }
  | {
      kind: 'xtream';
      name: string;
      host: string;
      username: string;
      password: string;
      output?: XtreamOutput | undefined;
      autoRefreshMinutes?: number | undefined;
    }
  | { kind: 'file'; name: string; content: string; epgUrl?: string | undefined };

export interface UpdateSourceInput {
  name?: string | undefined;
  url?: string | null | undefined;
  epgUrl?: string | null | undefined;
  autoRefreshMinutes?: number | undefined;
  output?: XtreamOutput | undefined;
}

export interface StoredChannel {
  readonly id: string;
  readonly sourceId: string;
  readonly order: number;
  readonly name: string;
  readonly url: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly tvgId: string | null;
  readonly logo: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Channel {
  readonly id: string;
  readonly sourceId: string;
  readonly number: number;
  readonly name: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly tvgId: string | null;
  readonly logo: string | null;
  readonly favorite: boolean;
  readonly hidden: boolean;
  readonly lastPlayedAt: string | null;
  readonly streamKind: StreamKind;
}

export interface Group {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly channelCount: number;
  readonly hidden: boolean;
}

export interface Program {
  readonly id: string;
  readonly sourceId: string;
  readonly epgKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly startAt: string;
  readonly stopAt: string;
}

export interface NowNext {
  readonly channelId: string;
  readonly current: Program | null;
  readonly next: Program | null;
}

export interface TimelineRow {
  readonly channel: Channel;
  readonly programs: Program[];
}

export interface ChannelQuery {
  sourceId?: string | undefined;
  groupId?: string | undefined;
  search?: string | undefined;
  favorite?: boolean | undefined;
  recent?: boolean | undefined;
  includeHidden?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ChannelPage {
  readonly items: Channel[];
  readonly total: number;
}

export type StreamKind = 'hls' | 'mpegts' | 'http' | 'acestream' | 'unknown';

export interface PlayableStream {
  readonly channel: Channel;
  /** Upstream URL, possibly containing credentials. Only handed to the platform layer. */
  readonly url: string;
  readonly kind: StreamKind;
  readonly headers: Readonly<Record<string, string>>;
  /** Loopback destinations are only acceptable for local engines such as Ace Stream. */
  readonly allowLoopback: boolean;
}

export interface LibraryState {
  favorites: Record<string, string>;
  recents: Record<string, { playedAt: string; count: number }>;
  hiddenChannels: Record<string, true>;
  hiddenGroups: Record<string, true>;
  customNames: Record<string, string>;
  epgMappings: Record<string, string>;
}

export interface EngineSettings {
  allowPrivateNetwork: boolean;
  epgHorizonHours: number;
  maxPlaylistBytes: number;
  maxEpgBytes: number;
}

export type EngineEvent =
  | { type: 'sources' }
  | { type: 'channels'; sourceId: string }
  | { type: 'epg'; sourceId: string }
  | { type: 'library' }
  | { type: 'refresh'; sourceId: string; phase: 'start' | 'done' | 'error' };

export type EngineListener = (event: EngineEvent) => void;

export interface RefreshResult {
  readonly channelCount: number;
  readonly programCount: number;
  readonly warnings: string[];
}
