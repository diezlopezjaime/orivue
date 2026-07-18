import { stableId, type Channel, type StreamHeaders } from '@orivue/core';

export interface M3uParseOptions {
  /** Stable playlist/database ID. Including it prevents IDs colliding across playlists. */
  readonly sourceId?: string;
  readonly maxChannels?: number;
  readonly maxLineLength?: number;
}

export type M3uWarningCode =
  | 'missing-header'
  | 'missing-extinf'
  | 'missing-url'
  | 'invalid-url'
  | 'unsafe-header'
  | 'line-too-long'
  | 'duplicate'
  | 'limit-reached';

export interface M3uWarning {
  readonly line: number;
  readonly code: M3uWarningCode;
  readonly message: string;
}

export interface M3uParseResult {
  readonly channels: Channel[];
  readonly warnings: M3uWarning[];
}

interface PendingChannel {
  name: string;
  tvgId?: string;
  tvgName?: string;
  logo?: string;
  groupName?: string;
  headers: Record<string, string>;
  line: number;
}

const HEADER_NAMES: Readonly<Record<string, string>> = {
  authorization: 'Authorization',
  cookie: 'Cookie',
  'http-origin': 'Origin',
  'http-referrer': 'Referer',
  'http-referer': 'Referer',
  'http-user-agent': 'User-Agent',
  origin: 'Origin',
  referer: 'Referer',
  referrer: 'Referer',
  'user-agent': 'User-Agent',
};

const DEFAULT_MAX_LINE_LENGTH = 64 * 1024;
const DEFAULT_MAX_CHANNELS = 250_000;

export function parseM3u(input: string, options: M3uParseOptions = {}): M3uParseResult {
  const warnings: M3uWarning[] = [];
  const channels: Channel[] = [];
  const seen = new Set<string>();
  const sourceId = options.sourceId ?? 'default';
  const maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  let pending: PendingChannel | undefined;
  let foundHeader = false;

  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index] ?? '';
    if (rawLine.length > maxLineLength) {
      warnings.push(
        safeWarning(
          lineNumber,
          'line-too-long',
          'A line exceeded the configured safety limit and was skipped.',
        ),
      );
      continue;
    }
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#EXTM3U(?:\s|$)/i.test(line)) {
      foundHeader = true;
      continue;
    }
    if (/^#EXTINF:/i.test(line)) {
      if (pending) {
        warnings.push(
          safeWarning(pending.line, 'missing-url', 'An EXTINF entry had no following stream URL.'),
        );
      }
      pending = parseExtInf(line, lineNumber);
      continue;
    }
    if (/^#EXTVLCOPT:/i.test(line) || /^#KODIPROP:/i.test(line)) {
      if (pending) parseOptionHeader(line, pending.headers, warnings, lineNumber);
      continue;
    }
    if (line.startsWith('#')) continue;

    const entry = pending ?? { name: inferName(line), headers: {}, line: lineNumber };
    if (!pending) {
      warnings.push(
        safeWarning(
          lineNumber,
          'missing-extinf',
          'A stream URL had no EXTINF metadata; a fallback name was used.',
        ),
      );
    }
    pending = undefined;
    const parsedUrl = parseUrlAndHeaders(line, entry.headers, warnings, lineNumber);
    if (!parsedUrl) continue;

    const identity = entry.tvgId
      ? [sourceId, 'tvg', entry.tvgId, entry.name]
      : [sourceId, 'fallback', entry.name, entry.groupName ?? '', urlIdentity(parsedUrl.url)];
    const id = stableId('channel', ...identity);
    if (seen.has(id)) {
      warnings.push(safeWarning(lineNumber, 'duplicate', 'A duplicate channel entry was ignored.'));
      continue;
    }
    seen.add(id);

    const channel: Channel = {
      id,
      name: entry.name || entry.tvgName || 'Unnamed channel',
      url: parsedUrl.url,
      ...(entry.groupName ? { groupName: entry.groupName } : {}),
      ...(entry.tvgId ? { tvgId: entry.tvgId } : {}),
      ...(entry.tvgName ? { tvgName: entry.tvgName } : {}),
      ...(entry.logo ? { logo: entry.logo } : {}),
      ...(Object.keys(parsedUrl.headers).length > 0 ? { headers: parsedUrl.headers } : {}),
    };
    channels.push(channel);
    if (channels.length >= maxChannels) {
      warnings.push(
        safeWarning(
          lineNumber,
          'limit-reached',
          'The configured channel limit was reached; remaining entries were ignored.',
        ),
      );
      break;
    }
  }

  if (pending)
    warnings.push(
      safeWarning(pending.line, 'missing-url', 'An EXTINF entry had no following stream URL.'),
    );
  if (!foundHeader)
    warnings.unshift(
      safeWarning(1, 'missing-header', 'The EXTM3U header was missing; parsing continued.'),
    );
  return { channels, warnings };
}

function parseExtInf(line: string, lineNumber: number): PendingChannel {
  const body = line.slice(line.indexOf(':') + 1);
  const commaIndex = findUnquotedComma(body);
  const metadata = commaIndex >= 0 ? body.slice(0, commaIndex) : body;
  const visibleName = commaIndex >= 0 ? body.slice(commaIndex + 1).trim() : '';
  const attributes = parseAttributes(metadata);
  const tvgName = cleanMetadata(attributes['tvg-name']);
  const name = visibleName || tvgName || 'Unnamed channel';
  const pending: PendingChannel = { name, headers: {}, line: lineNumber };
  assignIfPresent(pending, 'tvgId', cleanMetadata(attributes['tvg-id']));
  assignIfPresent(pending, 'tvgName', tvgName);
  assignIfPresent(pending, 'logo', cleanMetadata(attributes['tvg-logo']));
  assignIfPresent(pending, 'groupName', cleanMetadata(attributes['group-title']));
  for (const [key, value] of Object.entries(attributes)) {
    if (key in HEADER_NAMES) addHeader(pending.headers, key, value);
  }
  return pending;
}

function parseAttributes(metadata: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const expression = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  for (const match of metadata.matchAll(expression)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attributes[name] = value;
  }
  return attributes;
}

function findUnquotedComma(value: string): number {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if ((character === '"' || character === "'") && (!quote || quote === character))
      quote = quote ? '' : character;
    else if (character === ',' && !quote) return index;
  }
  return -1;
}

function parseOptionHeader(
  line: string,
  headers: Record<string, string>,
  warnings: M3uWarning[],
  lineNumber: number,
): void {
  const body = line.slice(line.indexOf(':') + 1);
  const separator = body.indexOf('=');
  if (separator < 1) return;
  const name = body.slice(0, separator).trim().toLowerCase();
  const value = body.slice(separator + 1).trim();
  if (name === 'inputstream.adaptive.stream_headers') {
    parseHeaderQuery(value, headers, warnings, lineNumber);
  } else if (!addHeader(headers, name, value)) {
    warnings.push(
      safeWarning(
        lineNumber,
        'unsafe-header',
        'An unsupported or unsafe playback header was ignored.',
      ),
    );
  }
}

function parseUrlAndHeaders(
  line: string,
  inheritedHeaders: Record<string, string>,
  warnings: M3uWarning[],
  lineNumber: number,
): { url: string; headers: StreamHeaders } | undefined {
  const pipeIndex = line.indexOf('|');
  const url = (pipeIndex >= 0 ? line.slice(0, pipeIndex) : line).trim();
  if (!isPlayableUrl(url)) {
    warnings.push(
      safeWarning(lineNumber, 'invalid-url', 'An entry used an invalid or unsupported stream URL.'),
    );
    return undefined;
  }
  const headers = { ...inheritedHeaders };
  if (pipeIndex >= 0) parseHeaderQuery(line.slice(pipeIndex + 1), headers, warnings, lineNumber);
  return { url, headers };
}

function parseHeaderQuery(
  value: string,
  headers: Record<string, string>,
  warnings: M3uWarning[],
  lineNumber: number,
): void {
  for (const pair of value.split('&')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = decodeComponent(pair.slice(0, separator)).trim().toLowerCase();
    const headerValue = decodeComponent(pair.slice(separator + 1));
    if (!addHeader(headers, name, headerValue)) {
      warnings.push(
        safeWarning(
          lineNumber,
          'unsafe-header',
          'An unsupported or unsafe playback header was ignored.',
        ),
      );
    }
  }
}

function addHeader(
  headers: Record<string, string>,
  inputName: string,
  inputValue: string,
): boolean {
  const name = HEADER_NAMES[inputName.toLowerCase()];
  const value = inputValue.trim();
  if (!name || !value || value.length > 4096 || /[\r\n\0]/.test(value)) return false;
  headers[name] = value;
  return true;
}

function isPlayableUrl(value: string): boolean {
  if (/^acestream:\/\/[a-f\d]{40}$/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function urlIdentity(value: string): string {
  if (value.startsWith('acestream://')) return value;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

function inferName(value: string): string {
  try {
    const parsed = new URL(value.split('|')[0] ?? value);
    const lastPart = parsed.pathname.split('/').filter(Boolean).at(-1);
    return lastPart ? decodeComponent(lastPart) : parsed.hostname || 'Unnamed channel';
  } catch {
    return 'Unnamed channel';
  }
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch {
    return value;
  }
}

function cleanMetadata(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .trim();
  return cleaned || undefined;
}

function assignIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function safeWarning(line: number, code: M3uWarningCode, message: string): M3uWarning {
  return { line, code, message };
}

export type { Channel } from '@orivue/core';
