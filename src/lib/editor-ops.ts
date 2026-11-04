// Immutable list helpers for the timer editor (SPEC §7 screen 2: reorder, duplicate, remove blocks and intervals) and
// the save-time clean-up (REVIEW S7: names are trimmed on save). Pure.
import { block, defaultInterval, type BlockDef, type IntervalDef, type IntervalType, type TimerDef } from '@/engine/model';
import { clampName, LIMITS } from '@/engine/validation';

export function setAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((x, i) => (i === index ? value : x));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** Moves the item at `index` by `delta` (−1 up, +1 down); out of range = unchanged copy. */
export function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

/** Inserts a deep copy of the item at `index` right after it. */
export function duplicateAt<T>(list: readonly T[], index: number): T[] {
  if (index < 0 || index >= list.length) return [...list];
  const copy = JSON.parse(JSON.stringify(list[index])) as T;
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}

/** The next value in a fixed cycle (type, cue mode, colour buttons). */
export function cycle<T>(values: readonly T[], current: T): T {
  const i = values.indexOf(current);
  return values[(i + 1) % values.length];
}

/** A fresh interval for "Add interval": alternates work/rest after the block's last interval. */
export function nextInterval(b: BlockDef, names: Record<'work' | 'rest', string>, halfwayDefault: boolean): IntervalDef {
  const last = b.intervals[b.intervals.length - 1];
  const type: IntervalType = last?.type === 'work' ? 'rest' : 'work';
  return { ...defaultInterval(type), name: type === 'work' ? names.work : names.rest, seconds: type === 'work' ? 30 : 15, halfwayCue: halfwayDefault };
}

/** A new timer: one block of work 30 s / rest 15 s × 8 rounds (a sensible start the user edits). */
export function newTimerDef(name: string, names: Record<'work' | 'rest', string>, halfwayDefault: boolean): TimerDef {
  const work = { ...defaultInterval('work'), name: names.work, seconds: 30, halfwayCue: halfwayDefault };
  const rest = { ...defaultInterval('rest'), name: names.rest, seconds: 15, halfwayCue: halfwayDefault };
  return { name, color: '', notes: '', blocks: [block([work, rest], { rounds: 8 })], prefs: { prepSeconds: 10, endCue: 'both', repeatWhole: 1, vibrate: true } };
}

/** What the editor saves: every name trimmed (REVIEW S7) and clamped to 40 code points (D31). */
export function cleanForSave(def: TimerDef): TimerDef {
  const clean = (s: string) => clampName(s.trim(), LIMITS.nameMax);
  return {
    ...def,
    name: clean(def.name),
    blocks: def.blocks.map((b) => ({ ...b, name: clean(b.name), intervals: b.intervals.map((iv) => ({ ...iv, name: clean(iv.name) })) })),
  };
}

/** True when any interval is open (runs until Next): the editor shows the iOS note (SPEC §9), the total is an estimate. */
export function hasOpenInterval(def: TimerDef): boolean {
  return def.blocks.some((b) => b.intervals.some((iv) => iv.type === 'open'));
}
