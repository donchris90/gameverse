import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../common/app.exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

function controllerWith(queryRaw: () => Promise<unknown>): HealthController {
  return new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HealthController', () => {
  it('liveness is always ok', () => {
    expect(controllerWith(() => Promise.reject(new Error('db down'))).live()).toEqual({
      status: 'ok',
    });
  });

  it('readiness is ok when the database answers', async () => {
    const result = await controllerWith(() => Promise.resolve([{ '?column?': 1 }])).ready();
    expect(result).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('readiness fails closed with 503 when the database errors, without leaking the cause', async () => {
    const controller = controllerWith(() =>
      Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2')),
    );
    const error = await controller.ready().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppException);
    const exception = error as AppException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.code).toBe('SERVICE_UNAVAILABLE');
    expect(exception.details).toEqual({ checks: { database: 'down' } });
    expect(JSON.stringify([exception.message, exception.details])).not.toMatch(
      /ECONNREFUSED|hunter2|10\.1\.2\.3/,
    );
  });

  it('readiness fails closed when the database check hangs', async () => {
    vi.useFakeTimers();
    const controller = controllerWith(() => new Promise(() => undefined)); // never settles
    const outcome = controller.ready().then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2_100);
    const error = await outcome;
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(503);
  });
});
