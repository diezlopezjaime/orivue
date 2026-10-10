/**
 * Thin facade between the React pages and the engine. It keeps view models
 * stable (logo → logoUrl, now/next attached) so pages do not depend on the
 * engine internals.
 */
import type {
  AddSourceInput,
  Channel as EngineChannel,
  EngineSettings,
  Program as EngineProgram,
} from '@orivue/engine';
import type { XtreamOutput } from '@orivue/xtream';
import { getEngine } from './engine';
import type { Channel, Group, Playlist, Program, TimelineChannel } from './types';

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
    await engine.refreshSource(source.id);
    return engine.getSource(source.id) ?? source;
  },

  async createXtream(input: CreateXtreamInput): Promise<Playlist> {
    const engine = getEngine();
    const source = await engine.addSource({ kind: 'xtream', ...input } satisfies AddSourceInput);
    await engine.refreshSource(source.id);
    return engine.getSource(source.id) ?? source;
  },

  validateXtream: (host: string, username: string, password: string) =>
    getEngine().validateXtream(host, username, password),

  async importPlaylist(name: string, file: File): Promise<Playlist> {
    const engine = getEngine();
    const content = await file.text();
    const source = await engine.addSource({ kind: 'file', name: name || file.name, content });
    await engine.refreshSource(source.id);
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

  settings: (): EngineSettings => getEngine().getSettings(),
  updateSettings: (patch: Partial<EngineSettings>) => getEngine().updateSettings(patch),
};
