import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

const service = new PasswordService();

describe('PasswordService', () => {
  it('hashes with argon2id using the configured cost parameters and a random salt', async () => {
    const [a, b] = await Promise.all([
      service.hash('hunter2-hunter2'),
      service.hash('hunter2-hunter2'),
    ]);
    expect(a).toMatch(/^\$argon2id\$v=19\$/);
    // PHC format: $argon2id$v=19$<params>$<salt>$<hash>. Compare parameter values, not their order.
    const params = Object.fromEntries(
      (a.split('$')[3] ?? '').split(',').map((pair) => pair.split('=') as [string, string]),
    );
    expect(params).toEqual({ m: '19456', t: '2', p: '1' }); // OWASP minimum: 19 MiB, 2 passes, 1 lane
    expect(a).not.toBe(b); // different salts
    expect(a).not.toContain('hunter2');
  });

  it('verifies the right password and rejects wrong ones', async () => {
    const hash = await service.hash('a-good-passphrase-1');
    expect(await service.verify(hash, 'a-good-passphrase-1')).toBe(true);
    expect(await service.verify(hash, 'a-good-passphrase-2')).toBe(false);
    expect(await service.verify(hash, '')).toBe(false);
  });

  it('treats a malformed stored hash as a failed verification, never as success', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
    expect(await service.verify('', 'anything')).toBe(false);
  });

  it('spends comparable time on the dummy path so unknown emails are not distinguishable by latency', async () => {
    await service.verifyAgainstDummy('warm-up'); // builds the cached dummy hash
    const hash = await service.hash('a-good-passphrase-1');

    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };
    const real = await time(() => service.verify(hash, 'wrong-password-123'));
    const dummy = await time(() => service.verifyAgainstDummy('wrong-password-123'));
    // Both run a full argon2 verification; allow generous slack for CI jitter.
    expect(dummy).toBeGreaterThan(real / 4);
    expect(dummy).toBeGreaterThan(5);
  });
});
