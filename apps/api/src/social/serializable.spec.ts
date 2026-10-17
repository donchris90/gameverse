import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { runSerializable } from './serializable.js';

/** A stand-in whose transaction fails with the given errors before finally succeeding. */
function prismaFailing(errors: unknown[]): { prisma: PrismaService; calls: () => number } {
  let calls = 0;
  const prisma = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      calls += 1;
      const failure = errors.shift();
      if (failure !== undefined) throw failure;
      return work({});
    },
  } as unknown as PrismaService;
  return { prisma, calls: () => calls };
}

describe('runSerializable', () => {
  it.each([
    ['Prisma P2034', Object.assign(new Error('conflict'), { code: 'P2034' })],
    ['unique-insert race P2002', Object.assign(new Error('unique'), { code: 'P2002' })],
    [
      'driver-adapter write conflict (what Prisma 7 reports for a failed serializable commit)',
      Object.assign(new Error('TransactionWriteConflict'), { name: 'DriverAdapterError' }),
    ],
    [
      'PostgreSQL 40001 text',
      new Error('could not serialize access due to read/write dependencies'),
    ],
    ['deadlock', new Error('deadlock detected')],
  ])('retries after %s', async (_name, error) => {
    const { prisma, calls } = prismaFailing([error, error]);
    await expect(runSerializable(prisma, async () => 'done')).resolves.toBe('done');
    expect(calls()).toBe(3);
  });

  it('does not retry ordinary errors', async () => {
    const { prisma, calls } = prismaFailing([new Error('boom')]);
    await expect(runSerializable(prisma, async () => 'done')).rejects.toThrow('boom');
    expect(calls()).toBe(1);
  });

  it('gives up after a bounded number of attempts', async () => {
    const conflict = Object.assign(new Error('conflict'), { code: 'P2034' });
    const { prisma, calls } = prismaFailing(Array.from({ length: 20 }, () => conflict));
    await expect(runSerializable(prisma, async () => 'done')).rejects.toBe(conflict);
    expect(calls()).toBe(8);
  });
});
