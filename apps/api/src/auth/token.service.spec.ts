import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { AppException } from '../common/app.exception.js';
import { TokenService } from './token.service.js';

const SECRET = 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT';
const config = loadConfig({
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  JWT_ACCESS_SECRET: SECRET,
});
const service = new TokenService(config);

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
}

describe('TokenService access tokens', () => {
  it('round-trips subject and role', async () => {
    const { token, expiresIn } = await service.signAccessToken({ id: 'user-1', role: 'MODERATOR' });
    expect(expiresIn).toBe(900);
    expect(await service.verifyAccessToken(token)).toEqual({ sub: 'user-1', role: 'MODERATOR' });
  });

  it('rejects tokens signed with a different secret', async () => {
    const other = new TokenService(
      loadConfig({
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
        JWT_ACCESS_SECRET: 'Zq8Lw3Nv6Ty1Hk5Pb9Rc2Md7Xf4Jg0Sa8Uo3Ie5',
      }),
    );
    const { token } = await other.signAccessToken({ id: 'user-1', role: 'USER' });
    await expectCode(service.verifyAccessToken(token), 'TOKEN_INVALID');
  });

  it('reports expiry distinctly from other failures', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('gameverse-api')
      .setAudience('gameverse-app')
      .setIssuedAt(now - 120)
      .setExpirationTime(now - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expectCode(service.verifyAccessToken(expired), 'TOKEN_EXPIRED');
  });

  it('rejects tokens that are missing required claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const noRole = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('gameverse-api')
      .setAudience('gameverse-app')
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode(SECRET));
    await expectCode(service.verifyAccessToken(noRole), 'TOKEN_INVALID');
  });

  it('rejects other signing algorithms even with the right secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const hs512 = await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('user-1')
      .setIssuer('gameverse-api')
      .setAudience('gameverse-app')
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode(SECRET));
    await expectCode(service.verifyAccessToken(hs512), 'TOKEN_INVALID');
  });
});

describe('TokenService opaque tokens', () => {
  it('generates unique, URL-safe, 256-bit tokens', () => {
    const tokens = Array.from({ length: 200 }, () => service.generateOpaqueToken());
    expect(new Set(tokens.map((t) => t.raw)).size).toBe(200);
    for (const { raw } of tokens) {
      expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes -> 43 base64url chars
    }
  });

  it('hashes deterministically with SHA-256 and never returns the raw token as the hash', () => {
    const { raw, hash } = service.generateOpaqueToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(raw);
    expect(service.hashOpaqueToken(raw)).toBe(hash);
    expect(service.hashOpaqueToken(raw + 'x')).not.toBe(hash);
  });
});
