import { describe, expect, it } from 'vitest';
import { sanitizeText, sanitizeUrl } from './redact.js';

describe('credential redaction', () => {
  it('redacts URL credentials and sensitive query parameters', () => {
    const sanitized = sanitizeUrl(
      'https://alice:secret@example.test/list.m3u?token=abc&quality=hd',
    );
    expect(sanitized).not.toContain('alice');
    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('abc');
    expect(sanitized).toContain('quality=hd');
  });
  it('redacts bearer values and log-safe query values', () => {
    const value = sanitizeText('Authorization: Bearer very.secret token=raw');
    expect(value).not.toContain('very.secret');
    expect(value).not.toContain('raw');
  });
});
