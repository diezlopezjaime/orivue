import type { StreamKind } from './types.js';

const HLS_PATTERN = /\.m3u8?(?:$|[?#])/i;
const TS_PATTERN = /\.(?:ts|m2ts|mts|mpegts)(?:$|[?#])/i;
const PROGRESSIVE_PATTERN = /\.(?:mp4|m4v|webm|mkv|mov|mp3|aac|ogg|flv|avi)(?:$|[?#])/i;
const XTREAM_LIVE_PATTERN = /\/(?:live|streaming)\/[^/]+\/[^/]+\/\d+(?:$|[?#])/i;
const XTREAM_VOD_PATTERN = /\/(?:movie|series)\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(?:$|[?#])/i;

/** Guesses the container from the URL. The proxy may refine it from the content type. */
export function detectStreamKind(url: string): StreamKind {
  if (/^acestream:\/\//i.test(url)) return 'acestream';
  if (HLS_PATTERN.test(url)) return 'hls';
  if (TS_PATTERN.test(url)) return 'mpegts';
  if (XTREAM_VOD_PATTERN.test(url)) return PROGRESSIVE_PATTERN.test(url) ? 'http' : 'unknown';
  if (PROGRESSIVE_PATTERN.test(url)) return 'http';
  if (XTREAM_LIVE_PATTERN.test(url)) return 'mpegts';
  try {
    const parsed = new URL(url);
    const output = parsed.searchParams.get('output');
    if (output === 'ts') return 'mpegts';
    if (output === 'm3u8' || output === 'hls') return 'hls';
    // Legacy Xtream layout: /user/pass/123
    if (/^\/[^/]+\/[^/]+\/\d+$/.test(parsed.pathname)) return 'mpegts';
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

/** Refines a guessed kind using the upstream content type reported by the proxy. */
export function refineStreamKind(kind: StreamKind, contentType: string | null): StreamKind {
  const type = (contentType ?? '').toLowerCase();
  if (!type) return kind;
  if (type.includes('mpegurl') || type.includes('x-mpegurl')) return 'hls';
  if (type.includes('video/mp2t') || type.includes('mpeg2-ts')) return 'mpegts';
  if (type.includes('video/mp4') || type.includes('audio/mp4') || type.includes('video/webm'))
    return 'http';
  if (type.includes('video/x-flv')) return 'mpegts';
  if (kind === 'unknown' && type.startsWith('video/')) return 'mpegts';
  return kind;
}
