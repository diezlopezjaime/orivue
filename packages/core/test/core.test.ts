import { describe, expect, it } from 'vitest';
import { redactHeaders, redactUrl, stableId } from '../src/index.js';

describe('core safety helpers', () => {
  it('creates deterministic IDs', () => {
    expect(stableId('channel', '  Café TV ')).toBe(stableId('channel', 'café tv'));
    expect(stableId('channel', 'one')).not.toBe(stableId('channel', 'two'));
  });

  it('redacts URL credentials and common secret parameters', () => {
    const result = redactUrl('https://alice:secret@example.test/live?token=abc&quality=hd');
    expect(result).not.toContain('alice');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('abc');
    expect(result).toContain('quality=hd');
  });

  it('redacts sensitive headers', () => {
    expect(redactHeaders({ Authorization: 'Bearer secret', 'User-Agent': 'OriVue' })).toEqual({
      Authorization: '[redacted]',
      'User-Agent': 'OriVue',
    });
  });
});
