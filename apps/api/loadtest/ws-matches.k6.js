// k6 load test: pairs of signed-in players, each with a live WebSocket, play best-of-3 tic-tac-toe
// matches over and over. Moves go over REST (as the real client does); the opponent learns about
// them over the WebSocket. Steps run one after another with more pairs each time; the report is
// read per step to find where a single API instance stops coping.
//
//   k6 run -e API=http://127.0.0.1:3923 -e TOKENS=tokens.json -e STEPS=25,50,100,200 loadtest/ws-matches.k6.js
//
// Needs a SCRATCH API with generous rate limits and tokens made by prepare-users.mjs.
import { SharedArray } from 'k6/data';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { WebSocket } from 'k6/experimental/websockets';

const API = __ENV.API || 'http://127.0.0.1:3923';
const WS_URL = API.replace(/^http/, 'ws') + '/ws';
const STEPS = (__ENV.STEPS || '25,50,100,200').split(',').map(Number);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || '60');
const tokens = new SharedArray('tokens', () => JSON.parse(open(__ENV.TOKENS || 'tokens.json')));

const wsReady = new Trend('ws_ready_ms', true);
const delivery = new Trend('event_delivery_ms', true);
const moveRtt = new Trend('move_rest_ms', true);
const matchesDone = new Counter('matches_completed');
const matchesFailed = new Counter('matches_failed');
const wsClosed = new Counter('ws_unexpected_close');
const moveErrors = new Counter('move_errors');
const busy503 = new Counter('busy_503_retries');

export const options = {
  scenarios: Object.fromEntries(
    STEPS.map((pairs, index) => [
      `pairs_${String(pairs)}`,
      {
        executor: 'constant-vus',
        vus: pairs,
        duration: `${String(STEP_SECONDS)}s`,
        startTime: `${String(index * (STEP_SECONDS + 60))}s`,
        gracefulStop: '30s',
      },
    ]),
  ),
  thresholds: Object.fromEntries(
    STEPS.flatMap((pairs) => {
      const tag = `{scenario:pairs_${String(pairs)}}`;
      return ['ws_ready_ms', 'event_delivery_ms', 'move_rest_ms']
        .map((m) => [`${m}${tag}`, ['max>=0']])
        .concat([
          [`matches_completed${tag}`, ['count>=0']],
          [`matches_failed${tag}`, ['count>=0']],
          [`ws_unexpected_close${tag}`, ['count>=0']],
          [`move_errors${tag}`, ['count>=0']],
          [`busy_503_retries${tag}`, ['count>=0']],
          [`http_req_failed${tag}`, ['rate>=0']],
        ]);
    }),
  ),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

const headers = (token) => ({
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
});
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );

async function call(method, path, token, body) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await http.asyncRequest(
      method,
      `${API}${path}`,
      body === undefined ? null : JSON.stringify(body),
      headers(token),
    );
    if (res.status === 503 && attempt < 4) {
      busy503.add(1);
      if (__ENV.VERBOSE) console.log(`503 ${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 300));
      continue;
    }
    return res;
  }
}

// Per-VU state survives across iterations: the sockets stay open for the whole step.
let player = null;

function openSocket(token) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ws = new WebSocket(WS_URL);
    const socket = { ws, handler: null, closing: false };
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (event) => {
      const frame = JSON.parse(event.data);
      if (frame.type === 'ready') {
        wsReady.add(Date.now() - started);
        resolve(socket);
      } else if (frame.type === 'match.update' && socket.handler) {
        socket.handler(frame.match);
      }
    };
    ws.onerror = () => reject(new Error('socket error'));
    ws.onclose = () => {
      if (!socket.closing) wsClosed.add(1);
    };
  });
}

async function playMatch(a, b) {
  const created = await call('POST', '/v1/rooms', a.token, { gameId: 'tictactoe' });
  if (created.status !== 201) throw new Error(`room.create ${String(created.status)}`);
  const joined = await call('POST', '/v1/rooms/join', b.token, { code: created.json('code') });
  if (joined.status !== 200 && joined.status !== 201)
    throw new Error(`room.join ${String(joined.status)}`);
  const matchId = joined.json('match.id');
  for (const side of [a, b]) {
    const ready = await call('POST', `/v1/matches/${matchId}/ready`, side.token, {});
    if (ready.status !== 200) throw new Error(`ready ${String(ready.status)}`);
  }

  await new Promise((resolve, reject) => {
    let finished = false;
    const lastSent = { at: 0, fromVersion: -1, by: null, measured: true };
    const acted = new Set();
    const guard = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('match did not finish in 150 s'));
      }
    }, 150000);

    const onUpdate = (side, other) => (view) => {
      if (finished || view.id !== matchId) return;
      if (!lastSent.measured && lastSent.by === other && view.version > lastSent.fromVersion) {
        lastSent.measured = true;
        delivery.add(Date.now() - lastSent.at);
      }
      if (view.status === 'COMPLETED' || view.status === 'CANCELLED') {
        finished = true;
        clearTimeout(guard);
        view.status === 'COMPLETED' ? resolve() : reject(new Error(`match ${view.status}`));
        return;
      }
      const series = view.series;
      if (view.status !== 'ACTIVE' || !series || series.phase !== 'playing') return;
      if (series.seatToMove !== view.mySeat) return;
      const key = `${String(view.version)}`;
      if (acted.has(key)) return;
      acted.add(key);
      const empty = series.board.flatMap((cell, i) => (cell === null ? [i] : []));
      const cell = empty[Math.floor(Math.random() * empty.length)];
      // A person takes a moment to choose.
      setTimeout(
        async () => {
          if (finished) return;
          lastSent.at = Date.now();
          lastSent.fromVersion = view.version;
          lastSent.by = side;
          lastSent.measured = false;
          const res = await call('POST', `/v1/matches/${matchId}/moves`, side.token, {
            cell,
            clientActionId: uuid(),
            expectedVersion: view.version,
          });
          moveRtt.add(res.timings.duration);
          if (res.status !== 200 && res.status !== 409) moveErrors.add(1);
        },
        400 + Math.random() * 900,
      );
    };
    a.socket.handler = onUpdate(a, b);
    b.socket.handler = onUpdate(b, a);
    // The ready calls may already have started the game; ask once so nobody waits forever.
    for (const side of [a, b]) {
      call('GET', `/v1/matches/${matchId}`, side.token).then((res) => {
        if (res.status === 200) side.socket.handler(res.json());
      });
    }
  });
}

export default async function () {
  if (!player) {
    const a = { token: tokens[2 * (__VU - 1)] };
    const b = { token: tokens[2 * (__VU - 1) + 1] };
    [a.socket, b.socket] = await Promise.all([openSocket(a.token), openSocket(b.token)]);
    player = { a, b };
  }
  try {
    await playMatch(player.a, player.b);
    matchesDone.add(1);
  } catch (error) {
    matchesFailed.add(1);
    if (__ENV.VERBOSE) console.log(`vu ${String(__VU)}: ${String(error)}`);
    sleep(2);
  }
  player.a.socket.handler = null;
  player.b.socket.handler = null;
}
