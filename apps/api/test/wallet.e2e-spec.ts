import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COIN_SETTING_DEFAULTS,
  ErrorCode,
  type MatchView,
  type WalletView,
} from '@gameverse/shared-types';
import { AppException } from '../src/common/app.exception.js';
import { MatchesService } from '../src/matches/matches.service.js';
import { WalletService } from '../src/wallet/wallet.service.js';
import { makeStaff, registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('bonus coins: wallet and ledger', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const restoreSettings = async () => {
    for (const [key, value] of Object.entries(COIN_SETTING_DEFAULTS)) {
      await t.prisma.coinSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
  };
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await restoreSettings();
  });
  afterEach(restoreSettings);

  const wallet = () => t.app.get(WalletService);
  const getWallet = async (user: SocialUser) =>
    (await request(t.server).get('/v1/wallet').set(user.auth).expect(200)).body as WalletView;
  const ledgerSum = async (userId: string) =>
    (await t.prisma.coinLedger.aggregate({ where: { userId }, _sum: { delta: true } }))._sum
      .delta ?? 0;
  const moveOnce = (userId: string, delta: number, key: string) =>
    t.prisma.$transaction((tx) =>
      wallet().move(tx, { userId, delta, reason: 'ADMIN_GRANT', idempotencyKey: key }),
    );

  describe('starter grant and balance', () => {
    it('gives a new player the starter coins once, however often they look', async () => {
      const player = await registerWithProfile(t);
      const first = await getWallet(player);
      expect(first.balance).toBe(COIN_SETTING_DEFAULTS.starter);
      expect(first.history.map((row) => row.reason)).toEqual(['STARTER']);
      await getWallet(player);
      await Promise.all([getWallet(player), getWallet(player), getWallet(player)]);
      const again = await getWallet(player);
      expect(again.balance).toBe(COIN_SETTING_DEFAULTS.starter);
      expect(await t.prisma.coinLedger.count({ where: { userId: player.id } })).toBe(1);
    });

    it('requires a signed-in player', async () => {
      await request(t.server).get('/v1/wallet').expect(401);
      await request(t.server).post('/v1/wallet/daily').expect(401);
    });

    it('gives a player with a starter of zero a wallet and no grant', async () => {
      await t.prisma.coinSetting.update({ where: { key: 'starter' }, data: { value: 0 } });
      const player = await registerWithProfile(t);
      const view = await getWallet(player);
      expect(view.balance).toBe(0);
      expect(view.history).toEqual([]);
    });
  });

  describe('daily check-in', () => {
    it('pays once a day and says so when asked again', async () => {
      const player = await registerWithProfile(t);
      const first = await request(t.server).post('/v1/wallet/daily').set(player.auth).expect(200);
      expect(first.body).toMatchObject({ claimed: true, amount: COIN_SETTING_DEFAULTS.daily });
      expect(first.body.wallet.balance).toBe(
        COIN_SETTING_DEFAULTS.starter + COIN_SETTING_DEFAULTS.daily,
      );
      expect(first.body.wallet.canClaimDaily).toBe(false);
      expect(first.body.wallet.nextDailyAt).not.toBeNull();

      const second = await request(t.server).post('/v1/wallet/daily').set(player.auth).expect(200);
      expect(second.body).toMatchObject({ claimed: false, amount: 0 });
      expect(second.body.wallet.balance).toBe(first.body.wallet.balance);
    });

    it('opens again on the next UTC day', async () => {
      const player = await registerWithProfile(t);
      const today = new Date('2026-10-18T12:00:00Z');
      const tomorrow = new Date('2026-10-19T00:00:01Z');
      expect((await wallet().claimDaily(player.id, today)).claimed).toBe(true);
      expect((await wallet().claimDaily(player.id, today)).claimed).toBe(false);
      const next = await wallet().claimDaily(player.id, tomorrow);
      expect(next.claimed).toBe(true);
      expect(next.wallet.balance).toBe(
        COIN_SETTING_DEFAULTS.starter + 2 * COIN_SETTING_DEFAULTS.daily,
      );
    });

    it('pays exactly once when the same claim arrives many times at the same moment', async () => {
      const player = await registerWithProfile(t);
      const answers = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(t.server).post('/v1/wallet/daily').set(player.auth),
        ),
      );
      expect(answers.every((response) => response.status === 200)).toBe(true);
      expect(answers.filter((response) => response.body.claimed === true)).toHaveLength(1);
      const view = await getWallet(player);
      expect(view.balance).toBe(COIN_SETTING_DEFAULTS.starter + COIN_SETTING_DEFAULTS.daily);
      expect(await ledgerSum(player.id)).toBe(view.balance);
    });
  });

  describe('the ledger is the truth', () => {
    it('applies one idempotency key once', async () => {
      const player = await registerWithProfile(t);
      await getWallet(player);
      const key = `test:${randomUUID()}`;
      expect((await moveOnce(player.id, 25, key)).applied).toBe(true);
      expect((await moveOnce(player.id, 25, key)).applied).toBe(false);
      expect((await getWallet(player)).balance).toBe(COIN_SETTING_DEFAULTS.starter + 25);
    });

    it('never lets a balance go below zero, even when debits arrive at the same moment', async () => {
      const player = await registerWithProfile(t);
      await getWallet(player); // 500
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => moveOnce(player.id, -100, `spend:${String(i)}`)),
      );
      const refused = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(5);
      expect(refused).toHaveLength(3);
      for (const r of refused) {
        expect(r.reason).toBeInstanceOf(AppException);
        expect((r.reason as AppException).code).toBe(ErrorCode.INSUFFICIENT_COINS);
      }
      const view = await getWallet(player);
      expect(view.balance).toBe(0);
      expect(await ledgerSum(player.id)).toBe(0 + 0);
      expect(
        await t.prisma.coinLedger.count({ where: { userId: player.id, delta: { lt: 0 } } }),
      ).toBe(5);
    });

    it('is protected by the database too: a negative balance cannot be written at all', async () => {
      const player = await registerWithProfile(t);
      await getWallet(player);
      await expect(
        t.prisma
          .$executeRaw`UPDATE coin_wallets SET balance = -1 WHERE "userId" = ${player.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        t.prisma.coinLedger.create({
          data: { userId: player.id, delta: 0, balanceAfter: 0, reason: 'X', idempotencyKey: 'z0' },
        }),
      ).rejects.toThrow();
    });

    it('keeps balance equal to the sum of the ledger after a mix of movements', async () => {
      const player = await registerWithProfile(t);
      await getWallet(player);
      await moveOnce(player.id, 40, 'mix:1');
      await moveOnce(player.id, -90, 'mix:2');
      await moveOnce(player.id, 7, 'mix:3');
      const row = await t.prisma.coinWallet.findUniqueOrThrow({ where: { userId: player.id } });
      expect(row.balance).toBe(await ledgerSum(player.id));
    });

    it('exposes no way to send, sell or withdraw coins', async () => {
      const player = await registerWithProfile(t);
      for (const [method, path] of [
        ['post', '/v1/wallet/transfer'],
        ['post', '/v1/wallet/withdraw'],
        ['post', '/v1/wallet/buy'],
        ['post', '/v1/wallet/gift'],
        ['put', '/v1/wallet'],
        ['patch', '/v1/wallet'],
        ['delete', '/v1/wallet'],
      ] as const) {
        const response = await request(t.server)[method](path).set(player.auth).send({ amount: 1 });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    });
  });

  describe('level-up rewards', () => {
    it('pays the level-up amount once per level, and not again for the same level', async () => {
      const player = await registerWithProfile(t);
      await getWallet(player);
      await t.prisma.$transaction((tx) => wallet().rewardLevels(tx, player.id, 1, 3));
      expect((await getWallet(player)).balance).toBe(
        COIN_SETTING_DEFAULTS.starter + 2 * COIN_SETTING_DEFAULTS.levelUp,
      );
      await t.prisma.$transaction((tx) => wallet().rewardLevels(tx, player.id, 1, 3));
      await t.prisma.$transaction((tx) => wallet().rewardLevels(tx, player.id, 2, 2));
      expect((await getWallet(player)).balance).toBe(
        COIN_SETTING_DEFAULTS.starter + 2 * COIN_SETTING_DEFAULTS.levelUp,
      );
    });

    it('pays when a finished match takes a player to a new level', async () => {
      const winner = await registerWithProfile(t);
      const loser = await registerWithProfile(t);
      await getWallet(winner);
      await t.prisma.playerExperience.create({ data: { userId: winner.id, xp: 40 } }); // level 1
      const id = await t.app.get(MatchesService).createMatch({
        gameId: 'tictactoe',
        kind: 'QUICK',
        seats: [{ userId: winner.id }, { userId: loser.id }],
        openingSeat: 0,
      });
      for (const p of [winner, loser]) {
        await request(t.server).post(`/v1/matches/${id}/ready`).set(p.auth).send({}).expect(200);
      }
      // The loser leaves, so the winner takes the match and the XP that goes with it.
      await request(t.server).post(`/v1/matches/${id}/leave`).set(loser.auth).send({}).expect(200);
      const done = (await request(t.server).get(`/v1/matches/${id}`).set(winner.auth).expect(200))
        .body as MatchView;
      expect(done.status).toBe('COMPLETED');
      expect(done.result?.players.find((p) => p.userId === winner.id)?.xp).toBeGreaterThan(0);
      const view = await getWallet(winner);
      expect(view.balance).toBe(COIN_SETTING_DEFAULTS.starter + COIN_SETTING_DEFAULTS.levelUp);
      expect(view.history[0]).toMatchObject({ reason: 'LEVEL_UP', reference: 'level:2' });
    });
  });

  describe('admin', () => {
    it('lets an admin grant and take back coins, audited, and safe to retry', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const player = await registerWithProfile(t);
      const key = `ticket-${randomUUID()}`;
      const grant = await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(admin.auth)
        .send({ amount: 200, reason: 'Support goodwill', idempotencyKey: key })
        .expect(200);
      expect(grant.body.balance).toBe(COIN_SETTING_DEFAULTS.starter + 200);
      await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(admin.auth)
        .send({ amount: 200, reason: 'Support goodwill', idempotencyKey: key })
        .expect(200);
      expect((await getWallet(player)).balance).toBe(COIN_SETTING_DEFAULTS.starter + 200);

      await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(admin.auth)
        .send({ amount: -50, reason: 'Granted twice by mistake', idempotencyKey: `${key}-b` })
        .expect(200);
      expect((await getWallet(player)).balance).toBe(COIN_SETTING_DEFAULTS.starter + 150);

      const audit = await t.prisma.auditLog.findMany({
        where: { targetId: player.id, action: { in: ['COINS_GRANTED', 'COINS_REVOKED'] } },
        orderBy: { id: 'asc' },
      });
      expect(audit.map((row) => row.action)).toEqual(['COINS_GRANTED', 'COINS_REVOKED']);
      expect(audit[0]?.actorId).toBe(admin.id);
      expect(audit[0]?.metadata).toMatchObject({ amount: 200, reason: 'Support goodwill' });
    });

    it('refuses to take back more than the balance and changes nothing', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const player = await registerWithProfile(t);
      const response = await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(admin.auth)
        .send({ amount: -100_000, reason: 'Too much', idempotencyKey: 'too-much-1' });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(ErrorCode.INSUFFICIENT_COINS);
      expect((await getWallet(player)).balance).toBe(COIN_SETTING_DEFAULTS.starter);
    });

    it('keeps coins away from players and moderators', async () => {
      const moderator = await makeStaff(t, 'MODERATOR');
      const player = await registerWithProfile(t);
      const body = { amount: 10, reason: 'Trying it', idempotencyKey: 'attempt-001' };
      await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(player.auth)
        .send(body)
        .expect(403);
      await request(t.server)
        .post(`/v1/admin/users/${player.id}/coins`)
        .set(moderator.auth)
        .send(body)
        .expect(403);
      await request(t.server).get('/v1/admin/coin-settings').set(moderator.auth).expect(403);
      expect((await getWallet(player)).balance).toBe(COIN_SETTING_DEFAULTS.starter);
    });

    it('rejects bad grants (zero, fractional, no reason)', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const player = await registerWithProfile(t);
      for (const bad of [
        { amount: 0, reason: 'Nothing', idempotencyKey: 'bad-key-001' },
        { amount: 1.5, reason: 'Half', idempotencyKey: 'bad-key-002' },
        { amount: 5, reason: '', idempotencyKey: 'bad-key-003' },
        { amount: 5, reason: 'No key' },
      ]) {
        await request(t.server)
          .post(`/v1/admin/users/${player.id}/coins`)
          .set(admin.auth)
          .send(bad)
          .expect(400);
      }
    });

    it('changes the earning amounts, audited, and the new amount is what players get', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      const before = await request(t.server).get('/v1/admin/coin-settings').set(admin.auth);
      expect(before.body).toEqual(COIN_SETTING_DEFAULTS);
      const changed = await request(t.server)
        .patch('/v1/admin/coin-settings')
        .set(admin.auth)
        .send({ daily: 80, reason: 'Raise the daily bonus' })
        .expect(200);
      expect(changed.body).toEqual({ ...COIN_SETTING_DEFAULTS, daily: 80 });
      const player = await registerWithProfile(t);
      const claim = await request(t.server).post('/v1/wallet/daily').set(player.auth).expect(200);
      expect(claim.body.amount).toBe(80);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'COIN_SETTINGS_CHANGED' },
      });
      expect(audit.actorId).toBe(admin.id);
      expect(audit.metadata).toMatchObject({
        changes: { daily: 80 },
        reason: 'Raise the daily bonus',
      });
      await request(t.server)
        .patch('/v1/admin/coin-settings')
        .set(admin.auth)
        .send({ reason: 'Nothing to change' })
        .expect(400);
    });

    it('does not credit a deleted or unknown account', async () => {
      const admin = await makeStaff(t, 'ADMIN');
      await request(t.server)
        .post(`/v1/admin/users/${randomUUID()}/coins`)
        .set(admin.auth)
        .send({ amount: 5, reason: 'Nobody', idempotencyKey: 'ghost-0001' })
        .expect(404);
    });
  });
});
