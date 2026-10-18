import request from 'supertest';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeStaff, registerWithProfile } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

describe('admin: switching games on and off', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  // The catalogue is shared with other suites: start every test from the way the migrations ship it
  // (tic-tac-toe on, Ludo off) and leave it that way.
  const shipped = async () => {
    await t.prisma.game.update({ where: { id: 'tictactoe' }, data: { enabled: true } });
    await t.prisma.game.update({ where: { id: 'ludo' }, data: { enabled: false } });
  };
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await shipped();
  });
  afterEach(shipped);

  const setEnabled = (who: { auth: Record<string, string> }, id: string, body: unknown) =>
    request(t.server)
      .patch(`/v1/admin/games/${id}`)
      .set(who.auth)
      .send(body as object);
  const listed = async (who: { auth: Record<string, string> }) => {
    const response = await request(t.server).get('/v1/me/progress').set(who.auth).expect(200);
    return (response.body.games as { gameId: string }[]).map((game) => game.gameId);
  };

  it('lists the catalogue for an admin, with Ludo shipping switched off', async () => {
    const admin = await makeStaff(t, 'ADMIN');
    const response = await request(t.server).get('/v1/admin/games').set(admin.auth).expect(200);
    const byId = new Map(
      (response.body as { id: string; enabled: boolean }[]).map((g) => [g.id, g]),
    );
    expect(byId.get('tictactoe')?.enabled).toBe(true);
    expect(byId.get('ludo')?.enabled).toBe(false);
  });

  it('turning a game on shows it to players and turning it off hides it again, each audited with who and why', async () => {
    const admin = await makeStaff(t, 'ADMIN');
    const player = await registerWithProfile(t);
    expect(await listed(player)).not.toContain('ludo');

    const on = await setEnabled(admin, 'ludo', { enabled: true, reason: 'device checks passed' });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ id: 'ludo', enabled: true });
    expect(await listed(player)).toContain('ludo');

    await setEnabled(admin, 'ludo', { enabled: false, reason: 'pausing for a fix' }).expect(200);
    expect(await listed(player)).not.toContain('ludo');

    const rows = await t.prisma.auditLog.findMany({
      where: { targetType: 'game' },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => row.action)).toEqual(['GAME_ENABLED', 'GAME_DISABLED']);
    expect(rows.every((row) => row.actorId === admin.id)).toBe(true);
    expect(rows[0]?.metadata).toMatchObject({ gameId: 'ludo', reason: 'device checks passed' });
  });

  it('writes no audit entry when nothing changes', async () => {
    const admin = await makeStaff(t, 'ADMIN');
    await setEnabled(admin, 'tictactoe', { enabled: true, reason: 'already on, no change' }).expect(
      200,
    );
    expect(await t.prisma.auditLog.count({ where: { targetType: 'game' } })).toBe(0);
  });

  it('a switched-off game cannot start new rooms, while a match already in progress stays reachable', async () => {
    const admin = await makeStaff(t, 'ADMIN');
    const player = await registerWithProfile(t);
    const bot = await request(t.server)
      .post('/v1/matches/bot')
      .set(player.auth)
      .send({ gameId: 'tictactoe', level: 'easy' })
      .expect(201);

    await setEnabled(admin, 'tictactoe', { enabled: false, reason: 'maintenance window' }).expect(
      200,
    );
    await request(t.server)
      .post('/v1/rooms')
      .set(player.auth)
      .send({ gameId: 'tictactoe' })
      .expect(404);
    await request(t.server)
      .get(`/v1/matches/${bot.body.id as string}`)
      .set(player.auth)
      .expect(200);
  });

  it('only an admin may list or change games: moderators, players and anonymous callers are refused', async () => {
    const moderator = await makeStaff(t, 'MODERATOR');
    const player = await registerWithProfile(t);
    const body = { enabled: true, reason: 'trying to sneak this in' };

    for (const who of [moderator, player]) {
      await request(t.server).get('/v1/admin/games').set(who.auth).expect(403);
      await setEnabled(who, 'ludo', body).expect(403);
    }
    await request(t.server).get('/v1/admin/games').expect(401);
    await request(t.server).patch('/v1/admin/games/ludo').send(body).expect(401);
    expect((await t.prisma.game.findUnique({ where: { id: 'ludo' } }))?.enabled).toBe(false);
    expect(await t.prisma.auditLog.count({ where: { targetType: 'game' } })).toBe(0);
  });

  it('rejects a missing reason, a non-boolean flag, a malformed id and an unknown game', async () => {
    const admin = await makeStaff(t, 'ADMIN');
    await setEnabled(admin, 'ludo', { enabled: true }).expect(400);
    await setEnabled(admin, 'ludo', { enabled: true, reason: 'x' }).expect(400);
    await setEnabled(admin, 'ludo', { enabled: 'yes', reason: 'a proper reason' }).expect(400);
    await setEnabled(admin, 'Not%20A%20Game', { enabled: true, reason: 'a proper reason' }).expect(
      400,
    );
    await setEnabled(admin, 'chess', { enabled: true, reason: 'a proper reason' }).expect(404);
    expect((await t.prisma.game.findUnique({ where: { id: 'ludo' } }))?.enabled).toBe(false);
  });
});
