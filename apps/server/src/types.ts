export interface PlaylistRecord {
  id: string;
  name: string;
  url: string | null;
  epgUrl: string | null;
  autoRefreshMinutes: number;
  status: 'pending' | 'ready' | 'error';
  lastUpdatedAt: string | null;
  lastError: string | null;
  channelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRecord {
  id: string;
  playlistId: string;
  groupId: string | null;
  groupName: string | null;
  tvgId: string | null;
  name: string;
  logo: string | null;
  streamUrl: string;
  headers: Record<string, string>;
  hidden: boolean;
  favorite: boolean;
  lastPlayedAt: string | null;
  currentProgram?: ProgramRecord | null;
  nextProgram?: ProgramRecord | null;
}

export interface ProgramRecord {
  id: string;
  epgChannelId: string;
  title: string;
  description: string | null;
  startAt: string;
  stopAt: string;
}

export interface PlaybackSession {
  id: string;
  channelId: string;
  sourceUrl: string;
  playableUrl: string;
  allowedOrigins: string[];
  resolver: string;
  state: 'connecting' | 'playing' | 'stopped' | 'error';
  createdAt: string;
  abortController: AbortController;
  stop?: () => Promise<void>;
}
