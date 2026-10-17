import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, login, registerUser, sha256 } from './helpers/factories.js';
import { createTestApp, resetDatabase, TEST_JWT_SECRET, type TestApp } from './helpers/test-app.js';

const secretKey = new TextEncoder().encode(TEST_JWT_SECRET);

async function signToken(
  claims: { sub: string; role?: string },
  options: {
    secret?: Uint8Array;
    issuer?: string;
    audience?: string;
    expiresInSeconds?: number;
    alg?: string;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: claims.role ?? 'USER' })
    .setProtectedHeader({ alg: options.alg ?? 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(options.issuer ?? 'gameverse-api')
    .setAudience(options.audience ?? 'gameverse-app')
    .setIssuedAt(now - 3600)
    .setExpirationTime(now + (options.expiresInSeconds ?? 600))
    .sign(options.secret ?? secretKey);
}

describe('access tokens and the auth guard', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  it('returns the safe account view for a valid token', async () => {
    const { session, email } = await registerUser(t);
    const response = await request(t.server).get('/v1/me').set(bearer(session)).expect(200);
    expect(response.body).toMatchObject({ id: session.user.id, email, emailVerified: false });
    expect(Object.keys(response.body).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'role', 'status'].sort(),
    );
  });

  it('rejects a missing or malformed Authorization header', async () => {
    const none = await request(t.server).get('/v1/me').expect(401);
    expect(none.body.error.code).toBe('UNAUTHENTICATED');
    await request(t.server).get('/v1/me').set('Authorization', 'Basic abc').expect(401);
    await request(t.server).get('/v1/me').set('Authorization', 'Bearer').expect(401);
  });

  it('rejects garbage, wrongly signed, wrong-issuer and wrong-audience tokens', async () => {
    const { session } = await registerUser(t);
    const id = session.user.id;
    const candidates = [
      'not.a.jwt',
      await signToken({ sub: id }, { secret: new TextEncoder().encode('x'.repeat(48)) }),
      await signToken({ sub: id }, { issuer: 'someone-else' }),
      await signToken({ sub: id }, { audience: 'some-other-app' }),
    ];
    for (const token of candidates) {
      const response = await request(t.server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(response.body.error.code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const { session } = await registerUser(t);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: session.user.id,
      role: 'ADMIN',
      iss: 'gameverse-api',
      aud: 'gameverse-app',
      exp: now + 600,
    })}.`;
    const response = await request(t.server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('reports an expired token distinctly so clients know to refresh', async () => {
    const { session } = await registerUser(t);
    const expired = await signToken({ sub: session.user.id }, { expiresInSeconds: -60 });
    const response = await request(t.server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('takes the role from the database, never from the token', async () => {
    const { session } = await registerUser(t);
    const claimsAdmin = await signToken({ sub: session.user.id, role: 'ADMIN' });
    const response = await request(t.server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${claimsAdmin}`)
      .expect(200);
    expect(response.body.role).toBe('USER');
  });

  it('rejects a validly signed token for a user that no longer exists', async () => {
    const token = await signToken({ sub: '00000000-0000-7000-8000-000000000000' });
    const response = await request(t.server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('cuts off a banned or suspended user on the very next request, before the token expires', async () => {
    const { session, email } = await registerUser(t);
    await request(t.server).get('/v1/me').set(bearer(session)).expect(200);

    await t.prisma.user.update({ where: { email }, data: { status: 'BANNED' } });
    const banned = await request(t.server).get('/v1/me').set(bearer(session)).expect(403);
    expect(banned.body.error.code).toBe('ACCOUNT_BANNED');

    await t.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
    const suspended = await request(t.server).get('/v1/me').set(bearer(session)).expect(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await t.prisma.user.update({ where: { email }, data: { status: 'ACTIVE' } });
    await request(t.server).get('/v1/me').set(bearer(session)).expect(200);
  });
});

describe('refresh tokens', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const refresh = (token: string) =>
    request(t.server).post('/v1/auth/refresh').send({ refreshToken: token });

  it('rotates: returns a new working pair and retires the old refresh token', async () => {
    const { session } = await registerUser(t);
    const response = await refresh(session.refreshToken).expect(200);
    expect(response.body.refreshToken).not.toBe(session.refreshToken);
    expect(response.body.accessToken).toEqual(expect.any(String));
    await request(t.server).get('/v1/me').set(bearer(response.body)).expect(200);
  });

  /** Pretends the rotation happened `secondsAgo` seconds ago (instead of sleeping in the test). */
  async function backdateRotation(rawToken: string, secondsAgo: number): Promise<void> {
    await t.prisma.refreshToken.update({
      where: { tokenHash: sha256(rawToken) },
      data: { revokedAt: new Date(Date.now() - secondsAgo * 1000) },
    });
  }

  it('treats replay of a token rotated long ago as theft and revokes the whole family', async () => {
    const { session } = await registerUser(t);
    const rotated = await refresh(session.refreshToken).expect(200);
    await backdateRotation(session.refreshToken, 60);

    // An attacker (or a buggy client) replays the old token well after the rotation...
    const replay = await refresh(session.refreshToken).expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_INVALID');

    // ...which also invalidates the legitimate descendant.
    await refresh(rotated.body.refreshToken).expect(401);
    expect(
      await t.prisma.refreshToken.count({ where: { userId: session.user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it('tolerates a just-rotated token (parallel requests) without signing the user out', async () => {
    const { session } = await registerUser(t);
    const first = await refresh(session.refreshToken).expect(200);

    // Immediate duplicate, as when two parallel API calls both refresh an expired access token.
    const duplicate = await refresh(session.refreshToken).expect(200);
    expect(duplicate.body.refreshToken).not.toBe(first.body.refreshToken);

    // Both resulting sessions stay valid: the family was NOT revoked.
    await refresh(first.body.refreshToken).expect(200);
    await refresh(duplicate.body.refreshToken).expect(200);
  });

  it('survives many simultaneous refreshes with the same token, each getting its own new token', async () => {
    const { session } = await registerUser(t);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => refresh(session.refreshToken)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));

    const issued = responses.map((r) => r.body.refreshToken as string);
    expect(new Set(issued).size).toBe(8);

    // Nothing was revoked by the race except the one original token.
    const live = await t.prisma.refreshToken.count({
      where: { userId: session.user.id, revokedAt: null },
    });
    expect(live).toBe(8);
  });

  it('does not extend the leeway to tokens that were logged out rather than rotated', async () => {
    const { session } = await registerUser(t);
    await request(t.server)
      .post('/v1/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    // Logged out a moment ago, still inside the leeway window, but it was a revocation not a rotation.
    await refresh(session.refreshToken).expect(401);
  });

  it('rejects unknown, malformed and expired refresh tokens', async () => {
    const { session } = await registerUser(t);
    await refresh('x'.repeat(43)).expect(401);
    await refresh('short').expect(400);

    await t.prisma.refreshToken.updateMany({
      where: { userId: session.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await refresh(session.refreshToken).expect(401);
    expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('refuses to refresh for a banned user and ends their sessions', async () => {
    const { session, email } = await registerUser(t);
    await t.prisma.user.update({ where: { email }, data: { status: 'BANNED' } });
    const response = await refresh(session.refreshToken).expect(403);
    expect(response.body.error.code).toBe('ACCOUNT_BANNED');

    await t.prisma.user.update({ where: { email }, data: { status: 'ACTIVE' } });
    await refresh(session.refreshToken).expect(401);
  });

  it('logout ends only that device session and is idempotent', async () => {
    const { session, email, password } = await registerUser(t);
    const second = await login(t, email, password);

    await request(t.server)
      .post('/v1/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    await refresh(session.refreshToken).expect(401);

    // The other device is unaffected.
    await refresh(second.refreshToken).expect(200);

    // Logging out again, or with an unknown token, is harmless.
    await request(t.server)
      .post('/v1/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    await request(t.server)
      .post('/v1/auth/logout')
      .send({ refreshToken: 'y'.repeat(43) })
      .expect(200);
  });

  it('logout-all ends every session and requires authentication', async () => {
    const { session, email, password } = await registerUser(t);
    const second = await login(t, email, password);

    await request(t.server).post('/v1/auth/logout-all').expect(401);
    await request(t.server).post('/v1/auth/logout-all').set(bearer(session)).expect(200);

    await refresh(session.refreshToken).expect(401);
    await refresh(second.refreshToken).expect(401);
  });
});
