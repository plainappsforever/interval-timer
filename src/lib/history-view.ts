// History screen data (SPEC §7 screen 5, A10, D34): sessions grouped by local day under the engine's bucket keys,
// newest first, and the recent week/month buckets for the totals card. Pure; the engine computes every key.
import type { Session } from '@/db/sessions';
import { buckets, dayKey, startOfDay, totals, type Bucket, type Totals } from '@/engine/stats';

export type DaySection = { key: string; startMs: number; totals: Totals; data: Session[] };

/** One section per local day with sessions, newest day first; sessions newest first inside a day. */
export function daySections(sessions: readonly Session[]): DaySection[] {
  const byDay = new Map<string, { startMs: number; list: Session[] }>();
  for (const s of sessions) {
    const key = dayKey(s.startedAt);
    const entry = byDay.get(key) ?? { startMs: startOfDay(s.startedAt), list: [] };
    entry.list.push(s);
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[1].startMs - a[1].startMs)
    .map(([key, { startMs, list }]) => {
      const data = [...list].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id);
      return { key, startMs, totals: totals(data), data };
    });
}

/** The newest `limit` week or month buckets, newest first (keys `YYYY-Www` / `YYYY-MM`, D34). */
export function recentBuckets(sessions: readonly Session[], unit: 'week' | 'month', limit = 6): Bucket[] {
  return buckets(sessions, unit).reverse().slice(0, limit);
}
