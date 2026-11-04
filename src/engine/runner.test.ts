import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { addTime, apply, back, elapsedAt, end, idle, next, pause, resume, settle, skip, start, startAt, toggle, view, type RunnerAction } from './runner';
import { buildTimeline } from './schedule';

const opts = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
const tabata: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 10 },
};
const T0 = 1_000_000; // an arbitrary monotonic clock origin

describe('runner state machine (SPEC §5.2)', () => {
  it('start/pause/resume: elapsed freezes while paused; pauses are counted', () => {
    const t = buildTimeline(tabata, opts);
    let s = start(idle(t), T0);
    expect(s).toMatchObject({ status: 'running', baseMs: T0, segmentIndex: 0, pauses: 0 });
    expect(elapsedAt(s, T0 + 12_345)).toBe(12_345);
    s = pause(s, T0 + 15_000);
    expect(s).toMatchObject({ status: 'paused', elapsedMs: 15_000, pausedAtMs: T0 + 15_000, pauses: 1, segmentIndex: 1 });
    expect(elapsedAt(s, T0 + 99_000)).toBe(15_000);
    s = resume(s, T0 + 65_000);
    expect(s).toMatchObject({ status: 'running', baseMs: T0 + 50_000 });
    expect(elapsedAt(s, T0 + 70_000)).toBe(20_000);
    expect(pause(pause(s, T0 + 70_000), T0 + 71_000).pauses).toBe(2); // pausing a paused state is a no-op
    expect(resume(s, T0 + 70_000)).toBe(s);
    expect(toggle(s, T0 + 70_000).status).toBe('paused');
  });

  it('skip jumps to the next segment start and counts a skipped interval; the last one ends the run', () => {
    const t = buildTimeline(tabata, opts);
    let s = skip(start(idle(t), T0), T0 + 4_000);
    expect(elapsedAt(s, T0 + 4_000)).toBe(10_000);
    expect(s).toMatchObject({ segmentIndex: 1, skipped: 1, status: 'running' });
    s = skip(s, T0 + 4_000);
    expect(elapsedAt(s, T0 + 4_000)).toBe(30_000);
    const paused = skip(pause(s, T0 + 5_000), T0 + 6_000);
    expect(paused).toMatchObject({ status: 'paused', elapsedMs: 40_000, skipped: 3 });
    let late = startAt(t, T0, 245_000);
    late = skip(late, T0 + 1_000);
    expect(late).toMatchObject({ status: 'ended', elapsedMs: 250_000, endedBy: 'finished', skipped: 1 });
  });

  it('back restarts the current segment, or the previous one when less than 2 s in', () => {
    const t = buildTimeline(tabata, opts);
    const s = start(idle(t), T0);
    expect(elapsedAt(back(s, T0 + 25_000), T0 + 25_000)).toBe(10_000); // 15 s into Work → restart Work
    expect(elapsedAt(back(s, T0 + 11_500), T0 + 11_500)).toBe(0); // 1.5 s into Work → previous (prep)
    expect(elapsedAt(back(s, T0 + 1_000), T0 + 1_000)).toBe(0); // 1 s into prep, nothing before → restart prep
    expect(elapsedAt(back(s, T0 + 12_000), T0 + 12_000)).toBe(10_000); // exactly 2 s → restart current
  });

  it('+30 s extends the current segment and keeps later cues at nominal relative to the new timeline', () => {
    const t = buildTimeline(tabata, opts);
    const s = addTime(start(idle(t), T0), T0 + 15_000);
    expect(s.addedMs).toBe(30_000);
    expect(s.timeline.totalMs).toBe(280_000);
    expect(s.timeline.segments[1]).toMatchObject({ startMs: 10_000, endMs: 60_000 });
    expect(s.events).toEqual([{ kind: 'extend', index: 1, deltaMs: 30_000 }]);
    expect(elapsedAt(s, T0 + 15_000)).toBe(15_000); // elapsed itself does not move
    expect(view(s, T0 + 15_000).location?.remainingMs).toBe(45_000);
    const twice = addTime(s, T0 + 16_000);
    expect(twice.timeline.totalMs).toBe(310_000);
    expect(addTime(end(s, T0 + 20_000), T0 + 21_000).addedMs).toBe(30_000); // ended: no-op
  });

  it('end by the user records elapsed and endedBy; a natural end settles to the total', () => {
    const t = buildTimeline(tabata, opts);
    const s = start(idle(t), T0);
    expect(end(s, T0 + 100_500)).toMatchObject({ status: 'ended', elapsedMs: 100_500, endedBy: 'user' });
    expect(settle(s, T0 + 100_000)).toBe(s);
    expect(settle(s, T0 + 250_000)).toMatchObject({ status: 'ended', elapsedMs: 250_000, endedBy: 'finished' });
    expect(settle(s, T0 + 999_999)).toMatchObject({ status: 'ended', elapsedMs: 250_000, endedBy: 'finished' });
    expect(end(s, T0 + 999_999)).toMatchObject({ status: 'ended', elapsedMs: 250_000, endedBy: 'finished' });
    expect(end(end(s, T0 + 5), T0 + 6).elapsedMs).toBe(5);
    expect(pause(s, T0 + 300_000).status).toBe('ended');
  });

  it('open intervals: next closes the interval at the current elapsed and continues; the view has no total', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('Work', 20, 'work'), interval('Plank', 60, 'open'), interval('Rest', 10, 'rest')])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    let s = start(idle(buildTimeline(def, opts)), T0);
    expect(view(s, T0 + 5_000).progress).toBeNull();
    s = next(s, T0 + 20_000 + 33_000); // 33 s into the open interval
    expect(s.events).toEqual([{ kind: 'next', atElapsedMs: 53_000 }]);
    expect(s.timeline.totalMs).toBe(63_000);
    expect(s.timeline.segments.map((x) => [x.label, x.startMs, x.endMs])).toEqual([
      ['Work', 0, 20_000],
      ['Plank', 20_000, 53_000],
      ['Rest', 53_000, 63_000],
    ]);
    expect(elapsedAt(s, T0 + 53_000)).toBe(53_000);
    expect(s.segmentIndex).toBe(2);
    expect(s.skipped).toBe(0);
    expect(view(s, T0 + 58_000)).toMatchObject({ progress: 58 / 63, nextSegment: null, nextLogical: null });
    const beforeNext = start(idle(buildTimeline(def, opts)), T0);
    expect(view(beforeNext, T0 + 25_000)).toMatchObject({ nextSegment: null, nextLogical: expect.objectContaining({ label: 'Rest' }) });
    expect(view(beforeNext, T0 + 5_000).nextLogical).toMatchObject({ label: 'Plank' });
    expect(view(s, T0 + 58_000).location?.remainingMs).toBe(5_000);
    // Skip inside an open interval means Next too
    const again = skip(start(idle(buildTimeline(def, opts)), T0), T0 + 25_000);
    expect(again.timeline.segments[1].endMs).toBe(25_000);
    expect(again.skipped).toBe(0);
    // next outside an open interval does nothing (D36): same state object, no event, no jump, no skip
    const running = start(idle(buildTimeline(def, opts)), T0);
    const ignored = next(running, T0 + 5_000);
    expect(ignored).toBe(running);
    expect(elapsedAt(ignored, T0 + 5_000)).toBe(5_000);
    expect(ignored).toMatchObject({ skipped: 0, events: [] });
    const paused = pause(running, T0 + 6_000);
    expect(next(paused, T0 + 7_000)).toBe(paused);
    expect(apply(running, 'next', T0 + 5_000)).toBe(running);
  });

  it('startAt resumes at a known elapsed (recovery), paused or running, or ended when past the total', () => {
    const t = buildTimeline(tabata, opts);
    expect(startAt(t, T0, 123_456, { pauses: 2, skipped: 1 }, true)).toMatchObject({ status: 'paused', elapsedMs: 123_456, pauses: 2, skipped: 1, segmentIndex: 8 });
    expect(elapsedAt(startAt(t, T0, 123_456), T0 + 1_000)).toBe(124_456);
    expect(startAt(t, T0, 250_000)).toMatchObject({ status: 'ended', endedBy: 'finished' });
  });

  it('the view reports segment, remaining, progress and the next segment', () => {
    const s = start(idle(buildTimeline(tabata, opts)), T0);
    const v = view(s, T0 + 25_000);
    expect(v.location).toMatchObject({ index: 1, remainingMs: 5_000 });
    expect(v.progress).toBeCloseTo(0.1, 6);
    expect(v.nextSegment?.label).toBe('Rest');
    expect(view(s, T0 + 249_000).nextSegment).toBeNull();
  });
});

// D33 (after blind set B1 rn-09/rn-10/rn-15): these rules live in the engine so the app layer (P5: screen buttons,
// notification actions, the tick loop) cannot get them wrong. B1 passed them only through adapter choices.
describe('engine-owned runner rules (D33)', () => {
  const t = buildTimeline(tabata, opts); // 250 s

  it('start is a transition on a state and only leaves idle; on running/paused/ended it is a no-op', () => {
    const s0 = idle(t);
    const s = start(s0, T0);
    expect(s).toMatchObject({ status: 'running', elapsedMs: 0, baseMs: T0 });
    expect(start(s, T0 + 1_000)).toBe(s);
    const p = pause(s, T0 + 2_000);
    expect(start(p, T0 + 3_000)).toBe(p);
    const e = end(p, T0 + 4_000);
    expect(start(e, T0 + 5_000)).toBe(e);
  });

  it('reads settle first: past the total a running state reads as ended at the total, without a settle call', () => {
    const s = start(idle(t), T0);
    expect(elapsedAt(s, T0 + 300_000)).toBe(250_000);
    const v = view(s, T0 + 300_000);
    expect(v).toMatchObject({ status: 'ended', elapsedMs: 250_000, progress: 1, nextLogical: null });
    expect(v.location).toMatchObject({ ended: true, remainingMs: 0 });
    expect(view(s, T0 + 100_000).status).toBe('running');
  });

  it('every transition settles first: nothing revives a run that ended naturally', () => {
    const s = start(idle(t), T0);
    const late = T0 + 260_000;
    for (const op of [back, skip, next, addTime, pause, resume, toggle, end] as const) {
      const r = op(s, late);
      expect(r).toMatchObject({ status: 'ended', elapsedMs: 250_000, endedBy: 'finished' });
      expect(r.timeline.totalMs).toBe(250_000);
    }
  });

  it('apply(state, action, now) is the one entry point for the UI, notification and headset actions', () => {
    const script: [RunnerAction, number][] = [['start', 0], ['start', 1_000], ['pause', 2_000], ['pause', 3_000], ['resume', 4_000], ['resume', 5_000], ['skip', 6_000], ['addTime', 7_000], ['back', 8_000], ['toggle', 9_000], ['toggle', 10_000], ['end', 11_000], ['start', 12_000]];
    let a = idle(t);
    let b = idle(t);
    for (const [action, at] of script) {
      a = apply(a, action, T0 + at);
      b = action === 'start' ? start(b, T0 + at) : { pause, resume, toggle, skip, back, addTime, next, end }[action](b, T0 + at);
    }
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 'ended', endedBy: 'user', pauses: 2 });
    expect(apply(idle(t), 'pause', T0)).toMatchObject({ status: 'idle' });
  });
});
