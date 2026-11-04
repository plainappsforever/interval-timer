// Recovery record (D13, A8): written to `settings.recovery` on every transition; evaluated at launch. Pure (wall-clock
// `now` is passed in). The timeline is rebuilt from the saved timer and the replayed events, not stored.
import type { TimerDef } from './model';
import { elapsedAt, replayEvents, startAt, type RunnerState, type TimelineEvent } from './runner';
import { buildTimeline, type TimelineOptions } from './schedule';
import { plannedSeconds } from './validation';

export const RECOVERY_VERSION = 1;
/** A paused run left alone this long is saved as a partial session instead of offered again. */
export const MAX_PAUSED_MS = 24 * 60 * 60 * 1000;
/** A running open-ended timer older than this is not offered (its real end is unknown). */
export const MAX_OPEN_RUN_MS = 2 * 60 * 60 * 1000;

export type RecoveryRecord = {
  version: 1;
  timerId: number;
  timerName: string;
  /** The timer as it ran (its definition may change in the editor meanwhile). */
  def: TimerDef;
  options: TimelineOptions;
  /** Wall clock (Date.now) when the run started. */
  startedAtWall: number;
  /** Wall clock at which elapsed was 0 (moves on resume after a pause); null while paused. */
  baseWallMs: number | null;
  status: 'running' | 'paused';
  /** Elapsed at the time of writing (authoritative while paused). */
  elapsedMs: number;
  /** Wall clock when the record was written. */
  writtenAtWall: number;
  segmentIndex: number;
  pauses: number;
  skipped: number;
  addedMs: number;
  events: TimelineEvent[];
  /** The run already survived one interruption. */
  interrupted: boolean;
};

/** The record for a running or paused state; null when nothing needs recovery (idle/ended). */
export function recoveryRecord(s: RunnerState, meta: { timerId: number; timerName: string; def: TimerDef; startedAtWall: number; interrupted: boolean }, nowMono: number, nowWall: number): RecoveryRecord | null {
  if (s.status !== 'running' && s.status !== 'paused') return null;
  const elapsedMs = elapsedAt(s, nowMono);
  return {
    version: RECOVERY_VERSION,
    timerId: meta.timerId,
    timerName: meta.timerName,
    def: meta.def,
    options: s.timeline.options,
    startedAtWall: meta.startedAtWall,
    baseWallMs: s.status === 'running' ? nowWall - elapsedMs : null,
    status: s.status,
    elapsedMs,
    writtenAtWall: nowWall,
    segmentIndex: s.segmentIndex,
    pauses: s.pauses,
    skipped: s.skipped,
    addedMs: s.addedMs,
    events: s.events,
    interrupted: meta.interrupted,
  };
}

export type RecoveryOutcome =
  /** Offer "Resume at mm:ss?" — the state continues at this elapsed (paused until the user confirms). */
  | { status: 'resume'; elapsedMs: number; paused: boolean }
  /** The run ended while the app was away (or sat paused for a day): save a history row as it stands. */
  | { status: 'finished'; elapsedMs: number; completed: boolean }
  /** Nothing trustworthy: clear the record. */
  | { status: 'discard' };

const isRecord = (v: unknown): v is RecoveryRecord => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<RecoveryRecord>;
  return r.version === RECOVERY_VERSION && typeof r.timerId === 'number' && typeof r.def === 'object' && r.def !== null && typeof r.elapsedMs === 'number' && (r.status === 'running' || r.status === 'paused') && Array.isArray(r.events);
};

/** Parses what `settings.recovery` holds. */
export function parseRecovery(value: unknown): RecoveryRecord | null {
  return isRecord(value) ? value : null;
}

/** The timeline of a record, with its Next/+30 s events replayed. */
export function recoveredTimeline(record: RecoveryRecord) {
  return replayEvents(buildTimeline(record.def, record.options), record.events);
}

/**
 * Decides at launch. Running: elapsed = wall time since the base (cues missed meanwhile are not replayed); past the
 * end → finished (completed, "resumed after interruption" on the Done screen). Paused: resume at the paused elapsed;
 * after a day → finished as partial. Open-ended run older than 2 h → finished as partial.
 */
export function evaluateRecovery(record: RecoveryRecord, nowWall: number): RecoveryOutcome {
  const timeline = recoveredTimeline(record);
  const totalMs = timeline.totalMs;
  if (record.status === 'paused') {
    if (nowWall - record.writtenAtWall > MAX_PAUSED_MS) return { status: 'finished', elapsedMs: record.elapsedMs, completed: totalMs !== null && record.elapsedMs >= totalMs };
    return { status: 'resume', elapsedMs: record.elapsedMs, paused: true };
  }
  if (record.baseWallMs === null) return { status: 'discard' };
  const elapsedMs = Math.max(record.elapsedMs, nowWall - record.baseWallMs);
  if (totalMs !== null) {
    if (elapsedMs >= totalMs) return { status: 'finished', elapsedMs: totalMs, completed: true };
    return { status: 'resume', elapsedMs, paused: false };
  }
  if (elapsedMs > MAX_OPEN_RUN_MS) return { status: 'finished', elapsedMs: record.elapsedMs, completed: false };
  return { status: 'resume', elapsedMs, paused: false };
}

/** The runner state to continue from, for a 'resume' outcome (paused until the user confirms). */
export function restoreRunner(record: RecoveryRecord, outcome: Extract<RecoveryOutcome, { status: 'resume' }>, nowMono: number): RunnerState {
  return startAt(recoveredTimeline(record), nowMono, outcome.elapsedMs, { pauses: record.pauses, skipped: record.skipped, addedMs: record.addedMs, events: record.events }, true);
}

/** The history row for a run that ends (naturally, by End, or recovered as finished). */
export function sessionOf(def: TimerDef, s: Pick<RunnerState, 'pauses' | 'skipped' | 'addedMs' | 'timeline'>, elapsedMs: number, completed: boolean, startedAtWall: number, endedAtWall: number, interrupted: boolean) {
  const hasOpen = def.blocks.some((b) => b.intervals.some((iv) => iv.type === 'open'));
  return {
    timerName: def.name,
    startedAt: startedAtWall,
    endedAt: endedAtWall,
    plannedS: hasOpen ? null : plannedSeconds(def),
    actualS: Math.round(elapsedMs / 1000),
    completed,
    skippedIntervals: s.skipped,
    pauses: s.pauses,
    interrupted,
    note: '',
  };
}
