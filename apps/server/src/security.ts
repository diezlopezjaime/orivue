import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

const DEFAULT_ORIGINS = new Set([
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:5173',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);

export function isAllowedOrigin(origin: string): boolean {
  return DEFAULT_ORIGINS.has(origin);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : true;
}

export async function assertSafeRemoteUrl(
  rawUrl: string,
  options: { allowPrivateNetwork?: boolean; expectedOrigins?: string[] } = {},
): Promise<URL> {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP and HTTPS sources are allowed');
  if (url.username || url.password) {
    // Credentials are supported for provider URLs, but are never logged or returned.
  }
  if (options.expectedOrigins?.length && !options.expectedOrigins.includes(url.origin)) {
    throw new Error('The requested resource is outside this playback session');
  }
  if (!options.allowPrivateNetwork) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('Private, loopback and link-local destinations are blocked');
    }
  }
  return url;
}

export function assertLocalRequest(request: FastifyRequest, apiToken?: string): void {
  const host = request.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw new Error('Only loopback access is allowed');
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) throw new Error('Origin is not allowed');
  if (apiToken && request.headers['x-orivue-token'] !== apiToken)
    throw new Error('Invalid local API token');
}

export interface LimitedFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowPrivateNetwork?: boolean;
  expectedOrigins?: string[];
}

export async function limitedFetch(
  rawUrl: string,
  options: LimitedFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = rawUrl;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const url = await assertSafeRemoteUrl(current, options);
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await fetch(url, {
      ...(options.headers ? { headers: options.headers } : {}),
      redirect: 'manual',
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === maxRedirects) throw new Error('Too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect is missing a location');
      current = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}

export async function readLimitedText(
  response: Response,
  maxBytes = 25 * 1024 * 1024,
): Promise<string> {
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new Error('Source exceeds the configured size limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Source exceeds the configured size limit');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
