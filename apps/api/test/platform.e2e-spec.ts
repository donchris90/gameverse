import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD, registerUser, uniqueEmail } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('health, errors and HTTP hardening', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ CORS_ORIGINS: 'https://admin.gameverse.test' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  describe('health endpoints', () => {
    it('liveness answers without touching dependencies', async () => {
      const response = await request(t.server).get('/health/live').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('readiness confirms the database is reachable', async () => {
      const response = await request(t.server).get('/health/ready').expect(200);
      expect(response.body).toEqual({ status: 'ok', checks: { database: 'up' } });
    });

    it('lives outside the versioned prefix', async () => {
      await request(t.server).get('/v1/health/live').expect(404);
    });
  });

  describe('error envelope', () => {
    it('renders unknown routes in the standard envelope with a request id and no internals', async () => {
      const response = await request(t.server).get('/v1/does-not-exist').expect(404);
      expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Resource not found' });
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|at .*\(/i);
    });

    it('renders malformed JSON as a 400 validation error', async () => {
      const response = await request(t.server)
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "a@b.co", ')
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects oversized request bodies', async () => {
      const response = await request(t.server)
        .post('/v1/auth/login')
        .send({ email: 'a@b.co', password: 'x'.repeat(200_000) });
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('does not leak server internals for validation failures on non-JSON content', async () => {
      const response = await request(t.server)
        .post('/v1/auth/login')
        .set('Content-Type', 'text/plain')
        .send('hello');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('echoes a well-formed inbound request id and replaces a malformed one', async () => {
      const good = await request(t.server)
        .get('/v1/me')
        .set('X-Request-Id', 'trace-abc-123456')
        .expect(401);
      expect(good.headers['x-request-id']).toBe('trace-abc-123456');
      expect(good.body.requestId).toBe('trace-abc-123456');

      const bad = await request(t.server)
        .get('/v1/me')
        .set('X-Request-Id', 'bad id\twith spaces')
        .expect(401);
      expect(bad.headers['x-request-id']).not.toContain(' ');
      expect(bad.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
    });
  });

  describe('security headers and CORS', () => {
    it('sets hardening headers and does not advertise the framework', async () => {
      const response = await request(t.server).get('/health/live').expect(200);
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    it('allows only the configured browser origins', async () => {
      const allowed = await request(t.server)
        .get('/health/live')
        .set('Origin', 'https://admin.gameverse.test');
      expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.gameverse.test');

      const denied = await request(t.server)
        .get('/health/live')
        .set('Origin', 'https://evil.example.test');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('privacy of the account view', () => {
    it('never exposes the date of birth or password hash through any auth response', async () => {
      const { session } = await registerUser(t);
      const me = await request(t.server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      const everything = JSON.stringify([session, me.body]);
      expect(everything).not.toMatch(/dateOfBirth|passwordHash|tokenHash|\$argon2/);
    });
  });
});

describe('CORS disabled by default', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(); // CORS_ORIGINS unset
  });
  afterAll(async () => {
    await t.close();
  });

  it('sends no CORS headers when no origins are configured', async () => {
    const response = await request(t.server)
      .get('/health/live')
      .set('Origin', 'https://anything.example.test');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  describe('per client IP on /v1/auth/*', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ RATE_LIMIT_AUTH_PER_MIN: '3' });
    });
    afterAll(async () => {
      await t.close();
    });

    it('answers 429 in the standard envelope once the limit is exceeded', async () => {
      const call = () =>
        request(t.server)
          .post('/v1/auth/forgot-password')
          .send({ email: uniqueEmail('rl') });
      for (let i = 0; i < 3; i++) await call().expect(202);

      const limited = await call().expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      // Standard header that clients use for backoff: a positive whole number of seconds.
      const retryAfter = Number(limited.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('never rate limits the health probes', async () => {
      for (let i = 0; i < 25; i++) await request(t.server).get('/health/live').expect(200);
      for (let i = 0; i < 25; i++) await request(t.server).get('/health/ready').expect(200);
    });
  });

  describe('when not behind a trusted proxy', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ RATE_LIMIT_AUTH_PER_MIN: '3', TRUST_PROXY: 'false' });
    });
    afterAll(async () => {
      await t.close();
    });

    it('cannot be bypassed by spoofing X-Forwarded-For', async () => {
      const call = (spoofedIp: string) =>
        request(t.server)
          .post('/v1/auth/forgot-password')
          .set('X-Forwarded-For', spoofedIp)
          .send({ email: uniqueEmail('spoof') });
      await call('203.0.113.1').expect(202);
      await call('203.0.113.2').expect(202);
      await call('203.0.113.3').expect(202);
      await call('203.0.113.4').expect(429);
    });
  });

  describe('login attempts per target email', () => {
    let t: TestApp;
    beforeAll(async () => {
      // Trusted proxy so each request can arrive from a different client IP: only the per-email
      // limiter can then be responsible for blocking a distributed attack on one account.
      t = await createTestApp({ RATE_LIMIT_AUTH_PER_MIN: '5', TRUST_PROXY: 'true' });
    });
    afterAll(async () => {
      await t.close();
    });
    beforeEach(async () => {
      await resetDatabase(t.prisma);
    });

    const attempt = (email: string, ip: string, password: string) =>
      request(t.server).post('/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });

    it('throttles repeated guesses against one account even when they come from many IPs', async () => {
      const { email } = await registerUser(t);
      for (let i = 1; i <= 5; i++) {
        await attempt(email, `198.51.100.${i}`, 'wrong-guess-number-' + i).expect(401);
      }
      const blocked = await attempt(email, '198.51.100.99', 'wrong-guess-number-6').expect(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      // Even the correct password is refused while the account is being hammered.
      await attempt(email, '198.51.100.100', DEFAULT_PASSWORD).expect(429);
    });

    it('does not let one account being attacked lock out other accounts', async () => {
      const victim = await registerUser(t);
      const bystander = await registerUser(t);
      for (let i = 1; i <= 5; i++) {
        await attempt(victim.email, `192.0.2.${i}`, 'wrong-guess-' + i).expect(401);
      }
      await attempt(victim.email, '192.0.2.50', 'wrong-guess-again').expect(429);
      await attempt(bystander.email, '192.0.2.60', bystander.password).expect(200);
    });
  });
});
