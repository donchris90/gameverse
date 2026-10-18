import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorReporter, type ErrorContext } from '../src/observability/error-reporter.js';
import { registerUser, bearer } from './helpers/factories.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/test-app.js';

class RecordingReporter extends ErrorReporter {
  readonly captured: { error: unknown; context: ErrorContext }[] = [];
  capture(error: unknown, context: ErrorContext): void {
    this.captured.push({ error, context });
  }
}

describe('error reporting', () => {
  let t: TestApp;
  const reporter = new RecordingReporter();

  beforeAll(async () => {
    t = await createTestApp({}, (builder) =>
      builder.overrideProvider(ErrorReporter).useValue(reporter),
    );
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    reporter.captured.length = 0;
  });

  it('reports an unexpected 500 once, with request id, route and account id, and hides the cause from the client', async () => {
    const { session } = await registerUser(t);
    const spy = vi
      .spyOn(t.prisma.user, 'findUniqueOrThrow')
      .mockRejectedValueOnce(new Error('connection to db-internal-host refused'));
    const response = await request(t.server).get('/v1/me').set(bearer(session)).expect(500);
    spy.mockRestore();
    expect(JSON.stringify(response.body)).not.toContain('db-internal-host');
    expect(reporter.captured).toHaveLength(1);
    const [entry] = reporter.captured;
    expect(String((entry?.error as Error | undefined)?.message)).toContain('db-internal-host');
    expect(entry?.context.requestId).toBe(response.body.requestId);
    expect(entry?.context.route).toBe('GET /v1/me');
    expect(entry?.context.userId).toBe(session.user.id);
  });

  it('does not report expected errors: validation, auth, not found, rate limits', async () => {
    const { session } = await registerUser(t);
    await request(t.server).get('/v1/me').expect(401);
    await request(t.server).post('/v1/auth/login').send({}).expect(400);
    await request(t.server)
      .get('/v1/matches/00000000-0000-4000-8000-000000000000')
      .set(bearer(session))
      .expect(404);
    expect(reporter.captured).toEqual([]);
  });
});
