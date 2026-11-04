#!/usr/bin/env node
// Generates the app's cue tones as 44.1kHz 16-bit mono PCM WAV files under assets/sounds/.
// Pure Node, no dependencies. Deterministic: rerun to regenerate identical bytes.
// Usage: node scripts/gen-tones.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'sounds');
// Copied from Breathe (scripts/gen-tones.mjs at 9bb123a) and given this app's sounds (V1_PLAN P5): three beep sets
// (classic / soft / bright) × start, halfway, countdown tick, end chime, plus the near-silent ambient bed.
// The Android session runner (modules/session-runner, D12/D14) plays the same tones natively from res/raw,
// so locked-mode cues never depend on Metro or JS asset resolution. Same bytes, `sr_` prefix.
const RUNNER_RAW_DIR = join(ROOT, 'modules', 'session-runner', 'android', 'src', 'main', 'res', 'raw');

/** Linear attack, flat sustain, linear release — keeps every tone click-free at its edges. */
function envelopeAt(i, n, attackN, releaseN) {
  if (i < attackN) return i / attackN;
  if (i > n - releaseN) return Math.max(0, (n - i) / releaseN);
  return 1;
}

function tone(freq, durationSec, { amplitude = 0.3, attackMs = 15, releaseMs = 30 } = {}) {
  const n = Math.round(durationSec * SAMPLE_RATE);
  const attackN = Math.max(1, Math.round((attackMs / 1000) * SAMPLE_RATE));
  const releaseN = Math.max(1, Math.round((releaseMs / 1000) * SAMPLE_RATE));
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = Math.sin(2 * Math.PI * freq * t) * amplitude * envelopeAt(i, n, attackN, releaseN);
  }
  return samples;
}

function silence(durationSec) {
  return new Float32Array(Math.round(durationSec * SAMPLE_RATE));
}

function concat(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toWav(samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (mono 16-bit)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

/** A single sine cycle count keeps the loop point phase-continuous (no click) at freq Hz. */
function loopableTone(freq, durationSec, amplitude) {
  const cycles = Math.round(freq * durationSec);
  const exactDuration = cycles / freq;
  return tone(freq, exactDuration, { amplitude, attackMs: 200, releaseMs: 200 });
}

// SPEC §5.1 cue kinds → clips (src/engine/cue-text.ts BEEP_CLIP): start (also round), halfway, tick (countdown and
// open-interval reminder), end. A set changes pitch and attack, never the meaning: start rises, tick is short and
// neutral, halfway is a double blip, end is a three-note chime.
const SETS = {
  classic: { base: 660, amp: 0.34, attack: 8 },
  soft: { base: 440, amp: 0.26, attack: 30 },
  bright: { base: 990, amp: 0.3, attack: 4 },
};

const cues = {};
for (const [set, { base, amp, attack }] of Object.entries(SETS)) {
  const t = (f, d, o = {}) => tone(f, d, { amplitude: amp, attackMs: attack, ...o });
  cues[`${set}_start.wav`] = concat(t(base, 0.16, { releaseMs: 15 }), silence(0.02), t(base * 1.5, 0.32, { releaseMs: 80 }));
  cues[`${set}_halfway.wav`] = concat(t(base * 1.25, 0.09, { releaseMs: 20 }), silence(0.07), t(base * 1.25, 0.09, { releaseMs: 30 }));
  cues[`${set}_tick.wav`] = t(base * 1.333, 0.11, { releaseMs: 35 });
  cues[`${set}_end.wav`] = concat(
    t(base * 0.79, 0.3, { releaseMs: 40 }),
    silence(0.03),
    t(base, 0.3, { releaseMs: 40 }),
    silence(0.03),
    t(base * 1.19, 0.5, { releaseMs: 160 })
  );
}
// Near-silent (~ -40 dB) looping bed so iOS keeps the audio session (and JS timers) alive while a timer runs locked, and
// the Android runner's mediaPlayback service plays real media (D14); phase-continuous loop point.
cues['ambient.wav'] = loopableTone(60, 3, 0.01);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RUNNER_RAW_DIR, { recursive: true });
for (const [name, samples] of Object.entries(cues)) {
  writeFileSync(join(OUT_DIR, name), toWav(samples));
  writeFileSync(join(RUNNER_RAW_DIR, `sr_${name}`), toWav(samples));
  console.log(`wrote ${name} (${(samples.length / SAMPLE_RATE).toFixed(2)}s, ${samples.length * 2} bytes PCM)`);
}
