import { decodeJwt, decodeProtectedHeader } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSWORD,
  dateOfBirthForAge,
  registerUser,
  sha256,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('registration', () => {
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

  it('creates an account and returns a session without any sensitive fields', async () => {
    const email = uniqueEmail();
    const response = await request(t.server)
      .post('/v1/auth/register')
      .send({
        email: ` ${email.toUpperCase()} `,
        password: DEFAULT_PASSWORD,
        dateOfBirth: dateOfBirthForAge(25),
        acceptedTerms: true,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
      user: { email, emailVerified: false, role: 'USER', status: 'ACTIVE' },
    });
    expect(Object.keys(response.body.user).sort()).toEqual(
      ['createdAt', 'email', 'emailVerified', 'id', 'role', 'status'].sort(),
    );
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('dateOfBirth');
  });

  it('stores only an argon2id hash of the password and a hash of the refresh token', async () => {
    const { email, session } = await registerUser(t);
    const row = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(DEFAULT_PASSWORD);

    const stored = await t.prisma.refreshToken.findFirstOrThrow({ where: { userId: row.id } });
    expect(stored.tokenHash).toBe(sha256(session.refreshToken));
    expect(stored.tokenHash).not.toBe(session.refreshToken);
  });

  it('issues a correctly shaped, short-lived HS256 access token', async () => {
    const { session } = await registerUser(t);
    expect(decodeProtectedHeader(session.accessToken)).toMatchObject({ alg: 'HS256' });
    const claims = decodeJwt(session.accessToken);
    expect(claims.sub).toBe(session.user.id);
    expect(claims.iss).toBe('gameverse-api');
    expect(claims.aud).toBe('gameverse-app');
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(900);
  });

  it('sends a verification email containing a one-time link', async () => {
    const { email } = await registerUser(t);
    expect(t.email.outbox).toHaveLength(1);
    expect(t.email.last(email)?.subject).toMatch(/verify/i);
    expect(tokenFromLastEmail(t, email).length).toBeGreaterThan(20);
  });

  it('records the terms acceptance', async () => {
    const { email } = await registerUser(t);
    const row = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.termsVersion).toBe('draft-1');
    expect(row.termsAcceptedAt).toBeInstanceOf(Date);
  });

  describe('age gate (minimum age 16)', () => {
    it('rejects a user who turns 16 tomorrow and stores nothing about the attempt', async () => {
      const email = uniqueEmail();
      const response = await request(t.server)
        .post('/v1/auth/register')
        .send({
          email,
          password: DEFAULT_PASSWORD,
          dateOfBirth: dateOfBirthForAge(16, 1),
          acceptedTerms: true,
        })
        .expect(403);
      expect(response.body.error.code).toBe('UNDER_MINIMUM_AGE');
      expect(await t.prisma.user.count()).toBe(0);
      expect(t.email.outbox).toHaveLength(0);
    });

    it('accepts a user who turns 16 today', async () => {
      await registerUser(t, { dateOfBirth: dateOfBirthForAge(16) });
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('rejects clearly implausible and impossible dates of birth', async () => {
      for (const dateOfBirth of ['1800-01-01', '2001-02-30', 'not-a-date', '2999-01-01']) {
        const response = await request(t.server).post('/v1/auth/register').send({
          email: uniqueEmail(),
          password: DEFAULT_PASSWORD,
          dateOfBirth,
          acceptedTerms: true,
        });
        expect([400, 403]).toContain(response.status);
      }
      expect(await t.prisma.user.count()).toBe(0);
    });
  });

  describe('validation', () => {
    it('requires explicit acceptance of the terms', async () => {
      const response = await request(t.server)
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: DEFAULT_PASSWORD,
          dateOfBirth: dateOfBirthForAge(25),
          acceptedTerms: false,
        })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a stale terms version', async () => {
      const response = await request(t.server)
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: DEFAULT_PASSWORD,
          dateOfBirth: dateOfBirthForAge(25),
          acceptedTerms: true,
          termsVersion: 'draft-0',
        })
        .expect(400);
      expect(response.body.error.code).toBe('TERMS_NOT_ACCEPTED');
    });

    it('rejects weak passwords with field-level details', async () => {
      const response = await request(t.server)
        .post('/v1/auth/register')
        .send({
          email: uniqueEmail(),
          password: 'short',
          dateOfBirth: dateOfBirthForAge(25),
          acceptedTerms: true,
        })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
      );
    });

    it('rejects a malformed email and an empty body', async () => {
      await request(t.server)
        .post('/v1/auth/register')
        .send({
          email: 'nope',
          password: DEFAULT_PASSWORD,
          dateOfBirth: dateOfBirthForAge(25),
          acceptedTerms: true,
        })
        .expect(400);
      await request(t.server).post('/v1/auth/register').send({}).expect(400);
    });
  });

  describe('duplicate emails', () => {
    it('rejects an email that is already registered, case-insensitively', async () => {
      const { email } = await registerUser(t);
      const response = await request(t.server)
        .post('/v1/auth/register')
        .send({
          email: email.toUpperCase(),
          password: DEFAULT_PASSWORD,
          dateOfBirth: dateOfBirthForAge(25),
          acceptedTerms: true,
        })
        .expect(409);
      expect(response.body.error.code).toBe('EMAIL_TAKEN');
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('lets exactly one of many simultaneous registrations for the same email succeed', async () => {
      const email = uniqueEmail();
      const body = {
        email,
        password: DEFAULT_PASSWORD,
        dateOfBirth: dateOfBirthForAge(25),
        acceptedTerms: true,
      };
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => request(t.server).post('/v1/auth/register').send(body)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(await t.prisma.user.count({ where: { email } })).toBe(1);
    });
  });
});

describe('password login', () => {
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

  it('signs in with correct credentials, case-insensitive on email, and records last login', async () => {
    const { email, password, session } = await registerUser(t);
    const response = await request(t.server)
      .post('/v1/auth/login')
      .send({ email: email.toUpperCase(), password })
      .expect(200);
    expect(response.body.user.id).toBe(session.user.id);
    expect(response.body.refreshToken).not.toBe(session.refreshToken);

    const row = await t.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.lastLoginAt).toBeInstanceOf(Date);
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    const { email } = await registerUser(t);
    const wrongPassword = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: 'definitely-the-wrong-password' })
      .expect(401);
    const unknownEmail = await request(t.server)
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: DEFAULT_PASSWORD })
      .expect(401);
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not allow password login for a social-only account (no password set)', async () => {
    const { email } = await registerUser(t);
    await t.prisma.user.update({ where: { email }, data: { passwordHash: null } });
    const response = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('reveals a ban or suspension only after the correct password is supplied', async () => {
    const { email, password } = await registerUser(t);
    await t.prisma.user.update({ where: { email }, data: { status: 'BANNED' } });

    const wrong = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const right = await request(t.server).post('/v1/auth/login').send({ email, password });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_BANNED');

    await t.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });
    const suspended = await request(t.server).post('/v1/auth/login').send({ email, password });
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects malformed login bodies with a validation error', async () => {
    const response = await request(t.server)
      .post('/v1/auth/login')
      .send({ email: 'nope' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
