// Creates N onboarded accounts directly in a SCRATCH database and writes a signed access token
// for each to a JSON file, so a load test can open thousands of sockets without paying the
// password-hashing cost of N registrations (that cost is a separate, measured thing).
// Only runs against databases named "gv_loadtest*". The token secret must match the API's.
//   node loadtest/prepare-users.mjs --db postgresql://.../gv_loadtest --secret <jwt secret> --count 2200 --out tokens.json
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import pg from 'pg';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const db = arg('db');
const secret = arg('secret');
const count = Number(arg('count') ?? '1000');
const out = arg('out') ?? 'tokens.json';
if (!db || !secret) throw new Error('--db and --secret are required');
const name = decodeURIComponent(new URL(db).pathname.slice(1));
if (!name.startsWith('gv_loadtest')) throw new Error(`refusing to touch database "${name}"`);

const key = new TextEncoder().encode(secret);
const run = Date.now().toString(36);
const client = new pg.Client({ connectionString: db });
await client.connect();
const tokens = [];
const ids = [];
try {
  await client.query('BEGIN');
  for (let i = 0; i < count; i += 1) {
    const id = randomUUID();
    ids.push(id);
    await client.query(
      `INSERT INTO users (id, email, "dateOfBirth", "termsVersion", "termsAcceptedAt", "updatedAt")
       VALUES ($1, $2, '1995-01-01', 'load', now(), now())`,
      [id, `lt-${run}-${i}@loadtest.invalid`],
    );
    const username = `lt${run}${i}`;
    await client.query(
      `INSERT INTO user_profiles ("userId", username, "usernameLower", "avatarId", "updatedAt")
       VALUES ($1, $2, $3, 'avatar-01', now())`,
      [id, username, username.toLowerCase()],
    );
    await client.query(`INSERT INTO user_settings ("userId", "updatedAt") VALUES ($1, now())`, [
      id,
    ]);
  }
  await client.query('COMMIT');
} finally {
  await client.end();
}
const now = Math.floor(Date.now() / 1000);
for (const id of ids) {
  tokens.push(
    await new SignJWT({ role: 'USER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(id)
      .setIssuer('gameverse-api')
      .setAudience('gameverse-app')
      .setIssuedAt(now)
      .setExpirationTime(now + 3 * 3600)
      .sign(key),
  );
}
writeFileSync(out, JSON.stringify(tokens));
console.log(`wrote ${tokens.length} users and tokens to ${out}`);
