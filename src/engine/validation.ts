// Timer limits (SPEC §5.3). Pure; messages are i18n keys with their parameters so screens render them in any language.
import type { MessageKey } from '@/i18n/en';

import type { BlockDef, IntervalDef, TimerDef, TimerPrefs } from './model';

export const LIMITS = {
  nameMax: 40,
  secondsMin: 1,
  secondsMax: 5999,
  roundsMin: 1,
  roundsMax: 99,
  restBetweenRoundsMax: 5999,
  blocksMax: 20,
  intervalsPerBlockMax: 30,
  prepMax: 60,
  repeatMin: 1,
  repeatMax: 10,
  openTickMax: 5999,
  /** Live Activity limit (D18): 8 hours. */
  totalSecondsMax: 8 * 3600,
} as const;

export type ValidationIssue = {
  key: MessageKey;
  params?: Record<string, string | number>;
  /** Where in the timer: `blocks[i]` / `blocks[i].intervals[j]`, or 'name' / 'prefs' / 'total'. */
  path: string;
};

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Length of a name in Unicode CODE POINTS (D31): "💪" counts 1, not 2 as JS `.length` (UTF-16 units) would; a lone
 * surrogate counts 1. No normalisation: the string is counted as stored. A TextInput's `maxLength` counts UTF-16 units,
 * so the editor must not rely on it for the limit: validate with this and trim with `clampName`.
 */
export function nameLength(name: string): number {
  return Array.from(name).length;
}

/** The first `LIMITS.nameMax` code points of `text` (never splits a surrogate pair); for the editor's onChangeText. */
export function clampName(text: string, max: number = LIMITS.nameMax): string {
  if (text.length <= max) return text; // ≤ max UTF-16 units ⇒ ≤ max code points
  return Array.from(text).slice(0, max).join('');
}

const nameTooLong = (name: string) => nameLength(name) > LIMITS.nameMax;

export function validateInterval(iv: IntervalDef, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof iv.name !== 'string' || iv.name.trim().length === 0 || nameTooLong(iv.name)) {
    issues.push({ key: 'validation.name', params: { max: LIMITS.nameMax }, path: `${path}.name` });
  }
  if (!isInt(iv.seconds) || iv.seconds < LIMITS.secondsMin || iv.seconds > LIMITS.secondsMax) {
    issues.push({ key: 'validation.seconds', path: `${path}.seconds` });
  }
  if (!isInt(iv.openTickS) || iv.openTickS < 0 || iv.openTickS > LIMITS.openTickMax) {
    issues.push({ key: 'validation.openTick', path: `${path}.openTickS` });
  }
  return issues;
}

export function validateBlock(b: BlockDef, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof b.name !== 'string' || nameTooLong(b.name)) {
    issues.push({ key: 'validation.name', params: { max: LIMITS.nameMax }, path: `${path}.name` });
  }
  if (!isInt(b.rounds) || b.rounds < LIMITS.roundsMin || b.rounds > LIMITS.roundsMax) {
    issues.push({ key: 'validation.rounds', params: { max: LIMITS.roundsMax }, path: `${path}.rounds` });
  }
  if (!isInt(b.restBetweenRoundsS) || b.restBetweenRoundsS < 0 || b.restBetweenRoundsS > LIMITS.restBetweenRoundsMax) {
    issues.push({ key: 'validation.restBetweenRounds', path: `${path}.restBetweenRoundsS` });
  }
  if (!Array.isArray(b.intervals) || b.intervals.length === 0) {
    issues.push({ key: 'validation.noIntervals', path: `${path}.intervals` });
  } else {
    if (b.intervals.length > LIMITS.intervalsPerBlockMax) {
      issues.push({ key: 'validation.intervals', params: { max: LIMITS.intervalsPerBlockMax }, path: `${path}.intervals` });
    }
    b.intervals.forEach((iv, j) => issues.push(...validateInterval(iv, `${path}.intervals[${j}]`)));
  }
  return issues;
}

export function validatePrefs(p: TimerPrefs): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isInt(p.prepSeconds) || p.prepSeconds < 0 || p.prepSeconds > LIMITS.prepMax) {
    issues.push({ key: 'validation.prep', params: { max: LIMITS.prepMax }, path: 'prefs.prepSeconds' });
  }
  if (!isInt(p.repeatWhole) || p.repeatWhole < LIMITS.repeatMin || p.repeatWhole > LIMITS.repeatMax) {
    issues.push({ key: 'validation.repeat', params: { max: LIMITS.repeatMax }, path: 'prefs.repeatWhole' });
  }
  return issues;
}

/**
 * Planned length in seconds, counting an open interval at its nominal `seconds` (the editor's estimate; the real run
 * waits for Next). Does not validate: callers check limits first or accept a large number.
 */
export function plannedSeconds(def: TimerDef): number {
  let perRepeat = 0;
  for (const b of def.blocks) {
    const round = b.intervals.reduce((n, iv) => n + iv.seconds, 0);
    perRepeat += round * b.rounds + b.restBetweenRoundsS * Math.max(0, b.rounds - 1);
  }
  return def.prefs.prepSeconds + perRepeat * def.prefs.repeatWhole;
}

/** Every limit of SPEC §5.3; an empty list means the timer can be saved and run. */
export function validateTimer(def: TimerDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof def.name !== 'string' || def.name.trim().length === 0 || nameTooLong(def.name)) {
    issues.push({ key: 'validation.name', params: { max: LIMITS.nameMax }, path: 'name' });
  }
  if (!Array.isArray(def.blocks) || def.blocks.length === 0) {
    issues.push({ key: 'validation.noIntervals', path: 'blocks' });
  } else {
    if (def.blocks.length > LIMITS.blocksMax) issues.push({ key: 'validation.blocks', params: { max: LIMITS.blocksMax }, path: 'blocks' });
    def.blocks.forEach((b, i) => issues.push(...validateBlock(b, `blocks[${i}]`)));
  }
  issues.push(...validatePrefs(def.prefs));
  if (issues.length === 0 && plannedSeconds(def) > LIMITS.totalSecondsMax) {
    issues.push({ key: 'validation.total', path: 'total' });
  }
  return issues;
}
