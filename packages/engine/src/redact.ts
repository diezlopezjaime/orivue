import { redactUrl } from '@orivue/core';
import { redactXtreamUrl } from '@orivue/xtream';

/** Produces a URL safe for UI, logs and error messages. */
export function safeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  return redactXtreamUrl(redactUrl(input));
}

const SECRET_PATTERNS = [
  /([?&](?:username|user|password|pass|pwd|token|access_token|auth)=)[^&#\s]*/gi,
  /\/(live|movie|series|timeshift|streaming)\/[^/\s]+\/[^/\s]+\//gi,
  /(authorization\s*[:=]\s*)[^\r\n]*/gi,
];

export function safeText(value: string): string {
  let output = value;
  output = output.replace(SECRET_PATTERNS[0]!, '$1[redacted]');
  output = output.replace(SECRET_PATTERNS[1]!, '/$1/[redacted]/[redacted]/');
  output = output.replace(SECRET_PATTERNS[2]!, '$1[redacted]');
  return output.slice(0, 500);
}

export function safeError(error: unknown): string {
  if (error instanceof Error) return safeText(error.message || 'Unknown error');
  return safeText(typeof error === 'string' ? error : 'Unknown error');
}
