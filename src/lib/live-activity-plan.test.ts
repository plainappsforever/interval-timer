/**
 * @jest-environment node
 */
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { apply, idle, view } from '@/engine/runner';
import { buildTimeline } from '@/engine/schedule';

import { liveActivityPlan, needsUpdate, OPEN_WINDOW_MS, STALE_AFTER_MS } from './live-activity-plan';

const DEF: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 2 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 5 },
};
const OPTIONS = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
const WALL = 1_800_000_000_000;

function runningAt(elapsedMs: number) {
  const s = apply(idle(buildTimeline(DEF, OPTIONS)), 'start', 0);
  return { s, v: view(s, elapsedMs) };
}

const input = (v: ReturnType<typeof view> | null, enabled = true, nowWall = WALL) => ({ enabled, timerName: 'Tabata', view: v, nowWall, pausedLabel: 'Paused' });

test('off, idle, ended or no view → end', () => {
  const { s, v } = runningAt(7000);
  expect(liveActivityPlan(input(v, false))).toEqual({ action: 'end' });
  expect(liveActivityPlan(input(null))).toEqual({ action: 'end' });
  expect(liveActivityPlan(input(view(idle(s.timeline), 0)))).toEqual({ action: 'end' });
  expect(liveActivityPlan(input(view(apply(s, 'end', 8000), 8000)))).toEqual({ action: 'end' });
  expect(liveActivityPlan(input(view(s, 70_000)))).toEqual({ action: 'end' }); // past the 65 s total
});

test('running: the system timer counts down to the end of the current interval', () => {
  const { v } = runningAt(7000); // 2 s into Work (prep 5 s)
  const p = liveActivityPlan(input(v));
  if (p.action !== 'show') throw new Error('expected show');
  expect(p.props.interval).toBe('Work');
  expect(p.props.title).toBe('Tabata');
  expect(p.props.detail).toBe('Round 1 of 2');
  expect(p.props.countsDown).toBe(true);
  expect(p.props.paused).toBe(false);
  expect(p.props.startAt).toBe(WALL - 2000);
  expect(p.props.endAt).toBe(WALL + 18_000);
  expect(p.staleAt).toBe(WALL + 18_000 + STALE_AFTER_MS);
  expect(p.props.textColor).toMatch(/^#/);
});

test('paused: "Paused" and a frozen clock, no stale date', () => {
  const { s } = runningAt(0);
  const paused = apply(s, 'pause', 7000);
  const p = liveActivityPlan(input(view(paused, 60_000)));
  if (p.action !== 'show') throw new Error('expected show');
  expect(p.props.paused).toBe(true);
  expect(p.props.detail).toBe('Paused');
  expect(p.props.pausedClock).toBe('00:18');
  expect(p.staleAt).toBeNull();
});

test('open interval counts up inside a window', () => {
  const def: TimerDef = { ...DEF, blocks: [block([interval('Plank', 60, 'open')])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
  const s = apply(idle(buildTimeline(def, OPTIONS)), 'start', 0);
  const p = liveActivityPlan(input(view(s, 4000)));
  if (p.action !== 'show') throw new Error('expected show');
  expect(p.props.countsDown).toBe(false);
  expect(p.props.startAt).toBe(WALL - 4000);
  expect(p.props.endAt).toBe(WALL - 4000 + OPEN_WINDOW_MS);
  expect(p.staleAt).toBeNull();
});

test('needsUpdate: ticks of the same segment do not update; a new segment, pause, +30 s or Back do', () => {
  const { s } = runningAt(0);
  const at = (state: typeof s, t: number) => {
    const p = liveActivityPlan(input(view(state, t), true, WALL + t));
    if (p.action !== 'show') throw new Error('expected show');
    return p.props;
  };
  const a = at(s, 6000);
  expect(needsUpdate(null, a)).toBe(true);
  expect(needsUpdate(a, at(s, 6200))).toBe(false);
  expect(needsUpdate(a, at(s, 24_900))).toBe(false); // still Work
  expect(needsUpdate(a, at(s, 25_100))).toBe(true); // Rest
  expect(needsUpdate(a, at(apply(s, 'addTime', 6000), 6200))).toBe(true);
  const back = apply(s, 'back', 9000); // restarts Work at 9 s wall
  expect(needsUpdate(at(s, 9000), at(back, 9000))).toBe(true);
  const paused = apply(s, 'pause', 6000);
  expect(needsUpdate(a, at(paused, 6000))).toBe(true);
  expect(needsUpdate(at(paused, 6000), at(paused, 30_000))).toBe(false);
});
