import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 400;

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const message = String((error as { message?: unknown }).message ?? '');
  return (
    code === 'P2034' || // write conflict / serialization failure / deadlock
    code === 'P2002' || // lost an insert race; the retry will see the winner's row
    /could not serialize|serialization|deadlock|TransactionWriteConflict|40001|40P01/i.test(message)
  );
}

/**
 * Runs `work` in a SERIALIZABLE transaction and retries when PostgreSQL aborts it because of a
 * concurrent conflict. Social-graph changes (accept vs block vs remove) must observe each other,
 * otherwise a friendship could survive a block that committed at the same moment.
 * Errors thrown by `work` itself (AppException, validation) are not retried.
 */
export function runSerializable<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runWithRetry(prisma, work, 'Serializable');
}

/**
 * For state that has exactly one writer-of-record row guarded by a version column (a match): READ
 * COMMITTED plus a compare-and-set on that row. A concurrent change makes the guarded UPDATE match
 * zero rows, the caller throws a P2034 conflict, and this retries against fresh data.
 *
 * Why not SERIALIZABLE here: PostgreSQL tracks serializable reads per index page, so unrelated
 * matches whose rows share a page abort each other ("could not serialize"). Under load that made
 * moves fail with 503 while the CPU sat idle (see docs/load-test.md). Use this only when every
 * invariant the transaction relies on is protected by the guarded row, never for checks that span
 * rows of different owners (one open match per player, friendships and blocks).
 */
export function runOptimistic<T>(prisma: PrismaService, work: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithRetry(prisma, work, 'ReadCommitted');
}

async function runWithRetry<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
  isolationLevel: 'Serializable' | 'ReadCommitted',
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel });
    } catch (error) {
      if (!isRetryable(error)) throw error;
      if (attempt >= MAX_ATTEMPTS) {
        // Still colliding after every retry: this is load, not a bug. Tell the client to try again
        // rather than reporting a server fault.
        throw new AppException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.SERVICE_UNAVAILABLE,
          'The server is busy. Please try again in a moment.',
        );
      }
      // Full jitter with a growing ceiling: many callers colliding on the same rows (a busy
      // matchmaking queue) spread out instead of retrying in lockstep.
      const ceiling = Math.min(MAX_BACKOFF_MS, 10 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * ceiling));
    }
  }
}
