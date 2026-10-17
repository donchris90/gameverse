// Local-development seed. Refuses to run anywhere except NODE_ENV=development against a localhost database.
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PasswordService } from '../src/auth/password.service.js';

const SEED_USERS = [
  { email: 'admin@gameverse.local', role: 'ADMIN' },
  { email: 'player1@gameverse.local', role: 'USER' },
  { email: 'player2@gameverse.local', role: 'USER' },
] as const;

async function main(): Promise<void> {
  const env = process.env['NODE_ENV'] ?? 'development';
  const url = process.env['DATABASE_URL'] ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  if (env !== 'development' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'Refusing to seed: only NODE_ENV=development with a localhost DATABASE_URL is allowed.',
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const passwords = new PasswordService();
  // A fresh random password per run; printed once, never stored in the repo.
  const password = randomBytes(12).toString('base64url');
  const passwordHash = await passwords.hash(password);
  try {
    for (const user of SEED_USERS) {
      await prisma.user.upsert({
        where: { email: user.email },
        update: { passwordHash, role: user.role },
        create: {
          email: user.email,
          passwordHash,
          role: user.role,
          dateOfBirth: new Date('1995-01-01'),
          termsVersion: 'draft-1',
          termsAcceptedAt: new Date(),
          emailVerifiedAt: new Date(),
        },
      });
    }
    console.log(
      `Seeded ${SEED_USERS.length} local users. Shared password for this run: ${password}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
