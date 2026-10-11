/**
 * Xtream Codes helpers. An Xtream "account" is a panel base URL plus a
 * username/password pair. The panel exposes:
 *
 * - `get.php?username&password&type=m3u_plus&output=ts|m3u8` – M3U playlist
 * - `xmltv.php?username&password` – XMLTV guide
 * - `player_api.php?username&password[&action=...]` – JSON API
 * - `/live/{user}/{pass}/{id}.ts` and friends – stream URLs
 *
 * Nothing here performs network requests on its own; callers inject fetch.
 */

export interface XtreamCredentials {
  /** Normalised origin plus optional path prefix, without trailing slash. */
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
}

export type XtreamOutput = 'ts' | 'm3u8';

export interface XtreamAccountInfo {
  readonly status: string;
  readonly expiresAt: string | null;
  readonly isTrial: boolean;
  readonly activeConnections: number | null;
  readonly maxConnections: number | null;
  readonly allowedOutputFormats: XtreamOutput[];
  readonly serverTimezone: string | null;
}

const PANEL_SCRIPTS = new Set(['get.php', 'player_api.php', 'xmltv.php', 'panel_api.php']);
const STREAM_KINDS = new Set(['live', 'movie', 'series', 'timeshift', 'streaming']);

function normaliseBase(url: URL, pathPrefix: string): string {
  const prefix = pathPrefix.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${prefix}`;
}

/**
 * Recognises the common Xtream URL shapes and extracts credentials.
 * Returns `undefined` for anything else, including plain M3U URLs.
 */
export function parseXtreamUrl(input: string): XtreamCredentials | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';

  if (PANEL_SCRIPTS.has(last.toLowerCase())) {
    const username = url.searchParams.get('username')?.trim();
    const password = url.searchParams.get('password')?.trim();
    if (!username || !password) return undefined;
    const prefix = segments.slice(0, -1).join('/');
    return { baseUrl: normaliseBase(url, prefix ? `/${prefix}` : ''), username, password };
  }

  // /live/{user}/{pass}/{id}.ext or /{user}/{pass}/{id}
  const kindIndex = segments.findIndex((segment) => STREAM_KINDS.has(segment.toLowerCase()));
  if (kindIndex >= 0 && segments.length >= kindIndex + 4) {
    const username = segments[kindIndex + 1];
    const password = segments[kindIndex + 2];
    if (username && password) {
      const prefix = segments.slice(0, kindIndex).join('/');
      return {
        baseUrl: normaliseBase(url, prefix ? `/${prefix}` : ''),
        username: decodeURIComponent(username),
        password: decodeURIComponent(password),
      };
    }
  }
  return undefined;
}

export function isXtreamUrl(input: string): boolean {
  return parseXtreamUrl(input) !== undefined;
}

/** Builds credentials from the three fields of the "Xtream account" form. */
export function createXtreamCredentials(
  host: string,
  username: string,
  password: string,
): XtreamCredentials {
  const trimmedHost = host.trim();
  const withScheme = /^https?:\/\//i.test(trimmedHost) ? trimmedHost : `http://${trimmedHost}`;
  const url = new URL(withScheme);
  const segments = url.pathname.split('/').filter(Boolean);
  if (PANEL_SCRIPTS.has((segments.at(-1) ?? '').toLowerCase())) segments.pop();
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) throw new Error('Xtream credentials require a username and a password');
  return { baseUrl: normaliseBase(url, prefix), username: user, password: pass };
}

function panelUrl(credentials: XtreamCredentials, script: string): URL {
  const url = new URL(`${credentials.baseUrl}/${script}`);
  url.searchParams.set('username', credentials.username);
  url.searchParams.set('password', credentials.password);
  return url;
}

export function buildPlaylistUrl(
  credentials: XtreamCredentials,
  output: XtreamOutput = 'ts',
): string {
  const url = panelUrl(credentials, 'get.php');
  url.searchParams.set('type', 'm3u_plus');
  url.searchParams.set('output', output);
  return url.toString();
}

export function buildEpgUrl(credentials: XtreamCredentials): string {
  return panelUrl(credentials, 'xmltv.php').toString();
}

export function buildApiUrl(credentials: XtreamCredentials, action?: string): string {
  const url = panelUrl(credentials, 'player_api.php');
  if (action) url.searchParams.set('action', action);
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Normalises the `user_info`/`server_info` payload of `player_api.php`.
 * Throws when the panel rejected the credentials.
 */
export function parseAccountInfo(payload: unknown): XtreamAccountInfo {
  const root = asRecord(payload);
  const user = asRecord(root.user_info);
  const server = asRecord(root.server_info);
  const auth = user.auth;
  const status = asText(user.status) ?? 'Unknown';
  if (auth === 0 || auth === '0' || auth === false || /disabled|banned|expired/i.test(status)) {
    throw new XtreamError('auth-failed', `The panel rejected these credentials (${status}).`);
  }
  if (Object.keys(user).length === 0) {
    throw new XtreamError('invalid-response', 'The panel did not return account information.');
  }
  const expiry = asNumber(user.exp_date);
  const formats = Array.isArray(user.allowed_output_formats)
    ? user.allowed_output_formats.filter(
        (value): value is XtreamOutput => value === 'ts' || value === 'm3u8',
      )
    : [];
  return {
    status,
    expiresAt: expiry && expiry > 0 ? new Date(expiry * 1000).toISOString() : null,
    isTrial: user.is_trial === '1' || user.is_trial === 1 || user.is_trial === true,
    activeConnections: asNumber(user.active_cons),
    maxConnections: asNumber(user.max_connections),
    allowedOutputFormats: formats,
    serverTimezone: asText(server.timezone),
  };
}

export type XtreamErrorCode = 'auth-failed' | 'invalid-response' | 'network';

export class XtreamError extends Error {
  readonly code: XtreamErrorCode;

  constructor(code: XtreamErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'XtreamError';
    this.code = code;
  }
}

export type JsonFetcher = (url: string, signal?: AbortSignal) => Promise<unknown>;

/** Validates credentials against the panel using an injected JSON fetcher. */
export async function fetchAccountInfo(
  credentials: XtreamCredentials,
  fetchJson: JsonFetcher,
  signal?: AbortSignal,
): Promise<XtreamAccountInfo> {
  let payload: unknown;
  try {
    payload = await fetchJson(buildApiUrl(credentials), signal);
  } catch (error) {
    if (error instanceof XtreamError) throw error;
    throw new XtreamError('network', 'The Xtream panel could not be reached.', { cause: error });
  }
  return parseAccountInfo(payload);
}

/**
 * Hides the credentials that Xtream embeds in stream paths
 * (`/live/user/pass/1.ts`) and in panel queries. Safe for logs and errors.
 */
export function redactXtreamUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return '[invalid or redacted URL]';
  }
  for (const key of ['username', 'password']) {
    if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
  }
  const segments = url.pathname.split('/');
  const kindIndex = segments.findIndex((segment) => STREAM_KINDS.has(segment.toLowerCase()));
  if (kindIndex >= 0 && segments.length >= kindIndex + 4) {
    segments[kindIndex + 1] = '[redacted]';
    segments[kindIndex + 2] = '[redacted]';
    url.pathname = segments.join('/');
  } else if (segments.length === 4 && /^\d+(?:\.\w+)?$/.test(segments[3] ?? '')) {
    // Legacy /{user}/{pass}/{id} layout.
    segments[1] = '[redacted]';
    segments[2] = '[redacted]';
    url.pathname = segments.join('/');
  }
  return url.toString();
}

// ----------------------------------------------------------------- VOD API

export type VodKind = 'movie' | 'series';

export interface XtreamCategory {
  readonly id: string;
  readonly name: string;
}

export interface XtreamMovie {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly poster: string | null;
  readonly rating: number | null;
  readonly year: string | null;
  readonly containerExtension: string;
  readonly addedAt: string | null;
}

export interface XtreamSeries {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly poster: string | null;
  readonly rating: number | null;
  readonly year: string | null;
  readonly plot: string | null;
}

export interface XtreamEpisode {
  readonly id: string;
  readonly season: number;
  readonly number: number;
  readonly title: string;
  readonly containerExtension: string;
  readonly durationSeconds: number | null;
  readonly plot: string | null;
}

export interface XtreamSeriesInfo {
  readonly plot: string | null;
  readonly seasons: ReadonlyArray<{ readonly season: number; readonly episodes: XtreamEpisode[] }>;
}

function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function cleanExtension(value: unknown, fallback: string): string {
  const text = asText(value)?.replace(/^\./, '').toLowerCase();
  return text && /^[a-z0-9]{2,5}$/.test(text) ? text : fallback;
}

function toDate(value: unknown): string | null {
  const seconds = asNumber(value);
  return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export function parseCategories(payload: unknown): XtreamCategory[] {
  if (!Array.isArray(payload)) return [];
  const result: XtreamCategory[] = [];
  for (const item of payload) {
    const record = asRecord(item);
    const id = idText(record.category_id);
    const name = asText(record.category_name);
    if (id && name) result.push({ id, name });
  }
  return result;
}

export function parseMovies(payload: unknown): XtreamMovie[] {
  if (!Array.isArray(payload)) return [];
  const result: XtreamMovie[] = [];
  for (const item of payload) {
    const record = asRecord(item);
    const id = idText(record.stream_id);
    const name = asText(record.name) ?? asText(record.title);
    if (!id || !name) continue;
    result.push({
      id,
      name,
      categoryId: idText(record.category_id),
      poster: asText(record.stream_icon) ?? asText(record.cover),
      rating: asNumber(record.rating),
      year: asText(record.year) ?? asText(record.release_date)?.slice(0, 4) ?? null,
      containerExtension: cleanExtension(record.container_extension, 'mp4'),
      addedAt: toDate(record.added),
    });
  }
  return result;
}

export function parseSeriesList(payload: unknown): XtreamSeries[] {
  if (!Array.isArray(payload)) return [];
  const result: XtreamSeries[] = [];
  for (const item of payload) {
    const record = asRecord(item);
    const id = idText(record.series_id);
    const name = asText(record.name) ?? asText(record.title);
    if (!id || !name) continue;
    result.push({
      id,
      name,
      categoryId: idText(record.category_id),
      poster: asText(record.cover) ?? asText(record.stream_icon),
      rating: asNumber(record.rating),
      year: asText(record.year) ?? asText(record.releaseDate)?.slice(0, 4) ?? null,
      plot: asText(record.plot),
    });
  }
  return result;
}

function parseEpisodeList(value: unknown, season: number): XtreamEpisode[] {
  if (!Array.isArray(value)) return [];
  const result: XtreamEpisode[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const id = idText(record.id);
    if (!id) continue;
    const info = asRecord(record.info);
    const number = asNumber(record.episode_num) ?? result.length + 1;
    result.push({
      id,
      season,
      number,
      title: asText(record.title) ?? `Episode ${number}`,
      containerExtension: cleanExtension(record.container_extension, 'mp4'),
      durationSeconds: asNumber(info.duration_secs),
      plot: asText(info.plot),
    });
  }
  return result.sort((a, b) => a.number - b.number);
}

/** Normalises `player_api.php?action=get_series_info&series_id=` payloads. */
export function parseSeriesInfo(payload: unknown): XtreamSeriesInfo {
  const root = asRecord(payload);
  const info = asRecord(root.info);
  const episodes = root.episodes;
  const seasons: Array<{ season: number; episodes: XtreamEpisode[] }> = [];
  if (Array.isArray(episodes)) {
    // Some panels return an array of seasons; each entry is a list of episodes.
    episodes.forEach((list, index) => {
      const parsed = parseEpisodeList(list, index + 1);
      if (parsed.length) seasons.push({ season: index + 1, episodes: parsed });
    });
  } else if (episodes && typeof episodes === 'object') {
    for (const [key, list] of Object.entries(episodes as Record<string, unknown>)) {
      const season = Number(key);
      if (!Number.isFinite(season)) continue;
      const parsed = parseEpisodeList(list, season);
      if (parsed.length) seasons.push({ season, episodes: parsed });
    }
  }
  seasons.sort((a, b) => a.season - b.season);
  return { plot: asText(info.plot), seasons };
}

function streamUrl(
  credentials: XtreamCredentials,
  kind: 'live' | 'movie' | 'series',
  id: string,
  extension: string,
): string {
  return `${credentials.baseUrl}/${kind}/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${encodeURIComponent(id)}.${extension}`;
}

export function buildMovieUrl(
  credentials: XtreamCredentials,
  streamId: string,
  extension = 'mp4',
): string {
  return streamUrl(credentials, 'movie', streamId, extension);
}

export function buildEpisodeUrl(
  credentials: XtreamCredentials,
  episodeId: string,
  extension = 'mp4',
): string {
  return streamUrl(credentials, 'series', episodeId, extension);
}

export function buildSeriesInfoUrl(credentials: XtreamCredentials, seriesId: string): string {
  const url = new URL(buildApiUrl(credentials, 'get_series_info'));
  url.searchParams.set('series_id', seriesId);
  return url.toString();
}

export interface XtreamLiveStream {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly icon: string | null;
  readonly epgChannelId: string | null;
  readonly number: number | null;
}

/**
 * Parses `get_live_streams`. Only the fields Orivue needs are kept; entries
 * without an id or a name are skipped instead of failing the whole import.
 */
export function parseLiveStreams(payload: unknown): XtreamLiveStream[] {
  if (!Array.isArray(payload)) return [];
  const result: XtreamLiveStream[] = [];
  for (const item of payload) {
    const record = asRecord(item);
    const id = idText(record.stream_id);
    const name = asText(record.name);
    if (!id || !name) continue;
    const type = asText(record.stream_type);
    if (type && type !== 'live') continue;
    result.push({
      id,
      name,
      categoryId: idText(record.category_id),
      icon: asText(record.stream_icon),
      epgChannelId: asText(record.epg_channel_id),
      number: asNumber(record.num),
    });
  }
  return result;
}

/** Live stream URL in the layout every Xtream panel serves: `/live/user/pass/id.ext`. */
export function buildLiveUrl(
  credentials: XtreamCredentials,
  streamId: string,
  output: XtreamOutput = 'ts',
): string {
  return streamUrl(credentials, 'live', streamId, output);
}

/** Stream URLs that belong to the VOD catalogue rather than the live list. */
export function isVodStreamUrl(url: string): boolean {
  return /\/(?:movie|series)\/[^/]+\/[^/]+\/[^/]+$/i.test(url.split('?')[0] ?? url);
}
