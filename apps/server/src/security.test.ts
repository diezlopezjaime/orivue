import { describe, expect, it } from 'vitest';
import { assertSafeRemoteUrl, isPrivateAddress } from './security.js';

describe('SSRF protections', () => {
  it.each(['127.0.0.1', '10.0.0.1', '192.168.2.1', '169.254.10.1', '::1', 'fd00::1'])(
    'recognises %s as private',
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );
  it('rejects non-http protocols', async () => {
    await expect(assertSafeRemoteUrl('file:///etc/passwd')).rejects.toThrow(/HTTP/);
  });
  it('restricts proxy resources to the session origin', async () => {
    await expect(
      assertSafeRemoteUrl('https://other.test/segment.ts', {
        allowPrivateNetwork: true,
        expectedOrigins: ['https://stream.test'],
      }),
    ).rejects.toThrow(/outside/);
  });
});
