import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('rate limits: friend requests', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_FRIEND_REQUESTS_PER_HOUR: '3' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const send = (from: SocialUser, to: SocialUser) =>
    request(t.server).post('/v1/friends/requests').set(from.auth).send({ userId: to.id });

  it('stops a session sending a flood of friend requests, in the standard envelope', async () => {
    const spammer = await registerWithProfile(t);
    const targets = await Promise.all(Array.from({ length: 5 }, () => registerWithProfile(t)));
    for (const target of targets.slice(0, 3)) await send(spammer, target).expect(200);
    const blocked = await send(spammer, targets[3] as SocialUser).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    // Nothing was created by the refused call.
    const sent = await request(t.server)
      .get('/v1/friends/requests?direction=outgoing')
      .set(spammer.auth)
      .expect(200);
    expect(sent.body.items).toHaveLength(3);
  });

  it('is per session: another player is not affected, and reading is never limited', async () => {
    const spammer = await registerWithProfile(t);
    const other = await registerWithProfile(t);
    const targets = await Promise.all(Array.from({ length: 4 }, () => registerWithProfile(t)));
    for (const target of targets.slice(0, 3)) await send(spammer, target).expect(200);
    await send(spammer, targets[3] as SocialUser).expect(429);
    await send(other, targets[3] as SocialUser).expect(200);
    await request(t.server).get('/v1/friends').set(spammer.auth).expect(200);
  });

  it('a stranger cannot burn someone else’s allowance with a forged token', async () => {
    const victim = await registerWithProfile(t);
    const target = await registerWithProfile(t);
    for (let i = 0; i < 6; i += 1) {
      await request(t.server)
        .post('/v1/friends/requests')
        .set('Authorization', `Bearer forged.${String(i)}.token`)
        .send({ userId: target.id })
        .expect((res) => expect([401, 429]).toContain(res.status));
    }
    await send(victim, target).expect(200);
  });
});
