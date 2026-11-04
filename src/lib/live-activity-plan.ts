// What the iOS workout Live Activity shows (SPEC §7 screen 3, A14, D40). Pure: the running screen hands in the runner
// view and the wall clock; the glue (live-activity.ts) starts, updates or ends the activity. The clock in the activity
// is a system timer (`Text timerInterval`) counting down to the end of the current interval (up in an open interval),
// so there are no per-second updates; an update is needed only when the key changes (new segment, pause, resume,
// +30 s, Back, Skip).
import { formatElapsedMs, formatRemainingMs } from '@/engine/format';
import { textOn } from '@/engine/palette';
import type { RunnerView } from '@/engine/runner';

/** An open interval counts up inside a window this long (the activity has no "forever"). */
export const OPEN_WINDOW_MS = 8 * 3600_000;
/** A countdown whose end passed without an update is marked stale this long after its end (the app was killed). */
export const STALE_AFTER_MS = 60_000;

export type WorkoutActivityProps = {
  /** Timer name. */
  title: string;
  /** Current interval name ("Work", "Get ready"). */
  interval: string;
  /** "Round 3 of 8", or the paused label while paused, or ''. */
  detail: string;
  startAt: number;
  endAt: number;
  countsDown: boolean;
  paused: boolean;
  /** The frozen clock while paused. */
  pausedClock: string;
  /** Interval colour (activity background) and its readable text colour. */
  color: string;
  textColor: string;
};

export type LiveActivityPlan = { action: 'end' } | { action: 'show'; props: WorkoutActivityProps; staleAt: number | null };

/** Clock jitter between the runner's monotonic clock and the wall clock stays far below this. */
const SAME_TIME_MS = 1500;

/** Whether the activity must be updated: anything shown changed, or a time moved (Back, +30 s, resume). */
export function needsUpdate(prev: WorkoutActivityProps | null, next: WorkoutActivityProps): boolean {
  if (!prev) return true;
  if (
    prev.title !== next.title ||
    prev.interval !== next.interval ||
    prev.detail !== next.detail ||
    prev.paused !== next.paused ||
    prev.pausedClock !== next.pausedClock ||
    prev.countsDown !== next.countsDown ||
    prev.color !== next.color
  )
    return true;
  if (next.paused) return false;
  return Math.abs(prev.startAt - next.startAt) > SAME_TIME_MS || Math.abs(prev.endAt - next.endAt) > SAME_TIME_MS;
}

export type LiveActivityInput = {
  enabled: boolean;
  timerName: string;
  view: RunnerView | null;
  nowWall: number;
  pausedLabel: string;
};

export function liveActivityPlan(i: LiveActivityInput): LiveActivityPlan {
  const v = i.view;
  const loc = v?.location ?? null;
  if (!i.enabled || !v || !loc || loc.ended || v.status === 'ended' || v.status === 'idle') return { action: 'end' };
  const seg = loc.segment;
  const open = loc.remainingMs === null;
  const paused = v.status === 'paused';
  // whole seconds keep the key stable between ticks (the wall clock and the runner clock drift by a few ms)
  const startAt = Math.round((i.nowWall - loc.inSegmentMs) / 1000) * 1000;
  const endAt = open ? startAt + OPEN_WINDOW_MS : Math.round((i.nowWall + (loc.remainingMs ?? 0)) / 1000) * 1000;
  const pausedClock = paused ? (open ? formatElapsedMs(loc.inSegmentMs) : formatRemainingMs(loc.remainingMs ?? 0)) : '';
  const detail = paused ? i.pausedLabel : [seg.pathLabel, seg.repeatLabel].filter(Boolean).join(' · ');
  const props: WorkoutActivityProps = {
    title: i.timerName,
    interval: seg.label,
    detail,
    startAt,
    endAt,
    countsDown: !open,
    paused,
    pausedClock,
    color: seg.color,
    textColor: textOn(seg.color),
  };
  return { action: 'show', props, staleAt: !open && !paused ? endAt + STALE_AFTER_MS : null };
}
