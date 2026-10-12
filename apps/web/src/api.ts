/**
 * Thin facade between the React pages and the engine. It keeps view models
 * stable (logo → logoUrl, now/next attached) so pages do not depend on the
 * engine internals.
 */
import type {
  AddSourceInput,
  Channel as EngineChannel,
  ConfigExport,
  ConfigImportResult,
  EngineSettings,
  Program as EngineProgram,
  VodKind,
  VodQuery,
} from '@orivue/engine';
import { safeError } from '@orivue/engine';
import type { XtreamOutput } from '@orivue/xtream';
import { getEngine } from './engine';
import type { Channel, Group, Playlist, Program, TimelineChannel } from './types';

/**
 * Runs the first import of a source and resolves as soon as its channels are
 * stored. The catalogue and the guide keep loading in the background and the
 * list card reports their progress, so a large guide never blocks the form.
 */
function importUntilChannels(id: string): Promise<void> {
  const engine = getEngine();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (error === undefined) resolve();
      else reject(error instanceof Error ? error : new Error(safeError(error)));
    };
    const unsubscribe = engine.subscribe((event) => {
      if (event.type === 'channels' && event.sourceId === id) finish();
    });
    engine.refreshSource(id).then(
      () => finish(),
      (error: unknown) => finish(error),
    );
  });
}

function toProgram(program: EngineProgram, channelId: string): Program {
  return {
    id: program.id,
    channelId,
    title: program.title,
    description: program.description,
    startsAt: program.startAt,
    endsAt: program.stopAt,
  };
}

function toChannel(channel: EngineChannel): Channel {
  return {
    id: channel.id,
    sourceId: channel.sourceId,
    name: channel.name,
    number: channel.number,
    logoUrl: channel.logo,
    groupId: channel.groupId,
    groupName: channel.groupName,
    tvgId: channel.tvgId,
    favorite: channel.favorite,
    hidden: channel.hidden,
    streamKind: channel.streamKind,
  };
}

async function attachEpg(channels: Channel[]): Promise<Channel[]> {
  if (!channels.length) return channels;
  const nowNext = await getEngine().epgNow(channels.map((channel) => channel.id));
  const byId = new Map(nowNext.map((item) => [item.channelId, item]));
  return channels.map((channel) => {
    const item = byId.get(channel.id);
    if (!item) return channel;
    return {
      ...channel,
      now: item.current ? toProgram(item.current, channel.id) : null,
      next: item.next ? toProgram(item.next, channel.id) : null,
    };
  });
}

export interface CreatePlaylistInput {
  name: string;
  url: string;
  epgUrl?: string | undefined;
}

export interface CreateXtreamInput {
  name: string;
  host: string;
  username: string;
  password: string;
  output?: XtreamOutput | undefined;
}

export const api = {
  playlists: (): Promise<Playlist[]> => Promise.resolve(getEngine().listSources()),

  async createPlaylist(input: CreatePlaylistInput): Promise<Playlist> {
    const engine = getEngine();
    const source = await engine.addSource({
      kind: 'm3u',
      name: input.name,
      url: input.url,
      epgUrl: input.epgUrl,
    });
    await importUntilChannels(source.id);
    return engine.getSource(source.id) ?? source;
  },

  async createXtream(input: CreateXtreamInput): Promise<Playlist> {
    const engine = getEngine();
    const source = await engine.addSource({ kind: 'xtream', ...input } satisfies AddSourceInput);
    await importUntilChannels(source.id);
    return engine.getSource(source.id) ?? source;
  },

  validateXtream: (host: string, username: string, password: string) =>
    getEngine().validateXtream(host, username, password),

  async importPlaylist(name: string, file: File): Promise<Playlist> {
    const engine = getEngine();
    const content = await file.text();
    const source = await engine.addSource({ kind: 'file', name: name || file.name, content });
    await importUntilChannels(source.id);
    return engine.getSource(source.id) ?? source;
  },

  updatePlaylist: (
    id: string,
    input: {
      name?: string;
      url?: string | null;
      epgUrl?: string | null;
      autoRefreshMinutes?: number;
    },
  ) => getEngine().updateSource(id, input),

  deletePlaylist: async (id: string): Promise<void> => {
    await getEngine().removeSource(id);
  },

  refreshPlaylist: (id: string) => getEngine().refreshSource(id),
  refreshEpg: (id: string) => getEngine().refreshEpg(id),

  groups: (): Promise<Group[]> =>
    Promise.resolve(
      getEngine()
        .listGroups()
        .map((group) => ({
          id: group.id,
          name: group.name,
          channelCount: group.channelCount,
          hidden: group.hidden,
        })),
    ),

  async channels(input: {
    groupId?: string | undefined;
    search?: string | undefined;
    favorite?: boolean | undefined;
    recent?: boolean | undefined;
    hiddenOnly?: boolean | undefined;
  }): Promise<Channel[]> {
    const page = getEngine().listChannels({ ...input, limit: 2000 });
    return attachEpg(page.items.map(toChannel));
  },

  async channel(id: string): Promise<Channel | undefined> {
    const channel = getEngine().getChannel(id);
    if (!channel) return undefined;
    return (await attachEpg([toChannel(channel)]))[0];
  },

  favorite: async (id: string, active: boolean): Promise<void> => {
    await getEngine().setFavorite(id, active);
  },

  hideChannel: async (id: string, hidden: boolean): Promise<void> => {
    await getEngine().setChannelHidden(id, hidden);
  },

  hideGroup: (id: string, hidden: boolean) => getEngine().setGroupHidden(id, hidden),

  renameChannel: (id: string, name: string | null) => getEngine().renameChannel(id, name),

  mapEpg: (id: string, epgChannelId: string | null) => getEngine().mapEpg(id, epgChannelId),

  epgChannels: (sourceId: string) => getEngine().listEpgChannels(sourceId),

  epgKeyFor: (id: string) => getEngine().epgKeyFor(id),

  async timeline(from: string, to: string): Promise<TimelineChannel[]> {
    const engine = getEngine();
    const channels = engine.listChannels({ limit: 200 }).items;
    const rows = await engine.timeline(
      from,
      to,
      channels.map((channel) => channel.id),
    );
    return rows.map((row) => ({
      channel: toChannel(row.channel),
      programs: row.programs.map((program) => toProgram(program, row.channel.id)),
    }));
  },

  playable: (channelId: string) => getEngine().getPlayable(channelId),

  vodCategories: (kind: VodKind) => getEngine().listVodCategories(kind),
  vod: (query: VodQuery) => getEngine().listVod(query),
  vodItem: (id: string) => getEngine().getVod(id),
  seriesInfo: (id: string) => getEngine().getSeriesInfo(id),
  playableVod: (id: string, episodeId?: string) => getEngine().getPlayableVod(id, episodeId),

  setIncludedGroups: (id: string, groups: string[] | null) =>
    getEngine().setIncludedGroups(id, groups),
  exportConfig: (includeCredentials: boolean): ConfigExport =>
    getEngine().exportConfig({ includeCredentials }),
  importConfig: (text: string): Promise<ConfigImportResult> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return Promise.reject(new Error('The text is not valid JSON'));
    }
    return getEngine().importConfig(parsed);
  },
  settings: (): EngineSettings => getEngine().getSettings(),
  updateSettings: (patch: Partial<EngineSettings>) => getEngine().updateSettings(patch),
};
