import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Runs once before the integration suite: wipes the TEST database and applies every migration
 * (the real prisma/migrations/*.sql files, in order) so the schema under test is exactly what ships.
 *
 * Safety: refuses to touch any database whose name does not end in "_test".
 */
export default async function setup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required to run integration tests (see .env.example)');
  }
  const databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests: database "${databaseName}" does not end in "_test". ` +
        'This guard exists so tests can never wipe a development or production database.',
    );
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    const migrationsDir = join(import.meta.dirname, '..', 'prisma', 'migrations');
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations) {
      await client.query(readFileSync(join(migrationsDir, migration, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
