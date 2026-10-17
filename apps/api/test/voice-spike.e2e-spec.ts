import { inflateSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const APP_ID = '0123456789abcdef0123456789abcdef';
const CERTIFICATE = 'fedcba9876543210fedcba9876543210';

describe('voice spike token endpoint (enabled, configured)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      VOICE_SPIKE_ENABLED: 'true',
      AGORA_APP_ID: APP_ID,
      AGORA_APP_CERTIFICATE: CERTIFICATE,
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  it('requires authentication', async () => {
    const response = await request(t.server)
      .post('/v1/voice/spike/token')
      .send({ channel: 'spike-room' })
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('gives two different users different uids on the same channel, never exposing the certificate', async () => {
    const one = await registerUser(t);
    const two = await registerUser(t);
    const call = (accessToken: string) =>
      request(t.server)
        .post('/v1/voice/spike/token')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ channel: 'spike-room' })
        .expect(200);

    const a = (await call(one.session.accessToken)).body;
    const b = (await call(two.session.accessToken)).body;
    expect(a.channel).toBe('spike-room');
    expect(a.appId).toBe(APP_ID);
    expect(a.uid).not.toBe(b.uid);
    expect(a.token.startsWith('007')).toBe(true);
    expect(JSON.stringify(a)).not.toContain(CERTIFICATE);
    expect(inflateSync(Buffer.from(a.token.slice(3), 'base64')).toString('latin1')).not.toContain(
      CERTIFICATE,
    );
    expect(new Date(a.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    'room',
    'spike-',
    'spike-UPPER',
    'spike-has space',
    'match-123456',
    'spike-' + 'x'.repeat(40),
  ])('rejects the channel name %j', async (channel) => {
    const user = await registerUser(t);
    const response = await request(t.server)
      .post('/v1/voice/spike/token')
      .set('Authorization', `Bearer ${user.session.accessToken}`)
      .send({ channel })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('voice spike token endpoint (disabled or unconfigured)', () => {
  it('returns 404 when the spike flag is off, even with credentials set', async () => {
    const t = await createTestApp({ AGORA_APP_ID: APP_ID, AGORA_APP_CERTIFICATE: CERTIFICATE });
    try {
      await resetDatabase(t.prisma);
      const user = await registerUser(t);
      await request(t.server)
        .post('/v1/voice/spike/token')
        .set('Authorization', `Bearer ${user.session.accessToken}`)
        .send({ channel: 'spike-room' })
        .expect(404);
    } finally {
      await t.close();
    }
  });

  it('returns 503 with no vendor details when enabled but credentials are missing', async () => {
    const t = await createTestApp({ VOICE_SPIKE_ENABLED: 'true' });
    try {
      await resetDatabase(t.prisma);
      const user = await registerUser(t);
      const response = await request(t.server)
        .post('/v1/voice/spike/token')
        .set('Authorization', `Bearer ${user.session.accessToken}`)
        .send({ channel: 'spike-room' })
        .expect(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toMatch(/agora|certificate/i);
    } finally {
      await t.close();
    }
  });
});
