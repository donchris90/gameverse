// Holds N authenticated, idle WebSockets (a lobby full of people who are online but not in a
// match) and reports connect+auth latency and the API process's memory/fd growth.
//   node loadtest/idle-sockets.mjs --api ws://127.0.0.1:3923/ws --tokens tokens.json --pid <apiPid> --counts 500,1000,2000,4000
import { readFileSync, readdirSync } from 'node:fs';
import { WebSocket } from 'ws';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg('api') ?? 'ws://127.0.0.1:3923/ws';
const tokens = JSON.parse(readFileSync(arg('tokens') ?? 'tokens.json', 'utf8'));
const pid = Number(arg('pid'));
const counts = (arg('counts') ?? '500,1000,2000').split(',').map(Number);
const rss = () =>
  Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
const fds = () => readdirSync(`/proc/${pid}/fd`).length;
const pct = (list, p) =>
  [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))];

const open = [];
let closed = 0;
const baseline = rss();
console.log(`baseline rss ${baseline.toFixed(0)} MB`);
for (const target of counts) {
  const latencies = [];
  let failed = 0;
  const wave = [];
  while (open.length + wave.length < Math.min(target, tokens.length)) {
    const token = tokens[open.length + wave.length];
    wave.push(
      new Promise((resolve) => {
        const started = Date.now();
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          failed += 1;
          ws.terminate();
          resolve(null);
        }, 15000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
        ws.on('message', (data) => {
          if (JSON.parse(String(data)).type === 'ready') {
            clearTimeout(timer);
            latencies.push(Date.now() - started);
            resolve(ws);
          }
        });
        ws.on('close', () => {
          closed += 1;
        });
        ws.on('error', () => {
          clearTimeout(timer);
          failed += 1;
          resolve(null);
        });
      }),
    );
    // 100 connections per 100 ms: a busy minute, not a thundering herd.
    if (wave.length % 100 === 0) await new Promise((r) => setTimeout(r, 100));
  }
  open.push(...(await Promise.all(wave)).filter(Boolean));
  await new Promise((r) => setTimeout(r, 3000));
  console.log(
    `${String(open.length).padStart(5)} open | failed ${failed} | closed by server ${closed} | auth p50 ${pct(latencies, 0.5)} ms p95 ${pct(latencies, 0.95)} ms max ${Math.max(...latencies)} ms | rss ${rss().toFixed(0)} MB (${(((rss() - baseline) / open.length) * 1024).toFixed(0)} KB/socket) | fds ${fds()}`,
  );
}
for (const ws of open) ws.close();
