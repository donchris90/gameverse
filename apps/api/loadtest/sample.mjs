// Samples real (instantaneous) CPU and memory every 2 s from /proc for the API process, k6 and
// PostgreSQL, so a load run shows who is the bottleneck. Linux only.
//   node loadtest/sample.mjs <apiPid> <out.csv>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const [apiPid, out] = process.argv.slice(2);
const TICKS = 100; // USER_HZ on Linux
const cpus = readFileSync('/proc/cpuinfo', 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('processor')).length;
const pids = (name) => {
  try {
    return execFileSync('pgrep', ['-x', name], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
};
const cpuTicks = (pid) => {
  try {
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8')
      .replace(/^.*\) /, '')
      .split(' ');
    return Number(f[11]) + Number(f[12]); // utime + stime
  } catch {
    return 0;
  }
};
const rssMb = (pid) => {
  try {
    const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) / 1024 : 0;
  } catch {
    return 0;
  }
};
const fds = (pid) => {
  try {
    return readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    return 0;
  }
};
const group = () => ({ api: [Number(apiPid)], k6: pids('k6'), postgres: pids('postgres') });
let last = null;
writeFileSync(
  out,
  `epoch,api_cpu_pct,k6_cpu_pct,postgres_cpu_pct,machine_cpus,api_rss_mb,postgres_rss_mb,api_fds\n`,
);
setInterval(() => {
  const g = group();
  const now = Date.now();
  const ticks = Object.fromEntries(
    Object.entries(g).map(([k, list]) => [k, list.reduce((s, p) => s + cpuTicks(p), 0)]),
  );
  if (last) {
    const dt = (now - last.now) / 1000;
    const pct = (k) => (((ticks[k] - last.ticks[k]) / TICKS / dt) * 100).toFixed(0);
    appendFileSync(
      out,
      `${Math.floor(now / 1000)},${pct('api')},${pct('k6')},${pct('postgres')},${cpus},${rssMb(g.api[0]).toFixed(0)},${g.postgres.reduce((s, p) => s + rssMb(p), 0).toFixed(0)},${fds(g.api[0])}\n`,
    );
  }
  last = { now, ticks };
}, 2000);
