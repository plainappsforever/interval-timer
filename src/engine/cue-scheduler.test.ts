import { FakeClock, seeded } from '../../test/harness/fake-clock';
import { createCueScheduler, EARLY_TOLERANCE_MS } from './cue-scheduler';
import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { addTime, back, elapsedAt, idle, pause, resume, settle, skip, start, type RunnerState } from './runner';
import { buildTimeline, type Cue } from './schedule';

const opts = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
/** 60 minutes: 40 rounds of 60/30 → 120 segments, > 300 cues. */
const hour: TimerDef = {
  name: 'Hour',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 60, 'work', { halfwayCue: true }), interval('Rest', 30, 'rest')], { rounds: 40 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 0 },
};

type Fired = { cue: Cue; atMs: number; delta: number };

function run(clock: FakeClock, until: number, script: (s: RunnerState, sync: (s: RunnerState) => void) => void = () => {}) {
  const fired: Fired[] = [];
  const timeline = buildTimeline(hour, opts);
  let state = start(idle(timeline), clock.now());
  const scheduler = createCueScheduler(clock, (cue, elapsed) => fired.push({ cue, atMs: elapsed, delta: elapsed - cue.atMs }));
  scheduler.sync(state);
  script(state, (s) => {
    state = s;
    scheduler.sync(s);
  });
  clock.advanceTo(until);
  return { fired, timeline, state: () => state, scheduler };
}

describe('cue scheduler drift (A2)', () => {
  it('a 60-minute timeline with > 300 cues and timers 120 ms late: every cue within 50 ms, cumulative drift 0', () => {
    const clock = new FakeClock(120);
    const { fired, timeline, scheduler } = run(clock, 3_700_000);
    expect(timeline.totalMs).toBe(3_600_000);
    expect(timeline.cues.length).toBeGreaterThanOrEqual(300);
    expect(fired).toHaveLength(timeline.cues.length);
    expect(fired.map((f) => f.cue.atMs)).toEqual(timeline.cues.map((c) => c.atMs)); // every cue once, in order
    const deltas = fired.map((f) => f.delta);
    const worst = Math.max(...deltas.map(Math.abs));
    expect(worst).toBeLessThanOrEqual(50);
    expect(deltas.slice(5).every((d) => Math.abs(d) <= EARLY_TOLERANCE_MS)).toBe(true); // after the lead settles
    expect(fired[fired.length - 1].delta - fired[0].delta).toBeLessThanOrEqual(0 + EARLY_TOLERANCE_MS); // no accumulation
    expect(fired[fired.length - 1].atMs).toBe(3_600_000 + fired[fired.length - 1].delta);
    expect(scheduler.lead()).toBeGreaterThan(100);
  });

  it('with jittery lateness (0–240 ms) nothing is skipped or duplicated and no cue is more than 250 ms late', () => {
    const rnd = seeded(42);
    const clock = new FakeClock(0, () => Math.floor(rnd() * 240));
    const { fired, timeline } = run(clock, 3_700_000);
    expect(fired.map((f) => f.cue.atMs)).toEqual(timeline.cues.map((c) => c.atMs));
    expect(Math.max(...fired.map((f) => f.delta))).toBeLessThanOrEqual(250);
    expect(Math.min(...fired.map((f) => f.delta))).toBeGreaterThanOrEqual(-EARLY_TOLERANCE_MS);
  });

  it('pause/resume/skip/back/+30 s keep every later cue at nominal relative to the new base', () => {
    const clock = new FakeClock(120);
    const { fired, state } = run(clock, 3_800_000, (s0, sync) => {
      let s = s0;
      // pause at 45 s for 20 s
      clock.advanceTo(45_000);
      s = pause(s, clock.now());
      sync(s);
      clock.advanceTo(65_000);
      s = resume(s, clock.now());
      sync(s);
      // skip at 100 s (elapsed 80 s: inside Rest 60-90 → jump to 90)
      clock.advanceTo(100_000);
      s = skip(s, clock.now());
      sync(s);
      // back at 200 s (elapsed 190 s = 10 s into Work 180-240 → restart at 180)
      clock.advanceTo(200_000);
      s = back(s, clock.now());
      sync(s);
      // +30 s at 300 s (elapsed 280 s: in Work 270-330 → ends 360)
      clock.advanceTo(300_000);
      s = addTime(s, clock.now());
      sync(s);
    });
    const final = state();
    // every fired cue sits at base + atMs on the clock, within the tolerance (no cue inherits an older base)
    for (const f of fired.slice(10)) expect(Math.abs(f.delta)).toBeLessThanOrEqual(EARLY_TOLERANCE_MS);
    expect(final.status).toBe('running');
    expect(elapsedAt(final, clock.now())).toBeGreaterThanOrEqual(final.timeline.totalMs!);
    // cues around the pause: the 45 s halfway... (Work 0-60: halfway at 30 s, countdown 57/58/59) fired once each
    const times = fired.map((f) => f.cue.atMs);
    // nothing plays twice, except the round+start pair at 180 s that Back legitimately replayed
    const keys = fired.map((f) => `${f.cue.atMs}:${f.cue.kind}`);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dup).toEqual(['180000:round', '180000:start']);
    expect(times).toContain(30_000);
    expect(times).toContain(57_000);
    // after skip at elapsed 80 s nothing from 80-90 s (Rest countdown 87/88/89) was played late, but 90 s Work fired
    expect(times).not.toContain(87_000);
    expect(times).toContain(90_000);
    // back at elapsed 190 s: 180 s start fired twice? No: a jump never replays — the start at 180 s fired at the jump only if due later
    expect(fired.filter((f) => f.cue.atMs === 180_000 && f.cue.kind === 'start')).toHaveLength(2); // Back replays the segment start
    expect(fired.filter((f) => f.cue.atMs === 210_000)).toHaveLength(1); // halfway of Work 180-240 after the restart (not before: elapsed was 190)
    // +30 s: the extended segment's countdown moved to 357/358/359 s
    expect(times).toContain(357_000);
    expect(times).not.toContain(327_000);
    expect(fired[fired.length - 1].cue.kind).toBe('end');
    expect(fired[fired.length - 1].atMs).toBeGreaterThanOrEqual(final.timeline.totalMs!);
  });

  it('the end cue still plays when the UI settles the run before the end timer fires (REVIEW M2)', () => {
    const clock = new FakeClock(500); // very late timers
    const fired: Fired[] = [];
    let ended = 0;
    const timeline = buildTimeline({ ...hour, blocks: [block([interval('Work', 20, 'work')])] }, opts);
    const scheduler = createCueScheduler(clock, (cue, elapsed) => fired.push({ cue, atMs: elapsed, delta: elapsed - cue.atMs }), () => ended++);
    const s = start(idle(timeline), 0);
    scheduler.sync(s);
    clock.advanceTo(19_990);
    (clock as unknown as { t: number }).t = 20_000; // the UI's tick sees elapsed ≥ total first
    const done = settle(s, clock.now());
    expect(done.status).toBe('ended');
    scheduler.sync(done);
    expect(fired.map((f) => `${f.cue.atMs} ${f.cue.kind}`).slice(-2)).toEqual(['19000 countdown', '20000 end']);
    expect(ended).toBe(1);
    clock.advanceTo(30_000);
    expect(fired.filter((f) => f.cue.kind === 'end')).toHaveLength(1); // the stale timer does not fire it again
    expect(ended).toBe(1);
  });

  it('a cue that just played is not replayed by a pause/resume or a skip right after it (REVIEW M3); Back does replay', () => {
    const clock = new FakeClock(0);
    const fired: Fired[] = [];
    const timeline = buildTimeline(hour, opts);
    const scheduler = createCueScheduler(clock, (cue, elapsed) => fired.push({ cue, atMs: elapsed, delta: elapsed - cue.atMs }));
    let s = start(idle(timeline), 0);
    scheduler.sync(s);
    clock.advanceTo(30_010); // halfway at 30 s fired 10 ms ago
    s = pause(s, clock.now());
    scheduler.sync(s);
    clock.advanceTo(40_000);
    s = resume(s, clock.now());
    scheduler.sync(s);
    clock.advanceTo(40_005);
    expect(fired.filter((f) => f.cue.atMs === 30_000)).toHaveLength(1);
    clock.advanceTo(70_010); // Rest started at 60 s (elapsed 60.01 s)
    s = skip(s, clock.now()); // elapsed 60 010 → jump to 90 000
    scheduler.sync(s);
    expect(fired.filter((f) => f.cue.atMs === 60_000 && f.cue.kind === 'start')).toHaveLength(1);
    expect(fired.filter((f) => f.cue.atMs === 90_000).map((f) => f.cue.kind)).toEqual(['round', 'start']);
    clock.advanceTo(clock.now() + 10);
    s = back(s, clock.now()); // 10 ms into Work 90-150 → previous segment (Rest 60-90) restarts
    scheduler.sync(s);
    expect(fired.filter((f) => f.cue.atMs === 60_000 && f.cue.kind === 'start')).toHaveLength(2);
  });

  it('a long stall catches up without a burst: only the latest cue of the current segment plays', () => {
    const clock = new FakeClock(0);
    const fired: Fired[] = [];
    const timeline = buildTimeline(hour, opts);
    const scheduler = createCueScheduler(clock, (cue, elapsed) => fired.push({ cue, atMs: elapsed, delta: elapsed - cue.atMs }));
    const s = start(idle(timeline), 0);
    scheduler.sync(s);
    clock.advanceTo(10_000);
    // simulate a 2-minute freeze: jump the clock without firing timers in between
    (clock as unknown as { t: number }).t = 130_000;
    clock.advanceTo(130_000);
    const kinds = fired.filter((f) => f.atMs >= 130_000).map((f) => `${f.cue.atMs} ${f.cue.kind}`);
    expect(kinds).toEqual(['120000 halfway']); // Work 90-150: halfway at 120 s is the latest due cue; 57/58/59/60/87/88/89/90 are dropped
    clock.advanceTo(160_000);
    expect(fired.map((f) => f.cue.atMs).slice(-4)).toEqual([147_000, 148_000, 149_000, 150_000]);
  });
});
