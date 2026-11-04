/**
 * @jest-environment node
 */
import type { Session } from '@/db/sessions';
import { dayKey } from '@/engine/stats';

import { otherActiveRun, clearActiveRun, setActiveRun } from './active-run';
import { daySections, recentBuckets } from './history-view';

let nextId = 1;
function session(startedAt: Date, actualS = 600, extra: Partial<Session> = {}): Session {
  const ms = startedAt.getTime();
  return { id: nextId++, timerId: 1, timerName: 'Tabata', startedAt: ms, endedAt: ms + actualS * 1000, plannedS: 600, actualS, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: '', ...extra };
}

test('daySections: one section per local day, newest first, keys from the engine (D34), totals per day', () => {
  const list = [
    session(new Date(2026, 9, 24, 8, 0)),
    session(new Date(2026, 9, 26, 7, 0), 300),
    session(new Date(2026, 9, 26, 18, 30), 120),
    session(new Date(2026, 9, 25, 23, 59)),
  ];
  const sections = daySections(list);
  expect(sections.map((s) => s.key)).toEqual(['2026-10-26', '2026-10-25', '2026-10-24']);
  expect(sections[0].key).toBe(dayKey(new Date(2026, 9, 26, 12).getTime()));
  expect(sections[0].data.map((s) => s.actualS)).toEqual([120, 300]); // newest first inside the day
  expect(sections[0].totals).toMatchObject({ sessions: 2, actualS: 420 });
  expect(sections.reduce((n, s) => n + s.data.length, 0)).toBe(list.length);
});

test('recentBuckets: newest ISO weeks / months first, at most `limit`', () => {
  const list = [session(new Date(2026, 11, 31, 10)), session(new Date(2027, 0, 1, 10)), session(new Date(2026, 9, 1, 10)), session(new Date(2026, 9, 2, 10))];
  expect(recentBuckets(list, 'week').map((b) => b.key)).toEqual(['2026-W53', '2026-W40']);
  expect(recentBuckets(list, 'month').map((b) => b.key)).toEqual(['2027-01', '2026-12', '2026-10']);
  expect(recentBuckets(list, 'month', 1).map((b) => b.key)).toEqual(['2027-01']);
  expect(recentBuckets([], 'week')).toEqual([]);
});

test('two-sessions registry (D41): a screen sees only another screen’s run; clearing is per owner', async () => {
  expect(otherActiveRun()).toBeNull();
  const ended: string[] = [];
  setActiveRun({ token: 'a', timerName: 'Tabata', end: async () => void ended.push('a') });
  expect(otherActiveRun('a')).toBeNull();
  expect(otherActiveRun('b')?.timerName).toBe('Tabata');
  expect(otherActiveRun()?.timerName).toBe('Tabata');
  clearActiveRun('b'); // not the owner
  expect(otherActiveRun('b')).not.toBeNull();
  await otherActiveRun('b')?.end();
  expect(ended).toEqual(['a']);
  clearActiveRun('a');
  expect(otherActiveRun('b')).toBeNull();
});
