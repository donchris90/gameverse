import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  DEFAULT_PASSWORD,
  login,
  registerUser,
  sha256,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('email verification', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.email.clear();
  });

  const verify = (token: string) => request(t.server).post('/v1/auth/verify-email').send({ token });

  it('verifies the email from the link and marks the account verified', async () => {
    const { email, session } = await registerUser(t);
    await verify(tokenFromLastEmail(t, email)).expect(200);

    const me = await request(t.server).get('/v1/me').set(bearer(session)).expect(200);
    expect(me.body.emailVerified).toBe(true);
  });

  it('stores only a hash of the token', async () => {
    const { email } = await registerUser(t);
    const raw = tokenFromLastEmail(t, email);
    const row = await t.prisma.oneTimeToken.findFirstOrThrow({
      where: { type: 'EMAIL_VERIFICATION' },
    });
    expect(row.tokenHash).toBe(sha256(raw));
    expect(row.tokenHash).not.toBe(raw);
  });

  it('is single use', async () => {
    const { email } = await registerUser(t);
    const token = tokenFromLastEmail(t, email);
    await verify(token).expect(200);
    const again = await verify(token).expect(400);
    expect(again.body.error.code).toBe('ONE_TIME_TOKEN_INVALID');
  });

  it('allows only one of many simultaneous uses of the same link', async () => {
    const { email } = await registerUser(t);
    const token = tokenFromLastEmail(t, email);
    const responses = await Promise.all(Array.from({ length: 6 }, () => verify(token)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(5);
  });

  it('rejects unknown and expired tokens', async () => {
    const { email } = await registerUser(t);
    await verify('z'.repeat(43)).expect(400);

    const token = tokenFromLastEmail(t, email);
    await t.prisma.oneTimeToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await verify(token).expect(400);
    expect(expired.body.error.code).toBe('ONE_TIME_TOKEN_INVALID');
  });

  it('does not accept a password-reset token as a verification token', async () => {
    const { email } = await registerUser(t);
    await request(t.server).post('/v1/auth/forgot-password').send({ email }).expect(202);
    const resetToken = tokenFromLastEmail(t, email); // last email is the reset link
    await verify(resetToken).expect(400);
  });

  it('resend requires authentication', async () => {
    await request(t.server).post('/v1/auth/resend-verification').expect(401);
  });

  it('resend is rate-limited per user, then replaces the previous link', async () => {
    const { email, session } = await registerUser(t);
    const firstLink = tokenFromLastEmail(t, email);

    const tooSoon = await request(t.server)
      .post('/v1/auth/resend-verification')
      .set(bearer(session))
      .expect(429);
    expect(tooSoon.body.error.code).toBe('VERIFICATION_TOO_SOON');

    await t.prisma.oneTimeToken.updateMany({
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });
    await request(t.server).post('/v1/auth/resend-verification').set(bearer(session)).expect(202);
    expect(t.email.outbox).toHaveLength(2);

    const secondLink = tokenFromLastEmail(t, email);
    expect(secondLink).not.toBe(firstLink);
    await verify(firstLink).expect(400);
    await verify(secondLink).expect(200);
  });

  it('resend is a no-op for an already verified account', async () => {
    const { email, session } = await registerUser(t);
    await verify(tokenFromLastEmail(t, email)).expect(200);
    t.email.clear();

    const response = await request(t.server)
      .post('/v1/auth/resend-verification')
      .set(bearer(session))
      .expect(202);
    expect(response.body.message).toMatch(/already verified/i);
    expect(t.email.outbox).toHaveLength(0);
  });
});

describe('password reset', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.email.clear();
  });

  const forgot = (email: string) =>
    request(t.server).post('/v1/auth/forgot-password').send({ email });
  const reset = (token: string, newPassword: string) =>
    request(t.server).post('/v1/auth/reset-password').send({ token, newPassword });

  it('answers identically whether or not the email is registered, and only emails real accounts', async () => {
    const { email } = await registerUser(t);
    t.email.clear();

    const known = await forgot(email).expect(202);
    expect(t.email.outbox).toHaveLength(1);
    expect(t.email.last(email)?.subject).toMatch(/reset/i);

    t.email.clear();
    const unknown = await forgot(uniqueEmail('ghost')).expect(202);
    expect(t.email.outbox).toHaveLength(0);
    expect(unknown.body).toEqual(known.body);
  });

  it('does not send reset emails to banned accounts', async () => {
    const { email } = await registerUser(t);
    await t.prisma.user.update({ where: { email }, data: { status: 'BANNED' } });
    t.email.clear();
    await forgot(email).expect(202);
    expect(t.email.outbox).toHaveLength(0);
  });

  it('sets the new password, retires the old one and ends every existing session', async () => {
    const { email, password, session } = await registerUser(t);
    const otherDevice = await login(t, email, password);
    await forgot(email).expect(202);

    const newPassword = 'a-brand-new-passphrase-42';
    await reset(tokenFromLastEmail(t, email), newPassword).expect(200);

    await request(t.server).post('/v1/auth/login').send({ email, password }).expect(401);
    await login(t, email, newPassword);

    for (const token of [session.refreshToken, otherDevice.refreshToken]) {
      await request(t.server).post('/v1/auth/refresh').send({ refreshToken: token }).expect(401);
    }
  });

  it('is single use and rejects expired or unknown tokens', async () => {
    const { email } = await registerUser(t);
    await forgot(email).expect(202);
    const token = tokenFromLastEmail(t, email);

    await reset(token, 'a-brand-new-passphrase-42').expect(200);
    const reuse = await reset(token, 'another-new-passphrase-43').expect(400);
    expect(reuse.body.error.code).toBe('ONE_TIME_TOKEN_INVALID');

    await reset('q'.repeat(43), 'a-brand-new-passphrase-42').expect(400);

    await forgot(email).expect(202);
    const fresh = tokenFromLastEmail(t, email);
    await t.prisma.oneTimeToken.updateMany({
      where: { type: 'PASSWORD_RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await reset(fresh, 'a-brand-new-passphrase-42').expect(400);
  });

  it('allows only one of many simultaneous uses of the same reset link', async () => {
    const { email } = await registerUser(t);
    await forgot(email).expect(202);
    const token = tokenFromLastEmail(t, email);
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) => reset(token, `a-brand-new-passphrase-${i}x`)),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 400)).toHaveLength(5);
  });

  it('does not consume the token when the new password is too weak', async () => {
    const { email } = await registerUser(t);
    await forgot(email).expect(202);
    const token = tokenFromLastEmail(t, email);

    const weak = await reset(token, 'short').expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    await reset(token, 'a-brand-new-passphrase-42').expect(200);
  });

  it('only the newest reset link works', async () => {
    const { email } = await registerUser(t);
    await forgot(email).expect(202);
    const first = tokenFromLastEmail(t, email);
    await forgot(email).expect(202);
    const second = tokenFromLastEmail(t, email);
    expect(second).not.toBe(first);

    await reset(first, 'a-brand-new-passphrase-42').expect(400);
    await reset(second, 'a-brand-new-passphrase-42').expect(200);
  });

  it('a reset also proves mailbox ownership, so it verifies the email', async () => {
    const { email, session } = await registerUser(t);
    await forgot(email).expect(202);
    await reset(tokenFromLastEmail(t, email), 'a-brand-new-passphrase-42').expect(200);

    const fresh = await login(t, email, 'a-brand-new-passphrase-42');
    const me = await request(t.server).get('/v1/me').set(bearer(fresh)).expect(200);
    expect(me.body.emailVerified).toBe(true);
    // (the session issued before the reset is gone, as asserted elsewhere)
    expect(session.user.id).toBe(me.body.id);
  });

  it('cannot be used to log in with the previous default password afterwards', async () => {
    const { email } = await registerUser(t);
    await forgot(email).expect(202);
    await reset(tokenFromLastEmail(t, email), 'a-brand-new-passphrase-42').expect(200);
    await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(401);
  });
});
