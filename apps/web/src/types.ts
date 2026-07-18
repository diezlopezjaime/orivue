export interface Playlist {
  id: string;
  name: string;
  url?: string;
  channelCount?: number;
  status?: 'ready' | 'updating' | 'error' | 'pending';
  lastUpdatedAt?: string | null;
  error?: string | null;
}

export interface Group {
  id: string;
  name: string;
  channelCount?: number;
  hidden?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  number?: number | null;
  logoUrl?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  tvgId?: string | null;
  streamUrl?: string;
  favorite?: boolean;
  hidden?: boolean;
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

export interface PlaybackSession {
  id: string;
  url: string;
  type?: 'hls' | 'http';
  headers?: Record<string, string>;
}

export type PlaybackStatus = 'idle' | 'connecting' | 'buffering' | 'playing' | 'retrying' | 'error';
