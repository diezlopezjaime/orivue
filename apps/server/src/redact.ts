const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'auth',
  'authorization',
  'password',
  'passwd',
  'pwd',
  'username',
  'user',
]);

export function sanitizeText(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(
      /\b((?:token|access_token|auth|password|passwd|pwd|username|user)\s*=\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /([?&](?:token|access_token|auth|password|passwd|pwd|username|user)=)[^&#\s]*/gi,
      '$1[REDACTED]',
    );
}

export function sanitizeUrl(input: string | null): string | null {
  if (!input) return input;
  try {
    const url = new URL(input);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return sanitizeText(input);
  }
}

export function publicError(error: unknown): string {
  return sanitizeText(error instanceof Error ? error.message : 'Unknown error').slice(0, 500);
}
