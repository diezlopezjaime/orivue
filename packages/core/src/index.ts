export type StreamHeaders = Readonly<Record<string, string>>;

export interface Channel {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly groupName?: string;
  readonly tvgId?: string;
  readonly tvgName?: string;
  readonly logo?: string;
  readonly headers?: StreamHeaders;
}

export interface EpgChannel {
  readonly id: string;
  readonly displayNames: readonly string[];
  readonly icon?: string;
}

export interface EpgProgramme {
  readonly id: string;
  readonly channelId: string;
  readonly start: Date;
  readonly stop?: Date;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly icon?: string;
}

export type PlayableStreamKind = 'hls' | 'http';

export interface PlayableStream {
  readonly sessionId: string;
  readonly url: string;
  readonly kind: PlayableStreamKind;
  readonly headers?: StreamHeaders;
}

export interface StreamResolver {
  supports(channel: Channel): boolean;
  resolve(channel: Channel, signal?: AbortSignal): Promise<PlayableStream>;
  stop(sessionId: string): Promise<void>;
}

const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'auth',
  'key',
  'password',
  'pass',
  'pwd',
  'signature',
  'sig',
  'token',
  'username',
  'user',
]);

export function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '[redacted]';
    if (parsed.password) parsed.password = '[redacted]';
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return parsed.toString();
  } catch {
    return '[invalid or redacted URL]';
  }
}

export function redactHeaders(headers: StreamHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|cookie|token|key/i.test(key)) result[key] = '[redacted]';
    else if (/^(?:origin|referer)$/i.test(key)) result[key] = redactUrl(value);
    else result[key] = value;
  }
  return result;
}

export function normaliseIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

/** A deterministic, non-cryptographic 64-bit hash suitable for local stable IDs. */
export function stableId(namespace: string, ...parts: string[]): string {
  const input = [namespace, ...parts].map(normaliseIdentity).join('\u001f');
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${namespace}_${hash.toString(36).padStart(13, '0')}`;
}
