import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchView, VoiceSessionView, VoiceTokenView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { VoiceService } from '../src/voice/voice.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('voice in matches', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ VOICE_PROVIDER: 'fake' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const matches = () => t.app.get(MatchesService);
  const voice = () => t.app.get(VoiceService);
  const tokenOf = (user: SocialUser, matchId: string) =>
    request(t.server).post(`/v1/matches/${matchId}/voice/token`).set(user.auth).send({});
  const joinedOf = (user: SocialUser, matchId: string) =>
    request(t.server).post(`/v1/matches/${matchId}/voice/joined`).set(user.auth).send({});
  const leftOf = (user: SocialUser, matchId: string) =>
    request(t.server).post(`/v1/matches/${matchId}/voice/left`).set(user.auth).send({});

  async function humanMatch() {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await matches().createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    return { a, b, id };
  }

  describe('token', () => {
    it('requires authentication', async () => {
      const { id } = await humanMatch();
      await request(t.server).post(`/v1/matches/${id}/voice/token`).send({}).expect(401);
    });

    it('gives each player their own uid on a channel named after the match', async () => {
      const { a, b, id } = await humanMatch();
      const forA = (await tokenOf(a, id).expect(200)).body as VoiceTokenView;
      const forB = (await tokenOf(b, id).expect(200)).body as VoiceTokenView;
      const channel = `match_${id.replaceAll('-', '')}`;
      expect(forA.channel).toBe(channel);
      expect(forB.channel).toBe(channel);
      expect([forA.uid, forB.uid]).toEqual([1, 2]);
      expect(forA.token).toBe(`fake.${channel}.1.${String(Date.parse(forA.expiresAt) / 1000)}`);
      expect(forA.participants.map((p) => [p.uid, p.userId, p.username])).toEqual([
        [1, a.id, a.username],
        [2, b.id, b.username],
      ]);
    });

    it('is short lived and says when to renew', async () => {
      const { a, id } = await humanMatch();
      const now = new Date('2026-10-19T10:00:00.000Z');
      const grant = await voice().token(a.id, id, now);
      expect(grant.expiresAt).toBe('2026-10-19T10:10:00.000Z');
      expect(grant.serverTime).toBe(now.toISOString());
      expect(grant.renewInSeconds).toBe(540);
    });

    it('answers a stranger exactly like a missing match', async () => {
      const { id } = await humanMatch();
      const stranger = await registerWithProfile(t);
      const missing = await tokenOf(stranger, '0190e5a0-0000-7000-8000-000000000000').expect(404);
      const notMember = await tokenOf(stranger, id).expect(404);
      expect(notMember.body.error).toEqual(missing.body.error);
      await joinedOf(stranger, id).expect(404);
      await leftOf(stranger, id).expect(404);
      await request(t.server)
        .post('/v1/matches/not-a-uuid/voice/token')
        .set(stranger.auth)
        .send({})
        .expect(400);
    });

    it('is refused in a bot match: bots have no voice', async () => {
      const user = await registerWithProfile(t);
      const match = (
        await request(t.server)
          .post('/v1/matches/bot')
          .set(user.auth)
          .send({ gameId: 'tictactoe', level: 'easy' })
          .expect(201)
      ).body as MatchView;
      const response = await tokenOf(user, match.id).expect(409);
      expect(response.body.error.code).toBe('VOICE_UNAVAILABLE');
      await joinedOf(user, match.id).expect(409);
    });

    it('is refused once the match is over', async () => {
      const { a, b, id } = await humanMatch();
      await request(t.server).post(`/v1/matches/${id}/leave`).set(a.auth).send({}).expect(200);
      for (const user of [a, b]) {
        const response = await tokenOf(user, id).expect(409);
        expect(response.body.error.code).toBe('VOICE_UNAVAILABLE');
      }
    });

    it('is refused for both players when either has blocked the other', async () => {
      const { a, b, id } = await humanMatch();
      await tokenOf(a, id).expect(200);
      await request(t.server).post('/v1/blocks').set(b.auth).send({ userId: a.id }).expect(204);
      for (const user of [a, b]) {
        const response = await tokenOf(user, id).expect(409);
        expect(response.body.error.code).toBe('VOICE_UNAVAILABLE');
      }
      await joinedOf(a, id).expect(409);
    });

    it('limits token requests per account', async () => {
      const { a, b, id } = await humanMatch();
      for (let i = 0; i < 10; i += 1) await tokenOf(a, id).expect(200);
      const response = await tokenOf(a, id).expect(429);
      expect(response.body.error.code).toBe('RATE_LIMITED');
      await tokenOf(b, id).expect(200); // another account is unaffected
    });
  });

  describe('usage sessions', () => {
    it('logs a join once however often it is repeated, and each player separately', async () => {
      const { a, b, id } = await humanMatch();
      const first = (await joinedOf(a, id).expect(200)).body as VoiceSessionView;
      const again = (await joinedOf(a, id).expect(200)).body as VoiceSessionView;
      await joinedOf(b, id).expect(200);
      expect(again.id).toBe(first.id);
      expect(first).toMatchObject({ matchId: id, leftAt: null, seconds: null });
      const rows = await t.prisma.voiceSession.findMany({ where: { matchId: id } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.agoraUid).sort()).toEqual([1, 2]);
      expect(rows.every((r) => r.channel === `match_${id.replaceAll('-', '')}`)).toBe(true);
    });

    it('records how long a player was in voice and ignores a second leave', async () => {
      const { a, id } = await humanMatch();
      const joinedAt = new Date('2026-10-19T10:00:00.000Z');
      await voice().joined(a.id, id, joinedAt);
      const closed = await voice().left(a.id, id, new Date('2026-10-19T10:03:30.000Z'));
      expect(closed).toEqual({ closed: 1 });
      expect(await voice().left(a.id, id, new Date('2026-10-19T10:09:00.000Z'))).toEqual({
        closed: 0,
      });
      const row = await t.prisma.voiceSession.findFirstOrThrow({ where: { matchId: id } });
      expect(row).toMatchObject({ seconds: 210, endReason: 'left' });
      expect(row.leftAt?.toISOString()).toBe('2026-10-19T10:03:30.000Z');
    });

    it('leaving over HTTP closes the session; rejoining starts a new one', async () => {
      const { a, id } = await humanMatch();
      await joinedOf(a, id).expect(200);
      expect((await leftOf(a, id).expect(200)).body).toEqual({ closed: 1 });
      await joinedOf(a, id).expect(200);
      const rows = await t.prisma.voiceSession.findMany({
        where: { matchId: id },
        orderBy: { joinedAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.leftAt).not.toBeNull();
      expect(rows[1]?.leftAt).toBeNull();
    });

    it('never counts a leave before the join (clock skew) as negative time', async () => {
      const { a, id } = await humanMatch();
      await voice().joined(a.id, id, new Date('2026-10-19T10:00:10.000Z'));
      await voice().left(a.id, id, new Date('2026-10-19T10:00:00.000Z'));
      const row = await t.prisma.voiceSession.findFirstOrThrow({ where: { matchId: id } });
      expect(row.seconds).toBe(0);
    });

    it('can still say "left" after the match ended', async () => {
      const { a, b, id } = await humanMatch();
      await joinedOf(a, id).expect(200);
      await request(t.server).post(`/v1/matches/${id}/leave`).set(b.auth).send({}).expect(200);
      expect((await leftOf(a, id).expect(200)).body).toEqual({ closed: 1 });
    });
  });

  describe('sweeper', () => {
    it('closes sessions of a finished match at the moment the match ended', async () => {
      const { a, b, id } = await humanMatch();
      await voice().joined(a.id, id, new Date(Date.now() - 120_000));
      await voice().joined(b.id, id, new Date(Date.now() - 100_000));
      await request(t.server).post(`/v1/matches/${id}/leave`).set(b.auth).send({}).expect(200);
      const ended = (await t.prisma.gameMatch.findUniqueOrThrow({ where: { id } })).endedAt;
      expect(ended).not.toBeNull();

      expect(await voice().closeStale(new Date(Date.now() + 3_600_000))).toBe(2);
      const rows = await t.prisma.voiceSession.findMany({ where: { matchId: id } });
      expect(rows.every((r) => r.endReason === 'match_ended')).toBe(true);
      expect(rows.every((r) => r.leftAt?.getTime() === ended?.getTime())).toBe(true);
      expect(await voice().closeStale(new Date(Date.now() + 3_600_000))).toBe(0);
    });

    it('leaves sessions of an open match alone, until the maximum length', async () => {
      const { a, id } = await humanMatch();
      const joinedAt = new Date('2026-10-19T10:00:00.000Z');
      await voice().joined(a.id, id, joinedAt);
      expect(await voice().closeStale(new Date('2026-10-19T12:59:00.000Z'))).toBe(0);
      expect(await voice().closeStale(new Date('2026-10-19T13:01:00.000Z'))).toBe(1);
      const row = await t.prisma.voiceSession.findFirstOrThrow({ where: { matchId: id } });
      expect(row).toMatchObject({ endReason: 'timeout', seconds: 3 * 3600 + 60 });
    });
  });

  it('keeps usage rows, without the user, when an account is deleted', async () => {
    const { a, id } = await humanMatch();
    await voice().joined(a.id, id);
    await t.prisma.user.delete({ where: { id: a.id } });
    const rows = await t.prisma.voiceSession.findMany({ where: { matchId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBeNull();
  });
});

describe('voice without credentials', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ VOICE_PROVIDER: 'agora' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  it('answers 503 rather than a broken token', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await t.app.get(MatchesService).createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    const response = await request(t.server)
      .post(`/v1/matches/${id}/voice/token`)
      .set(a.auth)
      .send({})
      .expect(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('real Agora tokens for a match', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      VOICE_PROVIDER: 'agora',
      AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
      AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210',
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  it('builds a version-007 token and never returns the certificate', async () => {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await t.app.get(MatchesService).createMatch({
      gameId: 'tictactoe',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      openingSeat: 0,
    });
    const response = await request(t.server)
      .post(`/v1/matches/${id}/voice/token`)
      .set(a.auth)
      .send({})
      .expect(200);
    const body = response.body as VoiceTokenView;
    expect(body.token.startsWith('007')).toBe(true);
    expect(body.appId).toBe('0123456789abcdef0123456789abcdef');
    expect(JSON.stringify(response.body)).not.toContain('fedcba9876543210fedcba9876543210');
  });
});
