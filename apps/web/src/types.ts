import type { Episode, PublicSource, StreamKind, VodItem } from '@orivue/engine';

export type { Episode, SeriesInfo, VodCategory, VodItem, VodKind } from '@orivue/engine';

export interface VodTarget {
  item: VodItem;
  episode?: Episode | undefined;
}

export type Playlist = PublicSource;

export interface Group {
  id: string;
  name: string;
  channelCount?: number;
  hidden?: boolean;
}

export interface Channel {
  id: string;
  sourceId?: string;
  name: string;
  number?: number | null;
  logoUrl?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  tvgId?: string | null;
  favorite?: boolean;
  hidden?: boolean;
  streamKind?: StreamKind;
  now?: Program | null;
  next?: Program | null;
}

export interface Program {
  id?: string;
  channelId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
}

export interface TimelineChannel {
  channel: Channel;
  programs: Program[];
}

export type PlaybackStatus = 'idle' | 'connecting' | 'buffering' | 'playing' | 'retrying' | 'error';
