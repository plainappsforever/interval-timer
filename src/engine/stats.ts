// History statistics (SPEC §5.7, A10): pure functions over sessions. Days are LOCAL calendar days (the user's wall
// clock, DST included): a day key is built from the Date's local year/month/day, never from ms ÷ 86 400 000.
import type { Session } from '@/db/sessions';

export type DayKey = string; // 'YYYY-MM-DD' local

const two = (n: number) => String(n).padStart(2, '0');

export function dayKey(ms: number): DayKey {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/**
 * ISO-8601 week of the LOCAL date containing `ms`, as 'YYYY-Www' (D34): weeks start on Monday, week 1 holds the
 * year's first Thursday, so the ISO year is the year of that week's Thursday ('2027-01-01' → '2026-W53'). Computed on
 * the local calendar fields with UTC arithmetic, so DST never shifts a day.
 */
export function isoWeekKey(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const thursday = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - dow + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${two(week)}`;
}

/** 'YYYY-MM' of the local date containing `ms`. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}`;
}

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight `days` days after the day containing `ms` (DST-safe: built from calendar fields). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Monday 00:00 of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d.getTime(), -back);
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export type Totals = { sessions: number; completed: number; actualS: number; plannedS: number; skippedIntervals: number; pauses: number };

export function totals(sessions: readonly Session[]): Totals {
  const t: Totals = { sessions: 0, completed: 0, actualS: 0, plannedS: 0, skippedIntervals: 0, pauses: 0 };
  for (const s of sessions) {
    t.sessions++;
    if (s.completed) t.completed++;
    t.actualS += s.actualS;
    t.plannedS += s.plannedS ?? 0;
    t.skippedIntervals += s.skippedIntervals;
    t.pauses += s.pauses;
  }
  return t;
}

/** Sessions started in [fromMs, toMs). */
export function inRange(sessions: readonly Session[], fromMs: number, toMs: number): Session[] {
  return sessions.filter((s) => s.startedAt >= fromMs && s.startedAt < toMs);
}

/** `key`: day 'YYYY-MM-DD', week ISO 'YYYY-Www', month 'YYYY-MM' (D34); `startMs`: local midnight / Monday / 1st. */
export type Bucket = { key: string; startMs: number; totals: Totals };

/** Totals per local day/week (Monday–Sunday, ISO-8601)/month that has at least one session, oldest first. */
export function buckets(sessions: readonly Session[], unit: 'day' | 'week' | 'month'): Bucket[] {
  const startOf = unit === 'day' ? startOfDay : unit === 'week' ? startOfWeek : startOfMonth;
  const map = new Map<number, Session[]>();
  for (const s of sessions) {
    const k = startOf(s.startedAt);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  const keyOf = unit === 'day' ? dayKey : unit === 'week' ? isoWeekKey : monthKey;
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([startMs, list]) => ({ key: keyOf(startMs), startMs, totals: totals(list) }));
}

/**
 * Consecutive local days with at least one session, ending today or yesterday (a streak survives until the end of
 * today). `nowMs` is the current wall clock.
 */
export function streak(sessions: readonly Session[], nowMs: number): number {
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  let day = startOfDay(nowMs);
  if (!days.has(dayKey(day))) {
    day = addDays(day, -1);
    if (!days.has(dayKey(day))) return 0;
  }
  let n = 0;
  while (days.has(dayKey(day))) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** The longest run of consecutive days ever. */
export function longestStreak(sessions: readonly Session[]): number {
  const starts = [...new Set(sessions.map((s) => startOfDay(s.startedAt)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of starts) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export type TimerUsage = { timerId: number | null; timerName: string; sessions: number; actualS: number; completed: number; lastStartedAt: number; bestCompletion: number };

/** Per timer (by id, or by name for deleted timers): count, time, completions, best planned/actual ratio. Most used first. */
export function mostUsed(sessions: readonly Session[], limit = 5): TimerUsage[] {
  const map = new Map<string, TimerUsage>();
  for (const s of sessions) {
    const key = s.timerId !== null ? `id:${s.timerId}` : `name:${s.timerName}`;
    const u = map.get(key) ?? { timerId: s.timerId, timerName: s.timerName, sessions: 0, actualS: 0, completed: 0, lastStartedAt: 0, bestCompletion: 0 };
    u.sessions++;
    u.actualS += s.actualS;
    if (s.completed) u.completed++;
    u.lastStartedAt = Math.max(u.lastStartedAt, s.startedAt);
    if (s.startedAt >= u.lastStartedAt) u.timerName = s.timerName;
    u.bestCompletion = Math.max(u.bestCompletion, completionRatio(s));
    map.set(key, u);
  }
  return [...map.values()].sort((a, b) => b.sessions - a.sessions || b.actualS - a.actualS || b.lastStartedAt - a.lastStartedAt).slice(0, limit);
}

/** actual / planned, capped at 1; 1 for a completed session; 0 when planned is unknown and not completed. */
export function completionRatio(s: Pick<Session, 'plannedS' | 'actualS' | 'completed'>): number {
  if (s.completed) return 1;
  if (s.plannedS === null || s.plannedS <= 0) return 0;
  return Math.min(1, s.actualS / s.plannedS);
}

export type Summary = { all: Totals; today: Totals; thisWeek: Totals; thisMonth: Totals; streak: number; longestStreak: number; mostUsed: TimerUsage[] };

export function summary(sessions: readonly Session[], nowMs: number): Summary {
  const day = startOfDay(nowMs);
  return {
    all: totals(sessions),
    today: totals(inRange(sessions, day, addDays(day, 1))),
    thisWeek: totals(inRange(sessions, startOfWeek(nowMs), addDays(startOfWeek(nowMs), 7))),
    thisMonth: totals(inRange(sessions, startOfMonth(nowMs), startOfMonth(addDays(startOfMonth(nowMs), 32)))),
    streak: streak(sessions, nowMs),
    longestStreak: longestStreak(sessions),
    mostUsed: mostUsed(sessions),
  };
}
