import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { evaluateRecovery, MAX_OPEN_RUN_MS, MAX_PAUSED_MS, parseRecovery, recoveryRecord, restoreRunner, sessionOf } from './recovery';
import { addTime, elapsedAt, idle, next, pause, start } from './runner';
import { buildTimeline } from './schedule';

const opts = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
const tabata: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 10 },
};
const meta = { timerId: 7, timerName: 'Tabata', def: tabata, startedAtWall: 1_700_000_000_000, interrupted: false };
const MONO = 5_000; // monotonic clock is unrelated to wall time
const WALL = 1_700_000_000_000;

describe('recovery (D13, A8)', () => {
  it('writes a record for running/paused states only, and parses it back', () => {
    const s = start(idle(buildTimeline(tabata, opts)), MONO);
    const rec = recoveryRecord(s, meta, MONO + 30_000, WALL + 30_000);
    expect(rec).toMatchObject({ version: 1, timerId: 7, status: 'running', elapsedMs: 30_000, baseWallMs: WALL, writtenAtWall: WALL + 30_000 });
    expect(parseRecovery(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
    expect(parseRecovery(null)).toBeNull();
    expect(parseRecovery({ version: 1 })).toBeNull();
    expect(parseRecovery({ ...rec, status: 'idle' })).toBeNull();
    expect(recoveryRecord({ ...s, status: 'ended' }, meta, MONO, WALL)).toBeNull();
    const paused = recoveryRecord(pause(s, MONO + 40_000), meta, MONO + 45_000, WALL + 45_000);
    expect(paused).toMatchObject({ status: 'paused', elapsedMs: 40_000, baseWallMs: null, pauses: 1 });
  });

  it('a running record resumes at the wall-clock elapsed (± nothing: pure arithmetic), or finishes past the end', () => {
    const s = start(idle(buildTimeline(tabata, opts)), MONO);
    const rec = recoveryRecord(s, meta, MONO + 30_000, WALL + 30_000)!;
    expect(evaluateRecovery(rec, WALL + 95_000)).toEqual({ status: 'resume', elapsedMs: 95_000, paused: false });
    expect(evaluateRecovery(rec, WALL + 250_000)).toEqual({ status: 'finished', elapsedMs: 250_000, completed: true });
    expect(evaluateRecovery(rec, WALL + 10)).toEqual({ status: 'resume', elapsedMs: 30_000, paused: false }); // clock went backwards: never before what was written
    const restored = restoreRunner(rec, { status: 'resume', elapsedMs: 95_000, paused: false }, 777);
    expect(restored).toMatchObject({ status: 'paused', elapsedMs: 95_000, segmentIndex: 6 });
  });

  it('a paused record resumes where it was paused; after a day it is saved as partial', () => {
    const s = pause(start(idle(buildTimeline(tabata, opts)), MONO), MONO + 40_000);
    const rec = recoveryRecord(s, meta, MONO + 41_000, WALL + 41_000)!;
    expect(evaluateRecovery(rec, WALL + 3_600_000)).toEqual({ status: 'resume', elapsedMs: 40_000, paused: true });
    expect(evaluateRecovery(rec, WALL + 41_000 + MAX_PAUSED_MS + 1)).toEqual({ status: 'finished', elapsedMs: 40_000, completed: false });
  });

  it('replays +30 s and Next events so the restored timeline matches the one that ran', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('Work', 20, 'work'), interval('Plank', 60, 'open'), interval('Rest', 10, 'rest')])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    let s = start(idle(buildTimeline(def, opts)), MONO);
    s = addTime(s, MONO + 5_000); // Work 0-50000
    s = next(s, MONO + 70_000); // Plank 50000-70000, Rest 70000-80000
    const rec = recoveryRecord(s, { ...meta, def }, MONO + 72_000, WALL + 72_000)!;
    expect(rec.events).toEqual([
      { kind: 'extend', index: 0, deltaMs: 30_000 },
      { kind: 'next', atElapsedMs: 70_000 },
    ]);
    const outcome = evaluateRecovery(rec, WALL + 75_000);
    expect(outcome).toEqual({ status: 'resume', elapsedMs: 75_000, paused: false });
    const restored = restoreRunner(rec, outcome as never, 1);
    expect(restored.timeline.segments.map((x) => [x.label, x.startMs, x.endMs])).toEqual(s.timeline.segments.map((x) => [x.label, x.startMs, x.endMs]));
    expect(restored.timeline.totalMs).toBe(80_000);
    expect(elapsedAt(restored, 1)).toBe(75_000);
    expect(evaluateRecovery(rec, WALL + 80_000)).toEqual({ status: 'finished', elapsedMs: 80_000, completed: true });
  });

  it('an open-ended run is resumed for up to 2 hours, then saved as partial', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('Hold', 30, 'open')])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    const rec = recoveryRecord(start(idle(buildTimeline(def, opts)), MONO), { ...meta, def }, MONO + 1_000, WALL + 1_000)!;
    expect(evaluateRecovery(rec, WALL + 3_600_000)).toEqual({ status: 'resume', elapsedMs: 3_600_000, paused: false });
    expect(evaluateRecovery(rec, WALL + MAX_OPEN_RUN_MS + 1)).toEqual({ status: 'finished', elapsedMs: 1_000, completed: false });
  });

  it('sessionOf builds the history row (planned null for open timers; seconds rounded)', () => {
    const s = start(idle(buildTimeline(tabata, opts)), MONO);
    expect(sessionOf(tabata, { ...s, skipped: 2, pauses: 1 }, 123_456, false, WALL, WALL + 130_000, true)).toEqual({
      timerName: 'Tabata',
      startedAt: WALL,
      endedAt: WALL + 130_000,
      plannedS: 250,
      actualS: 123,
      completed: false,
      skippedIntervals: 2,
      pauses: 1,
      interrupted: true,
      note: '',
    });
    const open: TimerDef = { ...tabata, blocks: [block([interval('Hold', 30, 'open')])] };
    expect(sessionOf(open, s, 10_000, true, WALL, WALL, false).plannedS).toBeNull();
  });
});
