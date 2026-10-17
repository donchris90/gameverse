import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 8;

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
export async function runSerializable<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 5 + Math.random() * 15));
    }
  }
}
