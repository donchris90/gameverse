// Load-test baseline: N simulated players finish tic-tac-toe matches (quick-match pairs over REST)
// against a RUNNING API and the script reports request latency and errors.
//   node scripts/load-test.mjs [--api http://127.0.0.1:3000] [--pairs 20] [--matches 2]
// Needs a dev/test API with generous rate limits (RATE_LIMIT_*_PER_MIN high). Never point it at
// production: it registers throwaway accounts.
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const API = arg('api', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PAIRS = Number(arg('pairs', '20'));
const MATCHES = Number(arg('matches', '2'));
const RUN = Date.now().toString(36);
const latencies = new Map();
const errors = new Map();
let requests = 0;

let busyRetries = 0;
async function call(label, method, path, token, body) {
  // A client treats 503 "server busy" as retry-later; so does this script (up to 4 times).
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callOnce(label, method, path, token, body);
    } catch (err) {
      if (err.status !== 503 || attempt >= 4) throw err;
      busyRetries += 1;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 300));
    }
  }
}

async function callOnce(label, method, path, token, body) {
  const started = performance.now();
  requests += 1;
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    errors.set(`${label} network`, (errors.get(`${label} network`) ?? 0) + 1);
    throw err;
  }
  const ms = performance.now() - started;
  const list = latencies.get(label) ?? [];
  list.push(ms);
  latencies.set(label, list);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const key = `${label} ${res.status} ${json?.error?.code ?? ''}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
    const error = new Error(key);
    error.status = res.status;
    error.code = json?.error?.code;
    throw error;
  }
  return json;
}

async function newPlayer(index) {
  const email = `load-${RUN}-${index}@loadtest.gameverse.test`;
  const session = await call('register', 'POST', '/v1/auth/register', null, {
    email,
    password: 'LoadTest#2026xyz',
    dateOfBirth: '1995-05-05',
    acceptedTerms: true,
  });
  const token = session.accessToken;
  await call('profile', 'PUT', '/v1/me/profile', token, {
    username: `ld${RUN}${index}`.slice(0, 20),
    avatarId: 'avatar-01',
    bio: 'load test',
  });
  return { token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();

async function findMatch(a, b) {
  const room = await call('room.create', 'POST', '/v1/rooms', a.token, { gameId: 'tictactoe' });
  const view = await call('room.join', 'POST', '/v1/rooms/join', b.token, { code: room.code });
  return view.id;
}

async function playMatch(a, b) {
  const id = await findMatch(a, b);
  let view = await call('match.get', 'GET', `/v1/matches/${id}`, a.token);
  await call('match.ready', 'POST', `/v1/matches/${id}/ready`, a.token, {});
  await call('match.ready', 'POST', `/v1/matches/${id}/ready`, b.token, {});
  for (let guard = 0; guard < 80; guard += 1) {
    const mine = await call('match.get', 'GET', `/v1/matches/${id}`, a.token);
    view = mine;
    if (view.status === 'COMPLETED') return view;
    if (view.status !== 'ACTIVE' || view.series?.phase !== 'playing') {
      await sleep(150);
      continue;
    }
    const seat = view.series.seatToMove;
    const actor = seat === view.mySeat ? a : b;
    const board = view.series.board;
    const empty = board.flatMap((cell, i) => (cell === null ? [i] : []));
    const cell = empty[Math.floor(Math.random() * empty.length)];
    try {
      await call('match.move', 'POST', `/v1/matches/${id}/moves`, actor.token, {
        cell,
        clientActionId: uuid(),
        expectedVersion: view.version,
      });
    } catch (err) {
      if (err.status !== 409) throw err;
    }
  }
  throw new Error('match did not finish');
}

async function pair(index) {
  const a = await newPlayer(index * 2);
  const b = await newPlayer(index * 2 + 1);
  let finished = 0;
  for (let m = 0; m < MATCHES; m += 1) {
    const done = await playMatch(a, b);
    if (done.status === 'COMPLETED') finished += 1;
  }
  return finished;
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// Phase 1: everyone searches at once, which is the worst case for the matchmaking queue.
const crowd = await Promise.all(Array.from({ length: PAIRS * 2 }, (_, i) => newPlayer(10_000 + i)));
const queueStarted = performance.now();
const joined = await Promise.allSettled(
  crowd.map((p) =>
    call('queue.join', 'POST', '/v1/matchmaking/join', p.token, { gameId: 'tictactoe' }),
  ),
);
const queueSeconds = (performance.now() - queueStarted) / 1000;
const joinFailures = joined.filter((r) => r.status === 'rejected').length;
let matchedInQueue = 0;
for (const p of crowd) {
  const cur = await call('match.current', 'GET', '/v1/matches/current', p.token).catch(() => null);
  if (cur?.match) matchedInQueue += 1;
}
console.log(
  `queue phase: ${crowd.length} simultaneous joins in ${queueSeconds.toFixed(1)}s, failures ${joinFailures}, players matched ${matchedInQueue}`,
);

// Phase 2: pairs play full matches.
const started = performance.now();
const results = await Promise.allSettled(Array.from({ length: PAIRS }, (_, i) => pair(i)));
const seconds = (performance.now() - started) / 1000;
const finished = results.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value : 0), 0);
const failedPairs = results.filter((r) => r.status === 'rejected');

console.log(`API ${API}  pairs=${PAIRS}  matches/pair=${MATCHES}`);
console.log(
  `matches finished: ${finished}/${PAIRS * MATCHES}  failed pairs: ${failedPairs.length}`,
);
console.log(
  `elapsed ${seconds.toFixed(1)}s  requests ${requests}  (${(requests / seconds).toFixed(1)} req/s)`,
);
console.log('latency ms (p50 / p95 / p99 / max)  count');
for (const [label, list] of [...latencies].sort()) {
  const sorted = [...list].sort((x, y) => x - y);
  console.log(
    `  ${label.padEnd(14)} ${pct(sorted, 50).toFixed(0).padStart(5)} / ${pct(sorted, 95).toFixed(0).padStart(5)} / ${pct(sorted, 99).toFixed(0).padStart(5)} / ${sorted[sorted.length - 1].toFixed(0).padStart(5)}   n=${sorted.length}`,
  );
}
console.log(`503 busy retries absorbed by the script: ${busyRetries}`);
if (errors.size) {
  console.log('errors:');
  for (const [key, n] of errors) console.log(`  ${key}: ${n}`);
}
for (const r of failedPairs.slice(0, 3)) console.log('failed pair:', r.reason?.message);
process.exit(failedPairs.length || finished < PAIRS * MATCHES ? 1 : 0);
