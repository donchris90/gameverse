import { createHash } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SOCIAL_KEY_RESOLVERS } from '../src/auth/social-token.verifier.js';
import {
  bearer,
  DEFAULT_PASSWORD,
  dateOfBirthForAge,
  registerUser,
  tokenFromLastEmail,
  uniqueEmail,
} from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const GOOGLE_CLIENT = 'google-test-client.apps.example.test';
const APPLE_CLIENT = 'com.gameverse.test';
const GOOGLE_ISS = 'https://accounts.google.com';
const APPLE_ISS = 'https://appleid.apple.com';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

interface Keys {
  privateKey: PrivateKey;
  resolver: JWTVerifyGetKey;
}

async function makeKeys(kid: string): Promise<Keys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, resolver: createLocalJWKSet({ keys: [jwk] }) };
}

interface TokenOptions {
  claims?: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  privateKey?: PrivateKey;
  kid?: string;
}

describe('social sign-in (Google / Apple)', () => {
  let t: TestApp;
  let google: Keys;
  let apple: Keys;
  let rogue: Keys;

  beforeAll(async () => {
    google = await makeKeys('google-key-1');
    apple = await makeKeys('apple-key-1');
    rogue = await makeKeys('google-key-1'); // same kid, different key: must not verify
    t = await createTestApp(
      { GOOGLE_CLIENT_IDS: GOOGLE_CLIENT, APPLE_CLIENT_IDS: APPLE_CLIENT },
      (builder) =>
        builder
          .overrideProvider(SOCIAL_KEY_RESOLVERS)
          .useValue({ google: google.resolver, apple: apple.resolver }),
    );
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    t.email.clear();
  });

  async function googleToken(options: TokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email_verified: true, ...options.claims })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'google-key-1' })
      .setIssuer(options.issuer ?? GOOGLE_ISS)
      .setAudience(options.audience ?? GOOGLE_CLIENT)
      .setIssuedAt(now - 30)
      .setExpirationTime(now + (options.expiresInSeconds ?? 600))
      .sign(options.privateKey ?? google.privateKey);
  }

  async function appleToken(options: TokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email_verified: 'true', ...options.claims })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'apple-key-1' })
      .setIssuer(options.issuer ?? APPLE_ISS)
      .setAudience(options.audience ?? APPLE_CLIENT)
      .setIssuedAt(now - 30)
      .setExpirationTime(now + (options.expiresInSeconds ?? 600))
      .sign(options.privateKey ?? apple.privateKey);
  }

  const social = (body: Record<string, unknown>) =>
    request(t.server).post('/v1/auth/social').send(body);
  const newAccountDetails = () => ({
    dateOfBirth: dateOfBirthForAge(25),
    acceptedTerms: true,
  });

  describe('account creation', () => {
    it('asks for date of birth and terms before creating an account, and creates nothing yet', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-1', email: uniqueEmail('g') } });
      const response = await social({ provider: 'google', idToken }).expect(409);
      expect(response.body.error.code).toBe('REGISTRATION_DETAILS_REQUIRED');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('creates a verified, password-less account with a linked identity (Google)', async () => {
      const email = uniqueEmail('g');
      const idToken = await googleToken({ claims: { sub: 'g-2', email: email.toUpperCase() } });
      const response = await social({ provider: 'google', idToken, ...newAccountDetails() }).expect(
        200,
      );

      expect(response.body.user).toMatchObject({ email, emailVerified: true, role: 'USER' });
      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email },
        include: { identities: true },
      });
      expect(user.passwordHash).toBeNull();
      expect(user.identities).toHaveLength(1);
      expect(user.identities[0]).toMatchObject({ provider: 'GOOGLE', providerUserId: 'g-2' });
      await request(t.server).get('/v1/me').set(bearer(response.body)).expect(200);
    });

    it('creates an account from an Apple token (email_verified as the string "true")', async () => {
      const email = uniqueEmail('a');
      const idToken = await appleToken({ claims: { sub: 'a-1', email } });
      const response = await social({ provider: 'apple', idToken, ...newAccountDetails() }).expect(
        200,
      );
      expect(response.body.user.emailVerified).toBe(true);
      expect(await t.prisma.authIdentity.count({ where: { provider: 'APPLE' } })).toBe(1);
    });

    it('signs an existing identity in again without asking for registration details', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-3', email: uniqueEmail('g') } });
      const first = await social({ provider: 'google', idToken, ...newAccountDetails() }).expect(
        200,
      );
      const second = await social({ provider: 'google', idToken }).expect(200);
      expect(second.body.user.id).toBe(first.body.user.id);
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('enforces the minimum age for new social accounts', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-4', email: uniqueEmail('g') } });
      const response = await social({
        provider: 'google',
        idToken,
        dateOfBirth: dateOfBirthForAge(16, 1),
        acceptedTerms: true,
      }).expect(403);
      expect(response.body.error.code).toBe('UNDER_MINIMUM_AGE');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a stale terms version for new social accounts', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-5', email: uniqueEmail('g') } });
      const response = await social({
        provider: 'google',
        idToken,
        ...newAccountDetails(),
        termsVersion: 'draft-0',
      }).expect(400);
      expect(response.body.error.code).toBe('TERMS_NOT_ACCEPTED');
    });

    it('never creates duplicate accounts when the same identity signs in simultaneously', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-6', email: uniqueEmail('g') } });
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          social({ provider: 'google', idToken, ...newAccountDetails() }),
        ),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
      expect(statuses).toContain(200);
      expect(await t.prisma.user.count()).toBe(1);
      expect(await t.prisma.authIdentity.count()).toBe(1);
    });
  });

  describe('token verification', () => {
    const claims = () => ({ sub: 'g-bad', email: uniqueEmail('bad') });

    it('rejects tokens that fail any check, creating nothing', async () => {
      const now = Math.floor(Date.now() / 1000);
      const hs256 = await new SignJWT({ ...claims(), email_verified: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(GOOGLE_ISS)
        .setAudience(GOOGLE_CLIENT)
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .sign(new TextEncoder().encode('x'.repeat(48)));

      const bad: Array<[string, string]> = [
        [
          'signed with the wrong key',
          await googleToken({ claims: claims(), privateKey: rogue.privateKey }),
        ],
        [
          'wrong audience (another app)',
          await googleToken({ claims: claims(), audience: 'someone-else' }),
        ],
        [
          'wrong issuer',
          await googleToken({ claims: claims(), issuer: 'https://evil.example.test' }),
        ],
        ['expired', await googleToken({ claims: claims(), expiresInSeconds: -120 })],
        ['unknown key id', await googleToken({ claims: claims(), kid: 'no-such-key' })],
        ['HS256 algorithm confusion', hs256],
        ['not a jwt', 'x'.repeat(60)],
      ];
      for (const [label, idToken] of bad) {
        const response = await social({ provider: 'google', idToken, ...newAccountDetails() });
        expect(response.status, label).toBe(401);
        expect(response.body.error.code, label).toBe('SOCIAL_TOKEN_INVALID');
      }
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a payload that was tampered with after signing', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-t', email: uniqueEmail('t') } });
      const [header, , signature] = idToken.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({
          sub: 'g-t',
          email: 'victim@example.test',
          email_verified: true,
          iss: GOOGLE_ISS,
          aud: GOOGLE_CLIENT,
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString('base64url');
      const response = await social({
        provider: 'google',
        idToken: `${header}.${forgedPayload}.${signature}`,
        ...newAccountDetails(),
      }).expect(401);
      expect(response.body.error.code).toBe('SOCIAL_TOKEN_INVALID');
    });

    it('does not accept a token issued for one provider as the other', async () => {
      const googleIssued = await googleToken({ claims: claims() });
      await social({ provider: 'apple', idToken: googleIssued, ...newAccountDetails() }).expect(
        401,
      );
      const appleIssued = await appleToken({ claims: claims() });
      await social({ provider: 'google', idToken: appleIssued, ...newAccountDetails() }).expect(
        401,
      );
    });

    it('refuses to create or link an account when the provider has not verified the email', async () => {
      const idToken = await googleToken({
        claims: { sub: 'g-u', email: uniqueEmail('u'), email_verified: false },
      });
      const response = await social({ provider: 'google', idToken, ...newAccountDetails() }).expect(
        403,
      );
      expect(response.body.error.code).toBe('SOCIAL_EMAIL_NOT_VERIFIED');
      expect(await t.prisma.user.count()).toBe(0);
    });

    it('rejects a first-time sign-in whose token carries no email', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-noemail' } });
      const response = await social({ provider: 'google', idToken, ...newAccountDetails() }).expect(
        401,
      );
      expect(response.body.error.code).toBe('SOCIAL_TOKEN_INVALID');
    });

    describe('nonce', () => {
      it('accepts a matching raw nonce or its SHA-256 hex digest', async () => {
        const raw = 'a-random-client-nonce-123';
        const hashed = createHash('sha256').update(raw).digest('hex');

        const rawOk = await googleToken({
          claims: { sub: 'n-1', email: uniqueEmail('n'), nonce: raw },
        });
        await social({
          provider: 'google',
          idToken: rawOk,
          nonce: raw,
          ...newAccountDetails(),
        }).expect(200);

        const hashedOk = await appleToken({
          claims: { sub: 'n-2', email: uniqueEmail('n'), nonce: hashed },
        });
        await social({
          provider: 'apple',
          idToken: hashedOk,
          nonce: raw,
          ...newAccountDetails(),
        }).expect(200);
      });

      it('rejects a mismatched nonce, and a nonce the token does not carry', async () => {
        const withNonce = await googleToken({
          claims: { sub: 'n-3', email: uniqueEmail('n'), nonce: 'the-real-nonce-value' },
        });
        await social({
          provider: 'google',
          idToken: withNonce,
          nonce: 'a-different-nonce-value',
          ...newAccountDetails(),
        }).expect(401);

        const withoutNonce = await googleToken({ claims: { sub: 'n-4', email: uniqueEmail('n') } });
        await social({
          provider: 'google',
          idToken: withoutNonce,
          nonce: 'client-sent-a-nonce-anyway',
          ...newAccountDetails(),
        }).expect(401);
        // Both attempts were rejected, so no account may have been created.
        expect(await t.prisma.user.count()).toBe(0);
      });
    });
  });

  describe('linking to existing accounts', () => {
    it('links to an existing email-verified account without disturbing its password', async () => {
      const { email, password, session } = await registerUser(t);
      await request(t.server)
        .post('/v1/auth/verify-email')
        .send({ token: tokenFromLastEmail(t, email) })
        .expect(200);

      const idToken = await googleToken({ claims: { sub: 'g-link', email } });
      const response = await social({ provider: 'google', idToken }).expect(200);
      expect(response.body.user.id).toBe(session.user.id);

      await request(t.server).post('/v1/auth/login').send({ email, password }).expect(200);
      expect(await t.prisma.authIdentity.count({ where: { userId: session.user.id } })).toBe(1);
    });

    it('defeats pre-hijacking: linking an unverified email-and-password account wipes the squatter out', async () => {
      // An attacker registers the victim's address first, knowing its password, and never verifies it.
      const victimEmail = uniqueEmail('victim');
      const attacker = await registerUser(t, {
        email: victimEmail,
        password: 'attacker-knows-this-one',
      });
      expect(attacker.session.user.emailVerified).toBe(false);

      // The real owner later signs in with Google, which proves ownership of the mailbox.
      const idToken = await googleToken({ claims: { sub: 'g-victim', email: victimEmail } });
      const response = await social({ provider: 'google', idToken }).expect(200);
      expect(response.body.user).toMatchObject({
        id: attacker.session.user.id,
        emailVerified: true,
      });

      // The attacker's password and live session no longer work.
      await request(t.server)
        .post('/v1/auth/login')
        .send({ email: victimEmail, password: 'attacker-knows-this-one' })
        .expect(401);
      await request(t.server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: attacker.session.refreshToken })
        .expect(401);
      const row = await t.prisma.user.findUniqueOrThrow({ where: { email: victimEmail } });
      expect(row.passwordHash).toBeNull();

      // The attacker's still-unused verification link is gone too.
      expect(await t.prisma.oneTimeToken.count({ where: { userId: row.id } })).toBe(0);
    });

    it('refuses banned accounts, both new sign-ins and existing identities', async () => {
      const idToken = await googleToken({ claims: { sub: 'g-ban', email: uniqueEmail('ban') } });
      const created = await social({ provider: 'google', idToken, ...newAccountDetails() }).expect(
        200,
      );
      await t.prisma.user.update({
        where: { id: created.body.user.id },
        data: { status: 'BANNED' },
      });

      const again = await social({ provider: 'google', idToken }).expect(403);
      expect(again.body.error.code).toBe('ACCOUNT_BANNED');
    });
  });
});

describe('social sign-in when no provider is configured', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(); // no GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS
  });
  afterAll(async () => {
    await t.close();
  });

  it('answers honestly that the provider is not configured, instead of pretending to work', async () => {
    for (const provider of ['google', 'apple']) {
      const response = await request(t.server)
        .post('/v1/auth/social')
        .send({ provider, idToken: 'x'.repeat(60) })
        .expect(503);
      expect(response.body.error.code).toBe('SOCIAL_PROVIDER_NOT_CONFIGURED');
    }
  });

  it('password registration is unaffected', async () => {
    await resetDatabase(t.prisma);
    const { session } = await registerUser(t, { password: DEFAULT_PASSWORD });
    expect(session.user.status).toBe('ACTIVE');
  });
});
