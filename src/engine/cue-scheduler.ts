// JS cue scheduler (A2, D13): arms one timer for the next cue at `base + cue.atMs` and fires through `cuesBetween`, so a
// late timer never bursts and nothing accumulates. The lead compensates the platform's typical timer lateness: a timer
// that fires L ms late is armed L ms early (EMA of observed lateness), and a cue is emitted once `elapsed ≥ atMs −
// EARLY_TOLERANCE`. Pure of React Native: the clock and timer functions are injected (fake ones in tests).
import { elapsedAt, type RunnerState } from './runner';
import { cuesBetween, nextCueAfter, type Cue } from './schedule';

export type SchedulerClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export const EARLY_TOLERANCE_MS = 25;
const MAX_LEAD_MS = 500;
const LEAD_ALPHA = 0.5;

export type CueScheduler = {
  /** Call after every runner transition (start/pause/resume/skip/back/+30 s/next/end). */
  sync: (state: RunnerState) => void;
  stop: () => void;
  /** Current lead in ms (observed lateness estimate). */
  lead: () => number;
};

/**
 * `emit` receives each cue once, with the elapsed time at which it fired. `onEnd` fires when the timeline's end is
 * reached (the end cue has been emitted).
 */
export function createCueScheduler(clock: SchedulerClock, emit: (cue: Cue, firedAtElapsedMs: number) => void, onEnd?: () => void): CueScheduler {
  let state: RunnerState | null = null;
  let handle: unknown = null;
  let lastFiredMs = -1;
  let lead = 0;
  let samples = 0;

  const clear = () => {
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  };

  function arm() {
    clear();
    if (!state || state.status !== 'running') return;
    const now = clock.now();
    const elapsed = elapsedAt(state, now);
    const cue = nextCueAfter(state.timeline, Math.max(lastFiredMs, elapsed - EARLY_TOLERANCE_MS));
    if (!cue) return;
    if (cue.atMs <= elapsed + EARLY_TOLERANCE_MS) {
      fire(cue.atMs, null); // already due (e.g. the start cue at 0): no timer, no lateness
      return;
    }
    armFor(cue.atMs, Math.max(0, cue.atMs - elapsed - lead));
  }

  /** One sample of the platform's timer lateness: the first sets the lead, later ones move it (EMA). */
  function observe(observedLate: number) {
    samples++;
    lead = Math.min(MAX_LEAD_MS, samples === 1 ? observedLate : lead + LEAD_ALPHA * (observedLate - lead));
  }

  /** A zero-delay probe at start measures the platform's lateness before the first armed cue. */
  function probe() {
    const dueMs = clock.now();
    clock.setTimeout(() => {
      if (samples !== 0) return;
      observe(Math.max(0, clock.now() - dueMs));
      arm(); // re-arm the pending cue with the measured lead
    }, 0);
  }

  /** Arms the timer for `delay` ms and remembers when it was due, to measure the platform's real lateness. */
  function armFor(target: number, delay: number) {
    const dueMs = clock.now() + delay;
    handle = clock.setTimeout(() => {
      handle = null;
      fire(target, dueMs);
    }, delay);
  }

  function fire(armedForMs: number, dueMs: number | null) {
    if (!state || state.status !== 'running') return;
    const now = clock.now();
    const elapsed = elapsedAt(state, now);
    // The timer's own lateness (independent of the lead) feeds the lead estimate.
    if (dueMs !== null) observe(Math.max(0, now - dueMs));
    if (elapsed + EARLY_TOLERANCE_MS < armedForMs) {
      // Woke early (the lead overshot): wait the exact remainder without a lead, so a punctual platform never spins.
      clear();
      armFor(armedForMs, armedForMs - elapsed);
      return;
    }
    const to = Math.max(elapsed, armedForMs);
    const due = cuesBetween(state.timeline, lastFiredMs, to);
    for (const c of due) emit(c, elapsed);
    lastFiredMs = to;
    const total = state.timeline.totalMs;
    if (total !== null && to >= total) {
      onEnd?.();
      return;
    }
    arm();
  }

  return {
    sync(next) {
      const now = clock.now();
      const elapsed = elapsedAt(next, now);
      // Only a backward move of elapsed (Back, or a new run) resets the fired mark, so the restarted segment's cues
      // play again. Pause/resume, +30 s and Next leave elapsed in place and Skip moves it forward: the mark stays, so a
      // cue that just played is never played again and a forward jump plays only the new segment's start (REVIEW M3).
      const prevElapsed = state ? elapsedAt(state, now) : Number.POSITIVE_INFINITY;
      const jumped = !state || elapsed < prevElapsed;
      const wasRunning = state?.status === 'running';
      state = next;
      if (jumped) lastFiredMs = elapsed - EARLY_TOLERANCE_MS - 1;
      if (next.status === 'ended' && next.endedBy === 'finished' && next.timeline.totalMs !== null && lastFiredMs < next.timeline.totalMs) {
        // The run was settled by the UI before the end timer fired: the end cue must still play (REVIEW M2).
        const total = next.timeline.totalMs;
        for (const c of cuesBetween(next.timeline, lastFiredMs, total)) emit(c, elapsed);
        lastFiredMs = total;
        clear();
        onEnd?.();
        return;
      }
      if (next.status === 'running' && !wasRunning && samples === 0) probe();
      arm();
    },
    stop() {
      clear();
      state = null;
    },
    lead: () => lead,
  };
}
