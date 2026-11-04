/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { listSessions } from '@/db/sessions';
import { getSetting } from '@/db/settings';
import { createTimer } from '@/db/timers';
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { evaluateRecovery, parseRecovery, restoreRunner } from '@/engine/recovery';
import { idle, type RunnerState } from '@/engine/runner';
import { buildTimeline } from '@/engine/schedule';

import type { CueDriver, CueOutput, SyncReason } from './cues';
import { RunSession, syncReasonFor } from './run-session';

const DEF: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 2 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 5 },
};
const OPTIONS = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
// 5 s prep + 2 × 30 s = 65 s

function fakeDriver(native: boolean) {
  const syncs: SyncReason[] = [];
  const outputs: CueOutput[] = [];
  const driver: CueDriver = {
    native,
    sync: (_s: RunnerState, reason: SyncReason) => void syncs.push(reason),
    setOutput: (o: CueOutput) => void outputs.push(o),
    dispose: () => {},
  };
  return { driver, syncs, outputs };
}

async function setup(native = true, initial?: RunnerState, withTimer = true) {
  const db = createTestDb();
  await migrate(db);
  const timerId = withTimer ? await createTimer(db, DEF) : 999;
  let mono = 1000;
  let wall = 1_700_000_000_000;
  const clock = {
    advance(ms: number) {
      mono += ms;
      wall += ms;
    },
  };
  const { driver, syncs, outputs } = fakeDriver(native);
  const finished: number[] = [];
  const missing: string[] = [];
  const session = new RunSession(
    {
      db,
      driver,
      now: () => mono,
      wall: () => wall,
      onFinished: (id) => finished.push(id),
      onMissingVoice: (c) => missing.push(c.text ?? ''),
      hasVoiceClip: () => false,
    },
    { timerId, timerName: 'Tabata', def: DEF, startedAtWall: wall, interrupted: false },
    initial ?? idle(buildTimeline(DEF, OPTIONS))
  );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { db, timerId, session, syncs, outputs, finished, missing, clock, flush, now: () => ({ mono, wall }) };
}

describe('RunSession (P6 running screen controller)', () => {
  it('maps transitions to driver syncs (start/pause/resume/jump/extend/end)', () => {
    const t = buildTimeline(DEF, OPTIONS);
    const running: RunnerState = { ...idle(t), status: 'running' };
    expect(syncReasonFor('start', running, false)).toBe('start');
    expect(syncReasonFor('resume', running, false)).toBe('start');
    expect(syncReasonFor('resume', running, true)).toBe('resume');
    expect(syncReasonFor('toggle', { ...running, status: 'paused' }, true)).toBe('pause');
    expect(syncReasonFor('skip', running, true)).toBe('jump');
    expect(syncReasonFor('next', running, true)).toBe('jump');
    expect(syncReasonFor('addTime', running, true)).toBe('extend');
    expect(syncReasonFor('skip', { ...running, status: 'ended' }, true)).toBe('end');
  });

  it('a fresh run starts the driver, writes the recovery record on every transition and syncs every action', async () => {
    const { db, session, syncs, clock, flush } = await setup();
    session.begin();
    await flush();
    expect(session.state.status).toBe('running');
    expect(parseRecovery(await getSetting(db, 'recovery'))?.status).toBe('running');
    clock.advance(2000);
    expect(session.act('skip')).toBe(true); // prep → Work
    expect(session.act('addTime')).toBe(true);
    expect(session.act('toggle')).toBe(true);
    await flush();
    expect(parseRecovery(await getSetting(db, 'recovery'))?.status).toBe('paused');
    expect(session.act('next')).toBe(false); // D36: not an open interval → no-op, no sync
    expect(session.act('toggle')).toBe(true);
    expect(syncs).toEqual(['start', 'jump', 'extend', 'pause', 'resume']);
    expect(session.state.skipped).toBe(1);
    expect(session.state.pauses).toBe(1);
  });

  it('End writes a history row (ended early) and clears the recovery record', async () => {
    const { db, timerId, session, syncs, finished, clock, flush } = await setup();
    session.begin();
    clock.advance(12_000);
    session.act('end');
    await flush();
    await flush();
    expect(syncs).toEqual(['start', 'end']);
    const [row] = await listSessions(db);
    expect(row).toMatchObject({ timerId, timerName: 'Tabata', completed: false, actualS: 12, plannedS: 65, pauses: 0, skippedIntervals: 0, interrupted: false });
    expect(finished).toEqual([row.id]);
    expect(await getSetting(db, 'recovery')).toBeNull();
    expect(session.act('toggle')).toBe(false);
  });

  it('the natural end is settled by the tick: completed row, driver synced with end once', async () => {
    const { db, session, syncs, finished, clock, flush } = await setup();
    session.begin();
    clock.advance(70_000);
    session.tick();
    session.tick();
    await flush();
    await flush();
    expect(syncs).toEqual(['start', 'end']);
    const [row] = await listSessions(db);
    expect(row).toMatchObject({ completed: true, actualS: 65 });
    expect(finished).toHaveLength(1);
  });

  it('native runner actions: pause/resume follow without a sync, Skip syncs a jump, End records, finished settles', async () => {
    const { db, session, syncs, clock, flush } = await setup(true);
    session.begin();
    clock.advance(1000);
    session.onRunnerAction({ action: 'pause', elapsedMs: 1000 });
    expect(session.state.status).toBe('paused');
    session.onRunnerAction({ action: 'resume', elapsedMs: 1000 });
    expect(session.state.status).toBe('running');
    session.onRunnerAction({ action: 'skip', elapsedMs: 1000 });
    expect(syncs).toEqual(['start', 'jump']);
    clock.advance(3000);
    session.onRunnerAction({ action: 'end', elapsedMs: 4000 });
    await flush();
    await flush();
    expect(syncs).toEqual(['start', 'jump']); // the runner stopped itself; no second end
    expect((await listSessions(db))[0]).toMatchObject({ completed: false, skippedIntervals: 1 });
  });

  it('iOS (JS driver): an audio interruption pauses the engine AND the scheduler', async () => {
    const { session, syncs } = await setup(false);
    session.begin();
    session.onRunnerAction({ action: 'pause', elapsedMs: 0 });
    expect(syncs).toEqual(['start', 'pause']);
  });

  it('a swipe-away (taskRemoved) keeps the recovery record and offers Resume at the right elapsed (A8)', async () => {
    const { db, session, clock, flush, now } = await setup(true);
    session.begin();
    clock.advance(9000);
    session.act('skip'); // a transition 9 s in rewrites the record
    session.onRunnerAction({ action: 'taskRemoved', elapsedMs: 9000 });
    await flush();
    expect(session.isDetached).toBe(true);
    const record = parseRecovery(await getSetting(db, 'recovery'));
    expect(record).not.toBeNull();
    // 30 s later (process dead): Resume is offered at the engine's position at the swipe + 30 s of wall time
    const outcome = evaluateRecovery(record!, now().wall + 30_000);
    expect(outcome.status).toBe('resume');
    if (outcome.status === 'resume') expect(outcome.elapsedMs).toBe(session.view().elapsedMs + 30_000);
    expect(await listSessions(db)).toHaveLength(0);
  });

  it('a recovered PAUSED run waits; the first Resume starts the driver', async () => {
    const first = await setup(true);
    first.session.begin();
    first.clock.advance(8000);
    first.session.act('pause');
    await first.flush();
    const record = parseRecovery(await getSetting(first.db, 'recovery'))!;
    const outcome = evaluateRecovery(record, first.now().wall + 60_000);
    expect(outcome).toEqual({ status: 'resume', elapsedMs: 8000, paused: true });
    const restored = restoreRunner(record, outcome as Extract<typeof outcome, { status: 'resume' }>, 5000);
    const second = await setup(true, restored);
    second.session.begin();
    expect(second.syncs).toEqual([]);
    second.session.act('toggle');
    expect(second.syncs).toEqual(['start']);
    expect(second.session.state.status).toBe('running');
  });

  it('native driver: a voice cue without a rendered clip is handed to the live-speech fallback by the tick (D15)', async () => {
    const { session, missing, clock } = await setup(true);
    session.begin();
    clock.advance(2100); // countdown "3" of the 5 s prep is at 2000 ms
    session.tick();
    expect(missing).toEqual(['3']);
    session.setOutput({ sound: false, vibrate: true });
    clock.advance(1000);
    session.tick();
    expect(missing).toEqual(['3']); // muted: nothing spoken
  });

  it('a timer deleted during the run: the history row keeps the name without the id (SPEC §9)', async () => {
    const { db, session, flush } = await setup(true, undefined, false);
    session.begin();
    session.act('end');
    for (let i = 0; i < 4; i++) await flush();
    expect((await listSessions(db))[0]).toMatchObject({ timerId: null, timerName: 'Tabata' });
  });

  it('quick toggles reach the driver', async () => {
    const { session, outputs } = await setup(true);
    session.begin();
    session.setOutput({ sound: false, vibrate: false });
    expect(outputs).toEqual([{ sound: false, vibrate: false }]);
  });
});
