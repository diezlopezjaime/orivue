import { stableId } from '@orivue/core';
import { parseM3u } from '@orivue/m3u-parser';
import { extractAceContentId } from '@orivue/stream-resolvers';
import { parseXmltv } from '@orivue/xmltv-parser';
import {
  buildApiUrl,
  buildEpgUrl,
  buildEpisodeUrl,
  buildMovieUrl,
  buildPlaylistUrl,
  buildSeriesInfoUrl,
  createXtreamCredentials,
  fetchAccountInfo,
  isVodStreamUrl,
  parseCategories,
  parseMovies,
  parseSeriesInfo,
  parseSeriesList,
  parseXtreamUrl,
  type XtreamAccountInfo,
  type XtreamCredentials,
} from '@orivue/xtream';
import type { EnginePlatform } from './platform.js';
import { safeError, safeUrl } from './redact.js';
import { openEngineStorage, type EngineStorage } from './storage.js';
import { detectStreamKind } from './stream-kind.js';
import type {
  AddSourceInput,
  Channel,
  ChannelPage,
  ChannelQuery,
  EngineEvent,
  EngineListener,
  EngineSettings,
  Group,
  LibraryState,
  NowNext,
  PlayableStream,
  Program,
  PublicSource,
  RefreshResult,
  SeriesInfo,
  Source,
  StoredChannel,
  TimelineRow,
  UpdateSourceInput,
  VodCategory,
  VodItem,
  VodKind,
  VodQuery,
} from './types.js';

const SOURCES_KEY = 'sources';
const LIBRARY_KEY = 'library';
const SETTINGS_KEY = 'settings';
const MAX_RECENTS = 50;
const SERIES_INFO_TTL = 24 * 3_600_000;

export const DEFAULT_SETTINGS: EngineSettings = {
  allowPrivateNetwork: false,
  epgHorizonHours: 72,
  maxPlaylistBytes: 60 * 1024 * 1024,
  maxEpgBytes: 120 * 1024 * 1024,
};

function emptyLibrary(): LibraryState {
  return {
    favorites: {},
    recents: {},
    hiddenChannels: {},
    hiddenGroups: {},
    customNames: {},
    epgMappings: {},
  };
}

export interface EngineOptions {
  readonly platform: EnginePlatform;
  readonly storage?: EngineStorage | undefined;
  readonly databaseName?: string | undefined;
  readonly now?: (() => number) | undefined;
  readonly aceStreamEndpoint?: string | undefined;
  readonly randomId?: (() => string) | undefined;
}

export class OrivueEngine {
  readonly platform: EnginePlatform;
  private storage!: EngineStorage;
  private sources: Source[] = [];
  private library: LibraryState = emptyLibrary();
  private settings: EngineSettings = { ...DEFAULT_SETTINGS };
  private channelsBySource = new Map<string, StoredChannel[]>();
  private channelIndex = new Map<string, StoredChannel>();
  private vodBySource = new Map<string, VodItem[]>();
  private vodIndex = new Map<string, VodItem>();
  private epgNames = new Map<string, Record<string, string>>();
  private readonly listeners = new Set<EngineListener>();
  private readonly refreshing = new Set<string>();
  private readonly nowNextCache = new Map<string, { value: NowNext; expiresAt: number }>();
  private readonly now: () => number;
  private readonly aceStreamEndpoint: string;
  private readonly randomId: () => string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ready = false;

  constructor(private readonly options: EngineOptions) {
    this.platform = options.platform;
    this.now = options.now ?? (() => Date.now());
    this.aceStreamEndpoint = options.aceStreamEndpoint ?? 'http://127.0.0.1:6878';
    this.randomId = options.randomId ?? defaultRandomId;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    this.storage = this.options.storage ?? (await openEngineStorage(this.options.databaseName));
    const [sources, library, settings] = await Promise.all([
      this.platform.kv.get<Source[]>(SOURCES_KEY),
      this.platform.kv.get<Partial<LibraryState>>(LIBRARY_KEY),
      this.platform.kv.get<Partial<EngineSettings>>(SETTINGS_KEY),
    ]);
    this.sources = Array.isArray(sources) ? sources : [];
    this.library = { ...emptyLibrary(), ...(library ?? {}) };
    this.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    this.channelsBySource = await this.storage.readAllChannels();
    this.vodBySource = await this.storage.readAllVod();
    for (const source of this.sources) {
      if (!this.channelsBySource.has(source.id)) this.channelsBySource.set(source.id, []);
      this.epgNames.set(source.id, await this.storage.readEpgNames(source.id));
    }
    this.rebuildIndex();
    this.ready = true;
  }

  close(): void {
    this.stopAutoRefresh();
    this.storage.close();
    this.ready = false;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  // ---------------------------------------------------------------- settings

  getSettings(): EngineSettings {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<EngineSettings>): Promise<EngineSettings> {
    this.settings = { ...this.settings, ...patch };
    await this.platform.kv.set(SETTINGS_KEY, this.settings);
    this.emit({ type: 'library' });
    return this.getSettings();
  }

  // ----------------------------------------------------------------- sources

  listSources(): PublicSource[] {
    return this.sources.map((source) => this.publicSource(source));
  }

  getSource(id: string): PublicSource | undefined {
    const source = this.sources.find((item) => item.id === id);
    return source ? this.publicSource(source) : undefined;
  }

  private publicSource(source: Source): PublicSource {
    return {
      ...source,
      url: safeUrl(source.url),
      epgUrl: safeUrl(source.epgUrl),
      xtream: source.xtream
        ? {
            baseUrl: source.xtream.baseUrl,
            username: source.xtream.username,
            output: source.xtream.output,
          }
        : null,
    };
  }

  async addSource(input: AddSourceInput): Promise<PublicSource> {
    const id = `src_${this.randomId()}`;
    const now = new Date(this.now()).toISOString();
    const name = input.name.trim() || 'Lista';
    const base: Source = {
      id,
      name,
      kind: input.kind,
      url: null,
      xtream: null,
      epgUrl: null,
      autoRefreshMinutes: 0,
      status: 'pending',
      lastUpdatedAt: null,
      lastError: null,
      epgStatus: 'pending',
      epgUpdatedAt: null,
      epgError: null,
      channelCount: 0,
      programCount: 0,
      movieCount: 0,
      seriesCount: 0,
      account: null,
      createdAt: now,
      updatedAt: now,
    };
    let source: Source;
    if (input.kind === 'm3u') {
      const xtream = parseXtreamUrl(input.url);
      if (xtream) {
        const output = /output=m3u8/i.test(input.url) ? 'm3u8' : 'ts';
        source = {
          ...base,
          kind: 'xtream',
          xtream: { ...xtream, output },
          autoRefreshMinutes: input.autoRefreshMinutes ?? 720,
          epgUrl: input.epgUrl?.trim() || buildEpgUrl(xtream),
        };
      } else {
        assertHttpUrl(input.url);
        if (input.epgUrl) assertHttpUrl(input.epgUrl);
        source = {
          ...base,
          url: input.url.trim(),
          epgUrl: input.epgUrl?.trim() || null,
          autoRefreshMinutes: input.autoRefreshMinutes ?? 720,
        };
      }
    } else if (input.kind === 'xtream') {
      const credentials = createXtreamCredentials(input.host, input.username, input.password);
      source = {
        ...base,
        xtream: { ...credentials, output: input.output ?? 'ts' },
        epgUrl: buildEpgUrl(credentials),
        autoRefreshMinutes: input.autoRefreshMinutes ?? 720,
      };
    } else {
      if (!input.content.trim()) throw new Error('The file is empty');
      if (input.epgUrl) assertHttpUrl(input.epgUrl);
      await this.storage.writeSourceContent(id, input.content);
      source = { ...base, epgUrl: input.epgUrl?.trim() || null };
    }
    this.sources = [source, ...this.sources];
    this.channelsBySource.set(id, []);
    this.epgNames.set(id, {});
    await this.persistSources();
    this.emit({ type: 'sources' });
    return this.publicSource(source);
  }

  async updateSource(id: string, patch: UpdateSourceInput): Promise<PublicSource> {
    const source = this.requireSource(id);
    if (patch.url) assertHttpUrl(patch.url);
    if (patch.epgUrl) assertHttpUrl(patch.epgUrl);
    const updated: Source = {
      ...source,
      name: patch.name?.trim() || source.name,
      url: patch.url === undefined ? source.url : patch.url,
      epgUrl: patch.epgUrl === undefined ? source.epgUrl : patch.epgUrl,
      autoRefreshMinutes: patch.autoRefreshMinutes ?? source.autoRefreshMinutes,
      xtream:
        source.xtream && patch.output ? { ...source.xtream, output: patch.output } : source.xtream,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.replaceSource(updated);
    await this.persistSources();
    this.emit({ type: 'sources' });
    return this.publicSource(updated);
  }

  async removeSource(id: string): Promise<boolean> {
    if (!this.sources.some((source) => source.id === id)) return false;
    this.sources = this.sources.filter((source) => source.id !== id);
    this.channelsBySource.delete(id);
    this.vodBySource.delete(id);
    this.epgNames.delete(id);
    await this.storage.deleteSource(id);
    this.rebuildIndex();
    await this.persistSources();
    this.emit({ type: 'sources' });
    this.emit({ type: 'channels', sourceId: id });
    return true;
  }

  async validateXtream(
    host: string,
    username: string,
    password: string,
  ): Promise<XtreamAccountInfo> {
    const credentials = createXtreamCredentials(host, username, password);
    return this.fetchAccount(credentials);
  }

  private fetchAccount(credentials: XtreamCredentials): Promise<XtreamAccountInfo> {
    return fetchAccountInfo(credentials, async (url, signal) => {
      const text = await this.platform.fetchText(url, {
        maxBytes: 512 * 1024,
        timeoutMs: 15_000,
        signal,
        allowPrivateNetwork: this.settings.allowPrivateNetwork,
      });
      return JSON.parse(text) as unknown;
    });
  }

  async refreshSource(id: string): Promise<RefreshResult> {
    const source = this.requireSource(id);
    if (this.refreshing.has(id)) throw new Error('This source is already being refreshed');
    this.refreshing.add(id);
    this.emit({ type: 'refresh', sourceId: id, phase: 'start' });
    try {
      const warnings: string[] = [];
      let content: string;
      let account: XtreamAccountInfo | null = source.account;
      if (source.kind === 'file') {
        content = (await this.storage.readSourceContent(id)) ?? '';
      } else {
        const url =
          source.kind === 'xtream'
            ? buildPlaylistUrl(source.xtream!, source.xtream!.output)
            : source.url!;
        if (source.kind === 'xtream') {
          try {
            account = await this.fetchAccount(source.xtream!);
          } catch (error) {
            if ((error as { code?: string }).code === 'auth-failed') throw error;
            warnings.push('No se pudo leer la información de la cuenta Xtream.');
          }
        }
        content = await this.platform.fetchText(url, {
          maxBytes: this.settings.maxPlaylistBytes,
          timeoutMs: 60_000,
          allowPrivateNetwork: this.settings.allowPrivateNetwork,
        });
      }
      if (!content.trim()) throw new Error('The playlist is empty');
      const parsed = parseM3u(content, { sourceId: id });
      warnings.push(...parsed.warnings.slice(0, 20).map((warning) => warning.message));
      let catalogue: { movies: VodItem[]; series: VodItem[] } | undefined;
      if (source.kind === 'xtream') {
        try {
          const fetched = await this.fetchCatalogue(source);
          // An empty catalogue means the panel does not expose VOD through the API.
          if (fetched.movies.length || fetched.series.length) catalogue = fetched;
        } catch (error) {
          warnings.push(`VOD: ${safeError(error)}`);
        }
      }
      // With a catalogue the on-demand entries of the M3U are redundant in the live list.
      const liveEntries = catalogue
        ? parsed.channels.filter((channel) => !isVodStreamUrl(channel.url))
        : parsed.channels;
      if (liveEntries.length === 0 && !catalogue)
        throw new Error('The playlist did not contain any playable channels');
      const channels: StoredChannel[] = liveEntries.map((channel, order) => {
        const groupName = channel.groupName?.trim() || 'Sin categoría';
        return {
          id: channel.id,
          sourceId: id,
          order,
          name: channel.name,
          url: channel.url,
          groupId: stableId('group', id, groupName),
          groupName,
          tvgId: channel.tvgId ?? null,
          logo: channel.logo ?? null,
          headers: channel.headers ?? {},
        };
      });
      await this.storage.writeChannels(id, channels);
      this.channelsBySource.set(id, channels);
      if (catalogue) {
        const items = [...catalogue.movies, ...catalogue.series];
        await this.storage.writeVod(id, items);
        this.vodBySource.set(id, items);
      }
      this.rebuildIndex();
      const now = new Date(this.now()).toISOString();
      let epgUrl = source.epgUrl;
      if (!epgUrl && parsed.epgUrl) epgUrl = parsed.epgUrl;
      this.replaceSource({
        ...this.requireSource(id),
        status: 'ready',
        lastUpdatedAt: now,
        lastError: null,
        channelCount: channels.length,
        movieCount: catalogue ? catalogue.movies.length : this.requireSource(id).movieCount,
        seriesCount: catalogue ? catalogue.series.length : this.requireSource(id).seriesCount,
        account,
        epgUrl,
        updatedAt: now,
      });
      await this.persistSources();
      this.emit({ type: 'sources' });
      this.emit({ type: 'channels', sourceId: id });
      if (catalogue) this.emit({ type: 'vod', sourceId: id });
      let programCount = this.requireSource(id).programCount;
      if (epgUrl) {
        try {
          const epg = await this.refreshEpgInternal(id, epgUrl);
          programCount = epg.programCount;
          warnings.push(...epg.warnings);
        } catch (error) {
          warnings.push(`EPG: ${safeError(error)}`);
        }
      }
      this.emit({ type: 'refresh', sourceId: id, phase: 'done' });
      const refreshed = this.requireSource(id);
      return {
        channelCount: channels.length,
        programCount,
        movieCount: refreshed.movieCount,
        seriesCount: refreshed.seriesCount,
        warnings,
      };
    } catch (error) {
      const now = new Date(this.now()).toISOString();
      this.replaceSource({
        ...this.requireSource(id),
        status: 'error',
        lastError: safeError(error),
        updatedAt: now,
      });
      await this.persistSources();
      this.emit({ type: 'sources' });
      this.emit({ type: 'refresh', sourceId: id, phase: 'error' });
      throw new Error(safeError(error));
    } finally {
      this.refreshing.delete(id);
    }
  }

  async refreshEpg(id: string): Promise<{ programCount: number; warnings: string[] }> {
    const source = this.requireSource(id);
    if (!source.epgUrl) throw new Error('This source has no EPG URL');
    return this.refreshEpgInternal(id, source.epgUrl);
  }

  private async refreshEpgInternal(
    id: string,
    epgUrl: string,
  ): Promise<{ programCount: number; warnings: string[] }> {
    try {
      const content = await this.platform.fetchText(epgUrl, {
        maxBytes: this.settings.maxEpgBytes,
        timeoutMs: 120_000,
        allowPrivateNetwork: this.settings.allowPrivateNetwork,
      });
      const parsed = parseXmltv(content);
      const names: Record<string, string> = {};
      for (const channel of parsed.channels)
        names[channel.id.toLowerCase()] = channel.displayNames[0] ?? channel.id;
      const horizon = this.now() + this.settings.epgHorizonHours * 3_600_000;
      const oldest = this.now() - 6 * 3_600_000;
      const programs: Program[] = [];
      for (const programme of parsed.programmes) {
        const start = programme.start.getTime();
        const stop = programme.stop?.getTime() ?? start + 30 * 60_000;
        if (stop < oldest || start > horizon) continue;
        const epgKey = programme.channelId.toLowerCase();
        programs.push({
          id: `${id}:${programme.id}`,
          sourceId: id,
          epgKey,
          title: programme.title,
          description: programme.description ?? null,
          category: programme.category ?? null,
          startAt: new Date(start).toISOString(),
          stopAt: new Date(stop).toISOString(),
        });
      }
      await this.storage.replaceEpg(id, names, programs);
      this.epgNames.set(id, names);
      this.nowNextCache.clear();
      const now = new Date(this.now()).toISOString();
      this.replaceSource({
        ...this.requireSource(id),
        epgStatus: 'ready',
        epgUpdatedAt: now,
        epgError: null,
        programCount: programs.length,
        updatedAt: now,
      });
      await this.persistSources();
      this.emit({ type: 'sources' });
      this.emit({ type: 'epg', sourceId: id });
      return {
        programCount: programs.length,
        warnings: parsed.warnings.slice(0, 10).map((warning) => warning.message),
      };
    } catch (error) {
      this.replaceSource({
        ...this.requireSource(id),
        epgStatus: 'error',
        epgError: safeError(error),
      });
      await this.persistSources();
      this.emit({ type: 'sources' });
      throw new Error(safeError(error));
    }
  }

  /** Refreshes every source whose auto-refresh interval has elapsed. */
  async refreshDue(): Promise<string[]> {
    const refreshed: string[] = [];
    for (const source of this.sources) {
      if (!source.autoRefreshMinutes || this.refreshing.has(source.id)) continue;
      const due =
        !source.lastUpdatedAt ||
        this.now() - Date.parse(source.lastUpdatedAt) >= source.autoRefreshMinutes * 60_000;
      if (!due) continue;
      try {
        await this.refreshSource(source.id);
        refreshed.push(source.id);
      } catch {
        // The error is already recorded on the source.
      }
    }
    return refreshed;
  }

  startAutoRefresh(intervalMs = 60_000): void {
    this.stopAutoRefresh();
    this.timer = setInterval(() => void this.refreshDue(), intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  // ---------------------------------------------------------------- channels

  listGroups(sourceId?: string): Group[] {
    const groups = new Map<string, Group>();
    for (const source of this.sources) {
      if (sourceId && source.id !== sourceId) continue;
      for (const channel of this.channelsBySource.get(source.id) ?? []) {
        const existing = groups.get(channel.groupId);
        if (existing) {
          groups.set(channel.groupId, { ...existing, channelCount: existing.channelCount + 1 });
        } else {
          groups.set(channel.groupId, {
            id: channel.groupId,
            sourceId: source.id,
            name: channel.groupName,
            channelCount: 1,
            hidden: Boolean(this.library.hiddenGroups[channel.groupId]),
          });
        }
      }
    }
    return [...groups.values()];
  }

  listChannels(query: ChannelQuery = {}): ChannelPage {
    const search = query.search?.trim().toLocaleLowerCase('es');
    const tokens = search ? search.split(/\s+/).filter(Boolean) : [];
    let matches: StoredChannel[] = [];
    for (const source of this.sources) {
      if (query.sourceId && source.id !== query.sourceId) continue;
      for (const channel of this.channelsBySource.get(source.id) ?? []) {
        if (query.groupId && channel.groupId !== query.groupId) continue;
        if (query.favorite && !this.library.favorites[channel.id]) continue;
        if (query.recent && !this.library.recents[channel.id]) continue;
        if (query.hiddenOnly) {
          if (!this.isHidden(channel)) continue;
        } else if (!query.includeHidden && this.isHidden(channel)) continue;
        if (tokens.length) {
          const haystack = `${this.displayName(channel)} ${channel.groupName}`.toLocaleLowerCase(
            'es',
          );
          if (!tokens.every((token) => haystack.includes(token))) continue;
        }
        matches.push(channel);
      }
    }
    if (query.recent) {
      matches = matches.sort(
        (a, b) =>
          Date.parse(this.library.recents[b.id]?.playedAt ?? '') -
          Date.parse(this.library.recents[a.id]?.playedAt ?? ''),
      );
    }
    const total = matches.length;
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 1000, 5000);
    return {
      items: matches
        .slice(offset, offset + limit)
        .map((channel, index) => this.toChannel(channel, offset + index + 1)),
      total,
    };
  }

  getChannel(id: string): Channel | undefined {
    const stored = this.channelIndex.get(id);
    return stored ? this.toChannel(stored, stored.order + 1) : undefined;
  }

  private isHidden(channel: StoredChannel): boolean {
    return Boolean(
      this.library.hiddenChannels[channel.id] || this.library.hiddenGroups[channel.groupId],
    );
  }

  private displayName(channel: StoredChannel): string {
    return this.library.customNames[channel.id] ?? channel.name;
  }

  private toChannel(stored: StoredChannel, number: number): Channel {
    return {
      id: stored.id,
      sourceId: stored.sourceId,
      number,
      name: this.displayName(stored),
      groupId: stored.groupId,
      groupName: stored.groupName,
      tvgId: stored.tvgId,
      logo: stored.logo,
      favorite: Boolean(this.library.favorites[stored.id]),
      hidden: this.isHidden(stored),
      lastPlayedAt: this.library.recents[stored.id]?.playedAt ?? null,
      streamKind: detectStreamKind(stored.url),
    };
  }

  // ----------------------------------------------------------------- library

  async setFavorite(channelId: string, favorite: boolean): Promise<boolean> {
    if (!this.channelIndex.has(channelId)) return false;
    if (favorite) this.library.favorites[channelId] = new Date(this.now()).toISOString();
    else delete this.library.favorites[channelId];
    await this.persistLibrary();
    return true;
  }

  async markRecent(channelId: string): Promise<void> {
    if (!this.channelIndex.has(channelId)) return;
    const previous = this.library.recents[channelId];
    this.library.recents[channelId] = {
      playedAt: new Date(this.now()).toISOString(),
      count: (previous?.count ?? 0) + 1,
    };
    const entries = Object.entries(this.library.recents).sort(
      ([, a], [, b]) => Date.parse(b.playedAt) - Date.parse(a.playedAt),
    );
    this.library.recents = Object.fromEntries(entries.slice(0, MAX_RECENTS));
    await this.persistLibrary();
  }

  async setChannelHidden(channelId: string, hidden: boolean): Promise<boolean> {
    if (!this.channelIndex.has(channelId)) return false;
    if (hidden) this.library.hiddenChannels[channelId] = true;
    else delete this.library.hiddenChannels[channelId];
    await this.persistLibrary();
    return true;
  }

  async setGroupHidden(groupId: string, hidden: boolean): Promise<void> {
    if (hidden) this.library.hiddenGroups[groupId] = true;
    else delete this.library.hiddenGroups[groupId];
    await this.persistLibrary();
  }

  async renameChannel(channelId: string, name: string | null): Promise<boolean> {
    if (!this.channelIndex.has(channelId)) return false;
    const trimmed = name?.trim();
    if (trimmed) this.library.customNames[channelId] = trimmed;
    else delete this.library.customNames[channelId];
    await this.persistLibrary();
    return true;
  }

  async mapEpg(channelId: string, epgChannelId: string | null): Promise<boolean> {
    if (!this.channelIndex.has(channelId)) return false;
    if (epgChannelId) this.library.epgMappings[channelId] = epgChannelId.toLowerCase();
    else delete this.library.epgMappings[channelId];
    this.nowNextCache.delete(channelId);
    await this.persistLibrary();
    return true;
  }

  // --------------------------------------------------------------------- EPG

  /** Resolves the XMLTV channel key for a channel: manual mapping, tvg-id, then name. */
  epgKeyFor(channelId: string): string | undefined {
    const stored = this.channelIndex.get(channelId);
    if (!stored) return undefined;
    const manual = this.library.epgMappings[channelId];
    if (manual) return manual;
    const names = this.epgNames.get(stored.sourceId) ?? {};
    if (stored.tvgId) {
      const key = stored.tvgId.toLowerCase();
      if (key in names) return key;
    }
    const wanted = this.displayName(stored).toLowerCase();
    for (const [key, name] of Object.entries(names)) if (name.toLowerCase() === wanted) return key;
    return undefined;
  }

  async epgNow(channelIds: string[]): Promise<NowNext[]> {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const result: NowNext[] = [];
    for (const channelId of channelIds.slice(0, 1000)) {
      const cached = this.nowNextCache.get(channelId);
      if (cached && cached.expiresAt > nowMs) {
        result.push(cached.value);
        continue;
      }
      const stored = this.channelIndex.get(channelId);
      const key = this.epgKeyFor(channelId);
      let value: NowNext = { channelId, current: null, next: null };
      if (stored && key) {
        const found = await this.storage.currentAndNext(stored.sourceId, key, nowIso);
        value = { channelId, ...found };
      }
      const expiresAt = value.current
        ? Math.min(Date.parse(value.current.stopAt), nowMs + 5 * 60_000)
        : nowMs + 60_000;
      this.nowNextCache.set(channelId, { value, expiresAt });
      result.push(value);
    }
    return result;
  }

  async timeline(fromIso: string, toIso: string, channelIds: string[]): Promise<TimelineRow[]> {
    const rows: TimelineRow[] = [];
    for (const channelId of channelIds.slice(0, 500)) {
      const channel = this.getChannel(channelId);
      if (!channel) continue;
      const key = this.epgKeyFor(channelId);
      const programs = key
        ? await this.storage.programsBetween(channel.sourceId, key, fromIso, toIso)
        : [];
      rows.push({ channel, programs });
    }
    return rows;
  }

  listEpgChannels(sourceId: string): Array<{ id: string; name: string }> {
    return Object.entries(this.epgNames.get(sourceId) ?? {}).map(([id, name]) => ({ id, name }));
  }

  // ---------------------------------------------------------------- playback

  /** Returns what the platform needs to open a stream. Records the channel as recent. */
  async getPlayable(channelId: string): Promise<PlayableStream> {
    const stored = this.channelIndex.get(channelId);
    if (!stored) throw new Error('Channel not found');
    const channel = this.toChannel(stored, stored.order + 1);
    await this.markRecent(channelId);
    const aceId = extractAceContentId(stored.url);
    if (aceId) {
      return {
        channel,
        title: channel.name,
        live: true,
        url: `${this.aceStreamEndpoint}/ace/getstream?id=${encodeURIComponent(aceId)}`,
        kind: 'acestream',
        headers: {},
        allowLoopback: true,
      };
    }
    const kind = detectStreamKind(stored.url);
    return {
      channel,
      title: channel.name,
      live: kind !== 'http',
      url: stored.url,
      kind,
      headers: stored.headers,
      allowLoopback: this.settings.allowPrivateNetwork,
    };
  }

  // --------------------------------------------------------------------- VOD

  private async fetchJson(url: string, maxBytes = 64 * 1024 * 1024): Promise<unknown> {
    const text = await this.platform.fetchText(url, {
      maxBytes,
      timeoutMs: 90_000,
      allowPrivateNetwork: this.settings.allowPrivateNetwork,
    });
    return JSON.parse(text) as unknown;
  }

  private async fetchCatalogue(source: Source): Promise<{ movies: VodItem[]; series: VodItem[] }> {
    const credentials = source.xtream!;
    const [movieCategories, seriesCategories] = await Promise.all([
      this.fetchJson(buildApiUrl(credentials, 'get_vod_categories')).then(parseCategories),
      this.fetchJson(buildApiUrl(credentials, 'get_series_categories')).then(parseCategories),
    ]);
    const movieNames = new Map(movieCategories.map((category) => [category.id, category.name]));
    const seriesNames = new Map(seriesCategories.map((category) => [category.id, category.name]));
    const [movieList, seriesList] = await Promise.all([
      this.fetchJson(buildApiUrl(credentials, 'get_vod_streams')).then(parseMovies),
      this.fetchJson(buildApiUrl(credentials, 'get_series')).then(parseSeriesList),
    ]);
    const movies: VodItem[] = movieList.map((movie) => ({
      id: `${source.id}:movie:${movie.id}`,
      sourceId: source.id,
      kind: 'movie',
      remoteId: movie.id,
      name: movie.name,
      categoryId: movie.categoryId,
      categoryName: movie.categoryId ? (movieNames.get(movie.categoryId) ?? null) : null,
      poster: movie.poster,
      rating: movie.rating,
      year: movie.year,
      plot: null,
      containerExtension: movie.containerExtension,
      addedAt: movie.addedAt,
    }));
    const series: VodItem[] = seriesList.map((item) => ({
      id: `${source.id}:series:${item.id}`,
      sourceId: source.id,
      kind: 'series',
      remoteId: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: item.categoryId ? (seriesNames.get(item.categoryId) ?? null) : null,
      poster: item.poster,
      rating: item.rating,
      year: item.year,
      plot: item.plot,
      containerExtension: null,
      addedAt: null,
    }));
    return { movies, series };
  }

  listVodCategories(kind: VodKind, sourceId?: string): VodCategory[] {
    const categories = new Map<string, VodCategory>();
    for (const [source, items] of this.vodBySource) {
      if (sourceId && source !== sourceId) continue;
      for (const item of items) {
        if (item.kind !== kind || !item.categoryId) continue;
        const id = `${source}:${kind}:${item.categoryId}`;
        const existing = categories.get(id);
        if (existing) categories.set(id, { ...existing, count: existing.count + 1 });
        else
          categories.set(id, {
            id,
            sourceId: source,
            kind,
            name: item.categoryName ?? item.categoryId,
            count: 1,
          });
      }
    }
    return [...categories.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  listVod(query: VodQuery): { items: VodItem[]; total: number } {
    const tokens = query.search?.trim().toLocaleLowerCase('es').split(/\s+/).filter(Boolean) ?? [];
    const matches: VodItem[] = [];
    for (const [source, items] of this.vodBySource) {
      if (query.sourceId && source !== query.sourceId) continue;
      for (const item of items) {
        if (item.kind !== query.kind) continue;
        if (
          query.categoryId &&
          `${source}:${query.kind}:${item.categoryId ?? ''}` !== query.categoryId
        )
          continue;
        if (tokens.length) {
          const haystack = item.name.toLocaleLowerCase('es');
          if (!tokens.every((token) => haystack.includes(token))) continue;
        }
        matches.push(item);
      }
    }
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 500, 5000);
    return { items: matches.slice(offset, offset + limit), total: matches.length };
  }

  getVod(id: string): VodItem | undefined {
    return this.vodIndex.get(id);
  }

  /** Seasons and episodes of a series, cached for a day. */
  async getSeriesInfo(id: string): Promise<SeriesInfo> {
    const item = this.vodIndex.get(id);
    if (!item || item.kind !== 'series') throw new Error('Series not found');
    const cached = await this.storage.readSeriesInfo(id);
    if (cached && this.now() - Date.parse(cached.fetchedAt) < SERIES_INFO_TTL) return cached;
    const source = this.requireSource(item.sourceId);
    const payload = await this.fetchJson(
      buildSeriesInfoUrl(source.xtream!, item.remoteId),
      8 * 1024 * 1024,
    );
    const parsed = parseSeriesInfo(payload);
    const info: SeriesInfo = {
      id,
      plot: parsed.plot ?? item.plot,
      seasons: parsed.seasons,
      fetchedAt: new Date(this.now()).toISOString(),
    };
    await this.storage.writeSeriesInfo(info);
    return info;
  }

  /** Playable stream for a movie, or for an episode of a series when `episodeId` is given. */
  async getPlayableVod(id: string, episodeId?: string): Promise<PlayableStream> {
    const item = this.vodIndex.get(id);
    if (!item) throw new Error('Title not found');
    const source = this.requireSource(item.sourceId);
    const credentials = source.xtream!;
    if (item.kind === 'movie') {
      return {
        title: item.name,
        live: false,
        url: buildMovieUrl(credentials, item.remoteId, item.containerExtension ?? 'mp4'),
        kind: 'http',
        headers: {},
        allowLoopback: this.settings.allowPrivateNetwork,
      };
    }
    if (!episodeId) throw new Error('An episode is required to play a series');
    const info = await this.getSeriesInfo(id);
    const episode = info.seasons
      .flatMap((season) => season.episodes)
      .find((e) => e.id === episodeId);
    if (!episode) throw new Error('Episode not found');
    return {
      title: `${item.name} · ${episode.season}x${String(episode.number).padStart(2, '0')} ${episode.title}`,
      live: false,
      url: buildEpisodeUrl(credentials, episode.id, episode.containerExtension),
      kind: 'http',
      headers: {},
      allowLoopback: this.settings.allowPrivateNetwork,
    };
  }

  // ----------------------------------------------------------------- helpers

  private requireSource(id: string): Source {
    const source = this.sources.find((item) => item.id === id);
    if (!source) throw new Error('Source not found');
    return source;
  }

  private replaceSource(source: Source): void {
    this.sources = this.sources.map((item) => (item.id === source.id ? source : item));
  }

  private rebuildIndex(): void {
    this.channelIndex = new Map();
    for (const channels of this.channelsBySource.values())
      for (const channel of channels) this.channelIndex.set(channel.id, channel);
    this.vodIndex = new Map();
    for (const items of this.vodBySource.values())
      for (const item of items) this.vodIndex.set(item.id, item);
    this.nowNextCache.clear();
  }

  private async persistSources(): Promise<void> {
    await this.platform.kv.set(SOURCES_KEY, this.sources);
  }

  private async persistLibrary(): Promise<void> {
    await this.platform.kv.set(LIBRARY_KEY, this.library);
    this.emit({ type: 'library' });
  }
}

function assertHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error('The URL is not valid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('Only HTTP and HTTPS sources are supported');
}

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
