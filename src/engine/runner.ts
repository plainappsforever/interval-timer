// Runner state machine (SPEC §5.2, D13). Pure: every transition takes `now` (a monotonic clock in ms) and returns a
// new state. Elapsed time is `now - baseMs` while running and frozen at `elapsedMs` while paused, so cues stay at
// `baseMs + cue.atMs` and nothing accumulates drift. Open intervals end with `next`, which rebases the timeline.
// Engine-owned rules (D33) so no caller can get them wrong: `start` only leaves idle; every read (`elapsedAt`, `view`)
// and every transition applies the natural end first (a run past `totalMs` IS ended, whether or not a tick loop called
// `settle`); transitions that do not fit the current state return the same object. `apply` is the single entry point
// for screen buttons, notification and headset actions.
import { extendSegment, locate, rebase, type Location, type LogicalSegment, type Timeline } from './schedule';

export type RunnerStatus = 'idle' | 'running' | 'paused' | 'ended';

/** An event that changed the timeline after Start; replayed by recovery to rebuild the same timeline. */
export type TimelineEvent = { kind: 'next'; atElapsedMs: number } | { kind: 'extend'; index: number; deltaMs: number };

export type RunnerState = {
  status: RunnerStatus;
  timeline: Timeline;
  /** Monotonic clock value at elapsed 0 (while running). */
  baseMs: number | null;
  /** Elapsed at the last transition; authoritative while paused or ended. */
  elapsedMs: number;
  /** Monotonic clock when paused (null otherwise). */
  pausedAtMs: number | null;
  segmentIndex: number;
  pauses: number;
  /** Intervals left early with Skip (SPEC §2: recorded as skipped). */
  skipped: number;
  addedMs: number;
  events: TimelineEvent[];
  /** Why the run ended: finished naturally, or the user tapped End. */
  endedBy: 'finished' | 'user' | null;
};

export const BACK_RESTART_THRESHOLD_MS = 2000;
export const ADD_TIME_MS = 30_000;

export function idle(timeline: Timeline): RunnerState {
  return { status: 'idle', timeline, baseMs: null, elapsedMs: 0, pausedAtMs: null, segmentIndex: 0, pauses: 0, skipped: 0, addedMs: 0, events: [], endedBy: null };
}

/** Elapsed timeline time at `now`; never beyond the total (a running state past the end reads as ended, D33). */
export function elapsedAt(s: RunnerState, now: number): number {
  if (s.status === 'running' && s.baseMs !== null) {
    const e = Math.max(0, now - s.baseMs);
    return s.timeline.totalMs !== null ? Math.min(e, s.timeline.totalMs) : e;
  }
  return s.elapsedMs;
}

function withElapsed(s: RunnerState, now: number, elapsedMs: number, status: RunnerStatus = 'running'): RunnerState {
  const loc = locate(s.timeline, elapsedMs);
  return { ...s, status, baseMs: status === 'running' ? now - elapsedMs : null, elapsedMs, pausedAtMs: status === 'paused' ? now : null, segmentIndex: loc?.index ?? 0 };
}

/** Start a run from `idle(timeline)`; on any other state a no-op (a second Start never restarts a run, D33). */
export function start(s: RunnerState, now: number): RunnerState {
  if (s.status !== 'idle') return s;
  return withElapsed(idle(s.timeline), now, 0);
}

/** Resumes a recovered run at a known elapsed time (A8). */
export function startAt(timeline: Timeline, now: number, elapsedMs: number, carry: Partial<Pick<RunnerState, 'pauses' | 'skipped' | 'addedMs' | 'events'>> = {}, paused = false): RunnerState {
  const s = { ...idle(timeline), ...carry };
  const ended = finishedAt(s, elapsedMs);
  if (ended) return { ...withElapsed(s, now, elapsedMs, 'ended'), endedBy: 'finished' };
  return withElapsed(s, now, elapsedMs, paused ? 'paused' : 'running');
}

function finishedAt(s: RunnerState, elapsedMs: number): boolean {
  return s.timeline.totalMs !== null && elapsedMs >= s.timeline.totalMs;
}

/**
 * Applies the natural end: a running state at or past `totalMs` becomes ended. Every transition and `view` call it
 * first; the tick loop calls it to persist the end (recovery record, Done screen).
 */
export function settle(s: RunnerState, now: number): RunnerState {
  if (s.status !== 'running') return s;
  const e = elapsedAt(s, now);
  if (!finishedAt(s, e)) return s;
  return { ...withElapsed(s, now, s.timeline.totalMs!, 'ended'), endedBy: 'finished' };
}

export function pause(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'running') return s;
  return { ...withElapsed(s, now, elapsedAt(s, now), 'paused'), pauses: s.pauses + 1 };
}

export function resume(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'paused') return s;
  return withElapsed(s, now, s.elapsedMs, 'running');
}

export function toggle(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  return s.status === 'paused' ? resume(s, now) : pause(s, now);
}

function jumpTo(s: RunnerState, now: number, elapsedMs: number): RunnerState {
  const status = s.status === 'paused' ? 'paused' : 'running';
  const t = withElapsed(s, now, elapsedMs, status);
  return finishedAt(t, elapsedMs) ? { ...withElapsed(s, now, s.timeline.totalMs!, 'ended'), endedBy: 'finished' } : t;
}

/** Jump to the next segment start; in the last segment: end. The left segment counts as skipped. */
export function skip(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'running' && s.status !== 'paused') return s;
  const e = elapsedAt(s, now);
  const loc = locate(s.timeline, e);
  if (!loc || loc.ended) return settle(s, now);
  const current = loc.segment;
  if (current.endMs === null) return next(s, now); // an open interval ends with Next; Skip means the same
  const nextSeg = s.timeline.segments[loc.index + 1];
  const target = nextSeg ? nextSeg.startMs : s.timeline.totalMs!;
  return { ...jumpTo(s, now, target), skipped: s.skipped + 1 };
}

/** Restart the current segment, or the previous one when less than 2 s into the current. */
export function back(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'running' && s.status !== 'paused') return s;
  const e = elapsedAt(s, now);
  const loc = locate(s.timeline, e);
  if (!loc) return s;
  const prev = s.timeline.segments[loc.index - 1];
  const target = loc.inSegmentMs < BACK_RESTART_THRESHOLD_MS && prev ? prev.startMs : loc.segment.startMs;
  return jumpTo(s, now, target);
}

/** +30 s on the current segment (no-op in an open interval or when not running/paused). */
export function addTime(s0: RunnerState, now: number, deltaMs = ADD_TIME_MS): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'running' && s.status !== 'paused') return s;
  const e = elapsedAt(s, now);
  const loc = locate(s.timeline, e);
  if (!loc || loc.ended || loc.segment.endMs === null) return s;
  const timeline = extendSegment(s.timeline, loc.index, deltaMs);
  if (timeline === s.timeline) return s;
  return { ...s, timeline, addedMs: s.addedMs + deltaMs, events: [...s.events, { kind: 'extend', index: loc.index, deltaMs }] };
}

/** Next inside an open interval: close it now and continue. Outside an open interval it does nothing (D36, SPEC
 *  §5.2): moving on from a timed segment is Skip's job, which counts the skip. */
export function next(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status !== 'running' && s.status !== 'paused') return s;
  const e = elapsedAt(s, now);
  const loc = locate(s.timeline, e);
  if (!loc || loc.ended) return settle(s, now);
  if (loc.segment.endMs !== null) return s;
  const timeline = rebase(s.timeline, e);
  const t: RunnerState = { ...s, timeline, events: [...s.events, { kind: 'next', atElapsedMs: e }] };
  return jumpTo(t, now, e);
}

/** The user ends the session. */
export function end(s0: RunnerState, now: number): RunnerState {
  const s = settle(s0, now);
  if (s.status === 'idle' || s.status === 'ended') return s;
  const e = elapsedAt(s, now);
  const finished = finishedAt(s, e);
  return { ...withElapsed(s, now, finished ? s.timeline.totalMs! : e, 'ended'), endedBy: finished ? 'finished' : 'user' };
}

export type RunnerView = {
  status: RunnerStatus;
  elapsedMs: number;
  location: Location | null;
  /** Elapsed / total for the progress bar, 0..1; null while the total is unknown (open interval ahead). */
  progress: number | null;
  nextSegment: import('./schedule').Segment | null;
  /** What comes after the current segment, incl. the first pending step after an open interval (REVIEW S3). */
  nextLogical: LogicalSegment | null;
};

/** What the running screen shows at `now` (natural end applied first: past the total it reads `ended`). */
export function view(s0: RunnerState, now: number): RunnerView {
  const s = settle(s0, now);
  const elapsedMs = elapsedAt(s, now);
  const location = locate(s.timeline, elapsedMs);
  const total = s.timeline.totalMs;
  return {
    status: s.status,
    elapsedMs,
    location,
    progress: total === null || total === 0 ? null : Math.min(1, elapsedMs / total),
    nextSegment: location ? (s.timeline.segments[location.index + 1] ?? null) : null,
    nextLogical: location && !location.ended ? (s.timeline.segments[location.index + 1] ?? s.timeline.pending[0] ?? null) : null,
  };
}

/** Every user-facing transition by name (screen buttons, notification `onAction`, headset). */
export type RunnerAction = 'start' | 'pause' | 'resume' | 'toggle' | 'skip' | 'back' | 'addTime' | 'next' | 'end';

const ACTIONS: Record<RunnerAction, (s: RunnerState, now: number) => RunnerState> = { start, pause, resume, toggle, skip, back, addTime: (s, now) => addTime(s, now), next, end };

/** The single entry point for the app layer: applies `action` at `now`; an action that does not fit the state is a no-op. */
export function apply(s: RunnerState, action: RunnerAction, now: number): RunnerState {
  return ACTIONS[action](s, now);
}

/** Replays timeline events (Next presses, +30 s) on a freshly built timeline, in order. */
export function replayEvents(timeline: Timeline, events: TimelineEvent[]): Timeline {
  let t = timeline;
  for (const ev of events) t = ev.kind === 'next' ? rebase(t, ev.atElapsedMs) : extendSegment(t, ev.index, ev.deltaMs);
  return t;
}
