import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchView } from '@gameverse/shared-types';
import { MatchesService } from '../src/matches/matches.service.js';
import { registerWithProfile, type SocialUser } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

const FEE = 100;

describe('ayo entry fees and pots', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: true } });
  });
  afterAll(async () => {
    await t.prisma.game.update({ where: { id: 'ayo' }, data: { enabled: false } });
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
  });

  const balance = async (user: SocialUser) =>
    (await t.prisma.coinWallet.findUnique({ where: { userId: user.id } }))?.balance ?? 0;
  const get = async (user: SocialUser, id: string) =>
    (await request(t.server).get(`/v1/matches/${id}`).set(user.auth).expect(200)).body as MatchView;
  const ready = (user: SocialUser, id: string) =>
    request(t.server).post(`/v1/matches/${id}/ready`).set(user.auth).send({});

  async function paidPair() {
    const a = await registerWithProfile(t);
    const b = await registerWithProfile(t);
    const id = await t.app.get(MatchesService).createMatch({
      gameId: 'ayo',
      kind: 'PRIVATE',
      seats: [{ userId: a.id }, { userId: b.id }],
      entryFee: FEE,
    });
    return { a, b, id };
  }

  it('takes the fee from both players and shows the pot', async () => {
    const { a, b, id } = await paidPair();
    const view = await get(a, id);
    expect(view.entryFee).toBe(FEE);
    expect(view.pot).toBe(FEE * 2);
    expect(await balance(a)).toBe(await balance(b));
  });

  it('gives the pot to the player who stays when the other leaves a running match', async () => {
    const { a, b, id } = await paidPair();
    await ready(a, id).expect(200);
    await ready(b, id).expect(200);
    const before = [await balance(a), await balance(b)];
    await request(t.server).post(`/v1/matches/${id}/leave`).set(b.auth).send({}).expect(200);
    expect(await balance(a)).toBe((before[0] as number) + FEE * 2);
    expect(await balance(b)).toBe(before[1]);
    expect((await get(a, id)).payout).toBe(FEE * 2);
    expect((await get(b, id)).payout).toBe(0);
  });

  it('returns both fees when the match is left before it starts', async () => {
    const { a, b, id } = await paidPair();
    const before = [await balance(a), await balance(b)];
    await request(t.server).post(`/v1/matches/${id}/leave`).set(a.auth).send({}).expect(200);
    expect(await balance(a)).toBe((before[0] as number) + FEE);
    expect(await balance(b)).toBe((before[1] as number) + FEE);
  });
});
