// Development-only seed (A9: 500 timers list and search in < 300 ms). Used by the debug route; never in release.
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { COLORS, COLOR_NAMES } from '@/engine/palette';

import { createTimer } from './timers';
import type { Db } from './types';

/** Deterministic variety: different round counts, lengths, block counts and names, so lists and search get exercised. */
export function seedTimerDef(i: number): TimerDef {
  const rounds = 1 + (i % 12);
  const work = 10 + (i % 7) * 5;
  const rest = 5 + (i % 4) * 5;
  const blocks = 1 + (i % 3);
  return {
    name: `Seed ${String(i + 1).padStart(3, '0')} ${['HIIT', 'Tabata', 'Circuit', 'Boxing', 'Run'][i % 5]}`,
    color: COLORS[COLOR_NAMES[i % COLOR_NAMES.length]],
    notes: '',
    prefs: { ...DEFAULT_PREFS, prepSeconds: (i % 4) * 5 },
    blocks: Array.from({ length: blocks }, (_, b) =>
      block([interval(`Work ${b + 1}`, work, 'work'), interval('Rest', rest, 'rest')], { rounds, restBetweenRoundsS: b === 0 ? 0 : 30, name: blocks > 1 ? `Block ${b + 1}` : '' })
    ),
  };
}

export async function seedManyTimers(db: Db, count: number, now = Date.now()): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(await createTimer(db, seedTimerDef(i), now + i));
  return ids;
}
