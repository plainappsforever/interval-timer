import type { Session } from '@/db/sessions';

import { addDays, buckets, completionRatio, dayKey, inRange, isoWeekKey, longestStreak, monthKey, mostUsed, startOfDay, startOfWeek, streak, summary, totals } from './stats';
import { seeded } from '../../test/harness/fake-clock';

const session = (startedAt: number, extra: Partial<Session> = {}): Session => ({
  id: 0,
  timerId: 1,
  timerName: 'Tabata',
  startedAt,
  endedAt: startedAt + 250_000,
  plannedS: 250,
  actualS: 250,
  completed: true,
  skippedIntervals: 0,
  pauses: 0,
  interrupted: false,
  note: '',
  ...extra,
});
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('stats (A10)', () => {
  it('totals and ranges; property: totals equal the sum of the sessions', () => {
    const rnd = seeded(3);
    const sessions = Array.from({ length: 200 }, (_, i) => session(local(2026, 1, 1) + i * 3_600_000 * 7, { actualS: Math.floor(rnd() * 1000), plannedS: i % 7 === 0 ? null : Math.floor(rnd() * 1000), completed: rnd() > 0.5, skippedIntervals: Math.floor(rnd() * 3), pauses: Math.floor(rnd() * 2) }));
    const t = totals(sessions);
    expect(t.sessions).toBe(200);
    expect(t.actualS).toBe(sessions.reduce((n, s) => n + s.actualS, 0));
    expect(t.plannedS).toBe(sessions.reduce((n, s) => n + (s.plannedS ?? 0), 0));
    expect(t.completed).toBe(sessions.filter((s) => s.completed).length);
    const days = buckets(sessions, 'day');
    expect(days.reduce((n, b) => n + b.totals.sessions, 0)).toBe(200);
    expect(days.reduce((n, b) => n + b.totals.actualS, 0)).toBe(t.actualS);
    const weeks = buckets(sessions, 'week');
    expect(weeks.reduce((n, b) => n + b.totals.actualS, 0)).toBe(t.actualS);
    expect(weeks.every((b) => new Date(b.startMs).getDay() === 1 && new Date(b.startMs).getHours() === 0)).toBe(true);
    const months = buckets(sessions, 'month');
    expect(months.reduce((n, b) => n + b.totals.sessions, 0)).toBe(200);
    expect(months.every((b) => new Date(b.startMs).getDate() === 1)).toBe(true);
    expect(inRange(sessions, local(2026, 1, 1, 0), local(2026, 1, 2, 0))).toHaveLength(sessions.filter((s) => dayKey(s.startedAt) === '2026-01-01').length);
  });

  it('streak counts consecutive local days ending today or yesterday; survives DST changes', () => {
    // Europe/Berlin DST starts 2026-03-29; the test machine may be in any zone: the assertions only use local fields
    const days = [local(2026, 3, 26), local(2026, 3, 27), local(2026, 3, 28, 23), local(2026, 3, 29, 1), local(2026, 3, 30, 23)];
    const sessions = days.map((d) => session(d));
    expect(streak(sessions, local(2026, 3, 30, 23))).toBe(5);
    expect(streak(sessions, local(2026, 3, 31, 8))).toBe(5); // yesterday counts
    expect(streak(sessions, local(2026, 4, 1, 8))).toBe(0);
    expect(streak([...sessions, session(local(2026, 4, 1, 7))], local(2026, 4, 1, 8))).toBe(1); // March 31 missing: a new streak
    expect(streak([...sessions, session(local(2026, 3, 31, 7)), session(local(2026, 4, 1, 7))], local(2026, 4, 1, 8))).toBe(7);
    expect(streak([], local(2026, 4, 1))).toBe(0);
    expect(longestStreak(sessions)).toBe(5);
    expect(longestStreak([...sessions, session(local(2026, 5, 1)), session(local(2026, 5, 2))])).toBe(5);
    expect(longestStreak([session(local(2026, 5, 1)), session(local(2026, 5, 1, 20))])).toBe(1);
    // autumn change (2026-10-25 in Europe): 23:30 the day before and 00:30 after are different days
    expect(dayKey(local(2026, 10, 24, 23))).not.toBe(dayKey(local(2026, 10, 25, 1)));
    expect(addDays(local(2026, 10, 25, 0), 1)).toBe(local(2026, 10, 26, 0));
    expect(startOfDay(local(2026, 10, 25, 23))).toBe(local(2026, 10, 25, 0));
    expect(new Date(startOfWeek(local(2026, 10, 25))).getDay()).toBe(1);
  });

  it('most used timers, planned vs actual, best completion', () => {
    const sessions = [
      session(local(2026, 1, 1), { timerId: 1, timerName: 'Tabata' }),
      session(local(2026, 1, 2), { timerId: 1, timerName: 'Tabata renamed', actualS: 100, completed: false }),
      session(local(2026, 1, 3), { timerId: 2, timerName: 'Boxing', actualS: 900, plannedS: 1000, completed: false }),
      session(local(2026, 1, 4), { timerId: null, timerName: 'Deleted', actualS: 60, plannedS: null, completed: false }),
      session(local(2026, 1, 5), { timerId: null, timerName: 'Deleted', actualS: 60, plannedS: null, completed: true }),
    ];
    const used = mostUsed(sessions);
    expect(used.map((u) => [u.timerName, u.sessions, u.completed, u.bestCompletion])).toEqual([
      ['Tabata renamed', 2, 1, 1],
      ['Deleted', 2, 1, 1],
      ['Boxing', 1, 0, 0.9],
    ]);
    expect(completionRatio({ plannedS: 100, actualS: 40, completed: false })).toBe(0.4);
    expect(completionRatio({ plannedS: 100, actualS: 140, completed: false })).toBe(1);
    expect(completionRatio({ plannedS: null, actualS: 140, completed: false })).toBe(0);
    const s = summary(sessions, local(2026, 1, 5, 20));
    expect(s.all.sessions).toBe(5);
    expect(s.today.sessions).toBe(1);
    expect(s.streak).toBe(5);
    expect(s.mostUsed[0].timerName).toBe('Tabata renamed');
    expect(s.thisMonth.sessions).toBe(5);
  });
});

// D34 (after blind set B1 st-04/st-05): the engine names the buckets itself — day 'YYYY-MM-DD', week ISO-8601
// 'YYYY-Www' (the ISO year is the year of that week's Thursday), month 'YYYY-MM' — so the History screen and the
// CSV/stat texts cannot compute their own (wrong) week label. B1 passed only because its adapter relabelled the weeks.
describe('bucket keys (D34)', () => {
  it.each([
    [local(2026, 12, 28), '2026-W53'], // Monday of week 53 (2026 starts on a Thursday)
    [local(2026, 12, 31), '2026-W53'],
    [local(2027, 1, 1), '2026-W53'], // Friday: still the old ISO year
    [local(2027, 1, 3), '2026-W53'], // Sunday
    [local(2027, 1, 4), '2027-W01'],
    [local(2024, 12, 30), '2025-W01'], // Monday in December, ISO year 2025
    [local(2021, 1, 3), '2020-W53'],
    [local(2021, 1, 4), '2021-W01'],
    [local(2026, 10, 16), '2026-W42'],
  ])('isoWeekKey(case %#)', (ms, key) => {
    expect(isoWeekKey(ms)).toBe(key);
  });

  it('day, week and month buckets carry their final keys', () => {
    const sessions = [local(2026, 12, 27), local(2026, 12, 28), local(2027, 1, 2), local(2027, 1, 4, 0)].map((t) => session(t));
    expect(buckets(sessions, 'day').map((b) => b.key)).toEqual(['2026-12-27', '2026-12-28', '2027-01-02', '2027-01-04']);
    expect(buckets(sessions, 'week').map((b) => [b.key, b.totals.sessions])).toEqual([['2026-W52', 1], ['2026-W53', 2], ['2027-W01', 1]]);
    expect(buckets(sessions, 'month').map((b) => [b.key, b.totals.sessions])).toEqual([['2026-12', 2], ['2027-01', 2]]);
    expect(monthKey(local(2027, 1, 31, 23))).toBe('2027-01');
  });
});

