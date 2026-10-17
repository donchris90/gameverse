import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// `prisma generate` never connects to a database, so it must not require DATABASE_URL
// (CI and fresh checkouts run it before any database exists). Every command that does
// touch a database (migrate, db execute, ...) still fails loudly when the variable is missing.
const isGenerate = process.argv.includes('generate');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      (isGenerate ? 'postgresql://unused:unused@localhost:5432/unused' : env('DATABASE_URL')),
  },
});
