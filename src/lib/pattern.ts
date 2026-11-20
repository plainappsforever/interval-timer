// The shape of a timer for the home screen (poster ring, tile strips): work and rest pieces in run order, lengths in
// seconds. Pure; reads the timer definition only (the timeline engine is not involved). Prep is left out: it is not part
// of the pattern a person recognises. Cooldown counts as rest, an open interval as work.
import type { TimerDef } from '@/engine/model';
import { colorOf } from '@/engine/palette';

export type PatternPiece = { seconds: number; kind: 'work' | 'rest'; color: string };

export function patternOf(def: TimerDef): PatternPiece[] {
  const out: PatternPiece[] = [];
  const push = (seconds: number, kind: PatternPiece['kind'], color: string) => {
    if (seconds <= 0) return;
    const last = out[out.length - 1];
    // neighbours of the same kind and colour are one piece (a long strip stays readable)
    if (last && last.kind === kind && last.color === color) last.seconds += seconds;
    else out.push({ seconds, kind, color });
  };
  for (let r = 0; r < def.prefs.repeatWhole; r++) {
    for (const b of def.blocks) {
      for (let round = 0; round < b.rounds; round++) {
        for (const iv of b.intervals) {
          const rest = iv.type === 'rest' || iv.type === 'cooldown' || iv.type === 'prep';
          push(iv.seconds, rest ? 'rest' : 'work', rest ? '' : colorOf(iv.color, iv.type));
        }
        if (b.restBetweenRoundsS > 0 && round < b.rounds - 1) push(b.restBetweenRoundsS, 'rest', '');
      }
    }
  }
  return out;
}

/** Ring segments as fractions of a full turn (work and rest alternate or repeat; gaps are drawn by the ring). */
export function ringArcs(def: TimerDef): { from: number; to: number; kind: 'work' | 'rest' }[] {
  const pieces = patternOf(def);
  const total = pieces.reduce((n, p) => n + p.seconds, 0);
  if (total <= 0) return [];
  let at = 0;
  return pieces.map((p) => {
    const from = at / total;
    at += p.seconds;
    return { from, to: at / total, kind: p.kind };
  });
}

/** "8 rounds · 20 s / 10 s" parts: rounds of the first block and up to three interval lengths, or null for the rounds. */
export function patternSummary(def: TimerDef): { rounds: number; lengths: number[]; blocks: number } {
  const first = def.blocks[0];
  return {
    rounds: first ? first.rounds * def.prefs.repeatWhole : 0,
    lengths: first ? first.intervals.slice(0, 3).map((iv) => iv.seconds) : [],
    blocks: def.blocks.length,
  };
}
