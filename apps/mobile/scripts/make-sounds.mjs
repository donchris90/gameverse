// Generates the game sound effects as small 16-bit mono WAV files: `node scripts/make-sounds.mjs`.
// They are synthesised here (sine tones, decaying noise), so there is nothing to license and the
// files can be regenerated. The seeded noise makes the output identical on every run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

let seed = 1234567;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x80000000 - 1;
};

/** Sum of notes: { f: Hz (or [from, to] glide), at, dur, gain, kind: 'sine' | 'noise' }. */
function render(notes, total) {
  const out = new Float32Array(Math.ceil(total * RATE));
  for (const n of notes) {
    const start = Math.floor(n.at * RATE);
    const length = Math.floor(n.dur * RATE);
    let phase = 0;
    let low = 0;
    for (let i = 0; i < length && start + i < out.length; i += 1) {
      const t = i / length;
      const attack = Math.min(1, i / (RATE * 0.004));
      const env = attack * Math.exp(-5 * t) * (1 - t);
      let sample;
      if (n.kind === 'noise') {
        // One-pole low-pass keeps the noise soft (woody) instead of hissy.
        low += (noise() - low) * (n.soft ?? 0.2);
        sample = low;
      } else {
        const f = Array.isArray(n.f) ? n.f[0] + (n.f[1] - n.f[0]) * t : n.f;
        phase += (2 * Math.PI * f) / RATE;
        sample = Math.sin(phase) + 0.25 * Math.sin(2 * phase);
      }
      out[start + i] += sample * env * n.gain;
    }
  }
  return out;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2),
  );
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const note = (f, at, dur, gain = 0.5) => ({ f, at, dur, gain, kind: 'sine' });
const thump = (at, dur, gain = 0.8, soft = 0.12) => ({ at, dur, gain, soft, kind: 'noise' });

const SOUNDS = {
  tap: [note(900, 0, 0.05, 0.35)],
  place: [note(180, 0, 0.14, 0.7), thump(0, 0.05, 0.6)],
  capture: [note([620, 180], 0, 0.2, 0.6), note(150, 0, 0.12, 0.6), thump(0, 0.06, 0.7)],
  seed: [note(1500, 0, 0.045, 0.3), thump(0, 0.02, 0.3, 0.5)],
  lift: [note([420, 560], 0, 0.07, 0.35)],
  pack: [note(880, 0, 0.34, 0.45), note(1320, 0.06, 0.3, 0.3)],
  roll: [0, 0.07, 0.15, 0.24, 0.34, 0.45].map((at, i) => thump(at, 0.06, 0.55 - i * 0.05, 0.35)),
  home: [note(784, 0, 0.12, 0.45), note(1047, 0.09, 0.3, 0.45)],
  turn: [note(660, 0, 0.09, 0.35), note(880, 0.08, 0.16, 0.35)],
  win: [523, 659, 784, 1047].map((f, i) => note(f, i * 0.11, 0.32, 0.4)),
  lose: [392, 330, 262].map((f, i) => note(f, i * 0.16, 0.34, 0.4)),
  draw: [440, 440].map((f, i) => note(f, i * 0.16, 0.26, 0.35)),
};
const LENGTH = { roll: 0.6, win: 0.8, lose: 0.8, draw: 0.5, pack: 0.45, capture: 0.3, home: 0.45 };

mkdirSync(OUT, { recursive: true });
for (const [name, notes] of Object.entries(SOUNDS)) {
  const file = join(OUT, `${name}.wav`);
  writeFileSync(file, wav(render(notes, LENGTH[name] ?? 0.25)));
  console.log(file);
}
