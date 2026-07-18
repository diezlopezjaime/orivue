import type { Channel, Group, PlaybackSession, Playlist, Program, TimelineChannel } from './types';

let apiRoot = '/api';
let localApiToken: string | undefined;

export async function initializeApiConnection(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window) || window.location.port === '5173') return;
  const { invoke } = await import('@tauri-apps/api/core');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const connection = await invoke<{ baseUrl: string; token: string }>('service_connection');
      const url = new URL(connection.baseUrl);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
        throw new Error('Unsafe local service address');
      if (!connection.token || connection.token.length < 16)
        throw new Error('Invalid local service token');
      apiRoot = `${url.origin}/api`;
      localApiToken = connection.token;
      return;
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }
  throw new Error('El servicio local no pudo iniciarse. Reinicia Orivue e inténtalo de nuevo.');
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object') {
    if ('data' in value) return (value as { data: T }).data;
    if ('items' in value) return (value as { items: T }).items;
  }
  return value as T;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function normalizeProgram(value: unknown, channelId: string): Program {
  const raw = record(value);
  const id = typeof raw.id === 'string' ? raw.id : undefined;
  return {
    ...(id ? { id } : {}),
    channelId,
    title: textValue(raw.title, 'Sin título'),
    description: typeof raw.description === 'string' ? raw.description : null,
    startsAt: textValue(raw.startsAt ?? raw.startAt, new Date().toISOString()),
    endsAt: textValue(raw.endsAt ?? raw.stopAt, new Date().toISOString()),
  };
}

function normalizeChannel(value: unknown): Channel {
  const raw = record(value);
  return {
    ...(raw as unknown as Channel),
    id: String(raw.id),
    name: textValue(raw.name, 'Canal sin nombre'),
    logoUrl:
      typeof raw.logoUrl === 'string'
        ? raw.logoUrl
        : typeof raw.logo === 'string'
          ? raw.logo
          : null,
  };
}

function normalizePlaylist(value: unknown): Playlist {
  const raw = record(value);
  return {
    ...(raw as unknown as Playlist),
    id: String(raw.id),
    name: textValue(raw.name, 'Lista'),
    error:
      typeof raw.lastError === 'string'
        ? raw.lastError
        : typeof raw.error === 'string'
          ? raw.error
          : null,
  };
}

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  if (localApiToken) headers.set('x-orivue-token', localApiToken);
  const requestInit: RequestInit = { ...init, headers, credentials: 'same-origin' };
  if (signal) requestInit.signal = signal;
  const response = await fetch(`${apiRoot}${path}`, requestInit);
  if (!response.ok) {
    let message = `La solicitud ha fallado (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* The status is enough when there is no JSON body. */
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return unwrap<T>(await response.json());
}

function params(input: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== '') query.set(key, String(value));
  const output = query.toString();
  return output ? `?${output}` : '';
}

export const api = {
  playlists: async () => (await request<unknown[]>('/playlists')).map(normalizePlaylist),
  createPlaylist: async (input: { name: string; url: string; epgUrl?: string }) => {
    const result = record(
      await request<unknown>('/playlists', { method: 'POST', body: JSON.stringify(input) }),
    );
    return normalizePlaylist(result.playlist ?? result);
  },
  importPlaylist: async (name: string, file: File) => {
    const content = await file.text();
    const result = record(
      await request<unknown>('/playlists', {
        method: 'POST',
        body: JSON.stringify({ name, content }),
      }),
    );
    return normalizePlaylist(result.playlist ?? result);
  },
  updatePlaylist: async (id: string, input: Partial<Pick<Playlist, 'name' | 'url'>>) => {
    const result = record(
      await request<unknown>(`/playlists/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
    return normalizePlaylist(result.playlist ?? result);
  },
  deletePlaylist: (id: string) =>
    request<void>(`/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  refreshPlaylist: (id: string) =>
    request<Playlist>(`/playlists/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
  groups: () => request<Group[]>('/groups'),
  channels: async (input: {
    groupId?: string | undefined;
    search?: string | undefined;
    favorite?: boolean | undefined;
    recent?: boolean | undefined;
  }) => {
    const channels = (await request<unknown[]>(`/channels${params({ ...input, limit: 500 })}`)).map(
      normalizeChannel,
    );
    if (!channels.length) return channels;
    const epg = await request<unknown[]>('/epg/now').catch(() => []);
    const byId = new Map(epg.map((value) => [String(record(value).channelId), record(value)]));
    return channels.map((channel) => {
      const item = byId.get(channel.id);
      if (!item) return channel;
      return {
        ...channel,
        now: item.current ? normalizeProgram(item.current, channel.id) : null,
        next: item.next ? normalizeProgram(item.next, channel.id) : null,
      };
    });
  },
  favorite: (id: string, active: boolean) =>
    request<void>(`/favorites/${encodeURIComponent(id)}`, { method: active ? 'POST' : 'DELETE' }),
  now: async () =>
    (await request<unknown[]>('/epg/now')).flatMap((value) => {
      const raw = record(value);
      const channelId = String(raw.channelId);
      return [raw.current, raw.next]
        .filter(Boolean)
        .map((program) => normalizeProgram(program, channelId));
    }),
  timeline: async (from: string, to: string): Promise<TimelineChannel[]> => {
    const [timeline, channels] = await Promise.all([
      request<unknown[]>(`/epg/timeline${params({ from, to })}`),
      request<unknown[]>(`/channels${params({ limit: 200 })}`),
    ]);
    const programs = new Map(
      timeline.map((value) => {
        const raw = record(value);
        const channelId = String(raw.channelId);
        return [
          channelId,
          Array.isArray(raw.programs)
            ? raw.programs.map((program) => normalizeProgram(program, channelId))
            : [],
        ] as const;
      }),
    );
    return channels
      .map(normalizeChannel)
      .map((channel) => ({ channel, programs: programs.get(channel.id) ?? [] }));
  },
  createPlayback: async (channelId: string, signal: AbortSignal) => {
    const result = record(
      await request<unknown>(
        '/playback/sessions',
        { method: 'POST', body: JSON.stringify({ channelId }) },
        signal,
      ),
    );
    const session = record(result.session ?? result);
    const streamUrl = String(session.url ?? session.streamUrl);
    return {
      id: String(session.id),
      url: localApiToken ? new URL(streamUrl, apiRoot).toString() : streamUrl,
      type: session.type === 'http' || session.resolver === 'http' ? 'http' : 'hls',
    } satisfies PlaybackSession;
  },
  stopPlayback: (id: string) =>
    request<void>(`/playback/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
