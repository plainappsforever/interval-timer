// The core (SPEC §5.1, D13): a timer expands to logical segments; every segment and cue gets an ABSOLUTE offset from the
// timeline start (segment k starts at the sum of the previous lengths, never chained from timers). Open intervals cut
// the timeline (`totalMs: null`); `rebase` continues it from the user's Next. Pure; no React Native imports.
//
// Cue rules (D29 records the choices where SPEC §5.1 is silent). "prep" = the timer-level prep segment from
// prefs.prepSeconds only; an interval TYPED prep follows its own flags like any interval (D32):
//  start     at every segment start whose cue mode is not 'none' (prep and round-rest: 'both'); text = the label.
//  round     at the first segment of each round of a block with rounds > 1 (round 1 too), BEFORE the start cue at the
//            same ms; text "Round n of N". Not repeated by `repeat_whole` beyond the block's own rounds.
//  halfway   at start + seconds × 500 for intervals with the flag and seconds ≥ 10 (not prep/round-rest/open).
//  countdown at end − k × 1000 for k = countdownFrom..1, only strictly after the segment start; for intervals with the
//            flag, always for prep and round-rest; never for open intervals.
//  end       at totalMs when prefs.end_cue is not 'none'; absent while the timeline ends in an open interval.
//  openTick  not in the list (unbounded): the runner derives ticks from `segment.openTickS`.
// Cue order at equal times: round, start, halfway, countdown, end.
import { translatePlain, type Language } from '@/i18n';

import { BEEP_CLIP, cueText, voiceClipId } from './cue-text';
import type { CueMode, TimerDef } from './model';
import { colorOf } from './palette';
import type { Cue, CueKind, LogicalSegment, Segment, Timeline, TimelineOptions } from './schedule-types';

export type { Cue, CueKind, LogicalSegment, Segment, Timeline, TimelineOptions } from './schedule-types';

const KIND_ORDER: Record<CueKind, number> = { round: 0, start: 1, halfway: 2, countdown: 3, openTick: 4, end: 5 };

/** Android waveform patterns per cue kind ([off, on, ...] ms); round shares the start cue's buzz. */
export const VIBRATION: Partial<Record<CueKind, number[]>> = {
  start: [0, 300],
  halfway: [0, 150],
  countdown: [0, 80],
  end: [0, 400, 150, 400],
  openTick: [0, 60],
};

/** Expands prep + repeats × blocks × rounds × intervals (+ rest between rounds) into ordered steps without offsets. */
export function expand(def: TimerDef, language: Language): LogicalSegment[] {
  const out: LogicalSegment[] = [];
  const repeats = def.prefs.repeatWhole;
  if (def.prefs.prepSeconds > 0) {
    out.push({
      kind: 'prep',
      type: 'prep',
      label: translatePlain(language, 'cue.getReady'),
      color: colorOf('', 'prep'),
      seconds: def.prefs.prepSeconds,
      blockIndex: -1,
      roundIndex: -1,
      intervalIndex: -1,
      repeatIndex: 0,
      rounds: 1,
      repeats,
      cueStart: 'both',
      halfwayCue: false,
      countdownCue: true,
      openTickS: 0,
      interval: null,
    });
  }
  for (let r = 0; r < repeats; r++) {
    def.blocks.forEach((b, blockIndex) => {
      for (let round = 0; round < b.rounds; round++) {
        b.intervals.forEach((iv, intervalIndex) => {
          const open = iv.type === 'open';
          out.push({
            kind: 'interval',
            type: iv.type,
            label: iv.name,
            color: colorOf(iv.color, iv.type),
            seconds: open ? null : iv.seconds,
            blockIndex,
            roundIndex: round,
            intervalIndex,
            repeatIndex: r,
            rounds: b.rounds,
            repeats,
            cueStart: iv.cueStart,
            halfwayCue: iv.halfwayCue && !open,
            countdownCue: iv.countdownCue && !open,
            openTickS: open ? iv.openTickS : 0,
            interval: iv,
          });
        });
        if (b.restBetweenRoundsS > 0 && round < b.rounds - 1) {
          out.push({
            kind: 'roundRest',
            type: 'rest',
            label: translatePlain(language, 'cue.rest'),
            color: colorOf('', 'rest'),
            seconds: b.restBetweenRoundsS,
            blockIndex,
            roundIndex: round,
            intervalIndex: -1,
            repeatIndex: r,
            rounds: b.rounds,
            repeats,
            cueStart: 'both',
            halfwayCue: false,
            countdownCue: true,
            openTickS: 0,
            interval: null,
          });
        }
      }
    });
  }
  return out;
}

function pathLabel(s: LogicalSegment, language: Language): string {
  return s.kind !== 'prep' && s.rounds > 1 ? translatePlain(language, 'path.round', { n: s.roundIndex + 1, total: s.rounds }) : '';
}

function repeatLabel(s: LogicalSegment, language: Language): string {
  return s.kind !== 'prep' && s.repeats > 1 ? translatePlain(language, 'path.repeat', { n: s.repeatIndex + 1, total: s.repeats }) : '';
}

function makeCue(kind: CueKind, atMs: number, segmentIndex: number, mode: CueMode, o: TimelineOptions, ctx: { label?: string; n?: number; total?: number }): Cue | null {
  if (mode === 'none') return null;
  const text = cueText(kind, o.language, ctx);
  const voice = mode !== 'beep' && text !== null ? voiceClipId(o.language, o.voiceId, text) : null;
  const beep = mode !== 'voice' || text === null ? BEEP_CLIP[kind] : null;
  const cue: Cue = { atMs, kind, segmentIndex, mode, text, voiceClipId: voice, beepClipId: beep, vibration: o.vibrate ? (VIBRATION[kind] ?? null) : null };
  if (ctx.n !== undefined && kind !== 'start') cue.n = ctx.n;
  return cue;
}

/** Cues of one laid-out segment (not the end cue). */
function segmentCues(s: Segment, o: TimelineOptions): Cue[] {
  const cues: Cue[] = [];
  const push = (c: Cue | null) => c && cues.push(c);
  if (s.kind === 'interval' && s.rounds > 1 && s.intervalIndex === 0) {
    push(makeCue('round', s.startMs, s.index, 'both', o, { n: s.roundIndex + 1, total: s.rounds }));
  }
  push(makeCue('start', s.startMs, s.index, s.cueStart, o, { label: s.label }));
  if (s.endMs === null || s.seconds === null) return cues;
  if (s.halfwayCue && s.seconds >= 10) push(makeCue('halfway', s.startMs + s.seconds * 500, s.index, 'both', o, {}));
  if (s.countdownCue) {
    for (let k = o.countdownFrom; k >= 1; k--) {
      const at = s.endMs - k * 1000;
      if (at > s.startMs) push(makeCue('countdown', at, s.index, 'both', o, { n: k }));
    }
  }
  return cues;
}

export function sortCues(cues: Cue[]): Cue[] {
  return cues.sort((a, b) => a.atMs - b.atMs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.segmentIndex - b.segmentIndex);
}

/** Lays out steps from `startMs`, stopping after the first open interval. Returns the laid-out segments and the rest. */
function layout(steps: LogicalSegment[], firstIndex: number, startMs: number, o: TimelineOptions): { segments: Segment[]; pending: LogicalSegment[]; cues: Cue[]; totalMs: number | null } {
  const segments: Segment[] = [];
  const cues: Cue[] = [];
  let at = startMs;
  let i = 0;
  for (; i < steps.length; i++) {
    const s = steps[i];
    const seg: Segment = { ...s, index: firstIndex + segments.length, startMs: at, endMs: s.seconds === null ? null : at + s.seconds * 1000, pathLabel: pathLabel(s, o.language), repeatLabel: repeatLabel(s, o.language) };
    segments.push(seg);
    cues.push(...segmentCues(seg, o));
    if (seg.endMs === null) {
      i++;
      break;
    }
    at = seg.endMs;
  }
  const pending = steps.slice(i);
  const last = segments[segments.length - 1];
  const totalMs = last && last.endMs !== null && pending.length === 0 ? last.endMs : null;
  return { segments, pending, cues, totalMs };
}

/** SPEC §5.1 `buildTimeline(timer, prefs, settings)`: prefs are part of the TimerDef here. */
export function buildTimeline(def: TimerDef, options: Omit<TimelineOptions, 'endCue' | 'vibrate'> & Partial<Pick<TimelineOptions, 'endCue' | 'vibrate'>>): Timeline {
  const o: TimelineOptions = { endCue: def.prefs.endCue, vibrate: def.prefs.vibrate, ...options };
  const steps = expand(def, o.language);
  const { segments, pending, cues, totalMs } = layout(steps, 0, 0, o);
  if (totalMs !== null) {
    const end = makeCue('end', totalMs, segments.length - 1, o.endCue, o, {});
    if (end) cues.push(end);
  }
  return { segments, cues: sortCues(cues), totalMs, pending, options: o };
}

/**
 * The user tapped Next inside the open interval that ends the laid-out part: closes it at `atMs` (≥ its start) and lays
 * out the pending steps from there (up to and including the next open interval). A timeline without an open end is
 * returned unchanged.
 */
export function rebase(timeline: Timeline, atMs: number): Timeline {
  const last = timeline.segments[timeline.segments.length - 1];
  if (!last || last.endMs !== null) return timeline;
  const closeAt = Math.max(atMs, last.startMs);
  const closed: Segment = { ...last, endMs: closeAt };
  const next = layout(timeline.pending, timeline.segments.length, closeAt, timeline.options);
  const cues = [...timeline.cues, ...next.cues];
  const segments = [...timeline.segments.slice(0, -1), closed, ...next.segments];
  const totalMs = next.segments.length === 0 ? closeAt : next.totalMs;
  if (totalMs !== null) {
    const end = makeCue('end', totalMs, segments.length - 1, timeline.options.endCue, timeline.options, {});
    if (end) cues.push(end);
  }
  return { ...timeline, segments, cues: sortCues(cues), totalMs, pending: next.pending };
}

/**
 * "+30 s" (SPEC §5.2 addTime): segment `index` becomes `deltaMs` longer; every later segment and cue shifts by the same
 * amount, the segment's own countdown cues move with its end (halfway stays). An open segment cannot be extended.
 */
export function extendSegment(timeline: Timeline, index: number, deltaMs: number): Timeline {
  const target = timeline.segments[index];
  if (!target || target.endMs === null || deltaMs <= 0) return timeline;
  const segments = timeline.segments.map((s) => {
    if (s.index < index) return s;
    if (s.index === index) return { ...s, endMs: s.endMs! + deltaMs, seconds: s.seconds! + deltaMs / 1000 };
    return { ...s, startMs: s.startMs + deltaMs, endMs: s.endMs === null ? null : s.endMs + deltaMs };
  });
  const o = timeline.options;
  const cues = timeline.cues.flatMap((c): Cue[] => {
    if (c.segmentIndex < index) return [c];
    if (c.segmentIndex === index && c.kind !== 'end') {
      if (c.kind === 'countdown') return []; // rebuilt below
      return [c];
    }
    return [{ ...c, atMs: c.atMs + deltaMs }];
  });
  const extended = segments[index];
  if (extended.countdownCue) {
    for (let k = o.countdownFrom; k >= 1; k--) {
      const at = extended.endMs! - k * 1000;
      if (at > extended.startMs) {
        const cue = makeCue('countdown', at, index, 'both', o, { n: k });
        if (cue) cues.push(cue);
      }
    }
  }
  const totalMs = timeline.totalMs === null ? null : timeline.totalMs + deltaMs;
  return { ...timeline, segments, cues: sortCues(cues), totalMs };
}

export type Location = {
  index: number;
  segment: Segment;
  /** ms into the segment (≥ 0). */
  inSegmentMs: number;
  /** ms until the segment ends, or null in an open interval. */
  remainingMs: number | null;
  /** The timeline has run past its end (elapsedMs ≥ totalMs). */
  ended: boolean;
};

/** The segment at `elapsedMs` (binary search). At or past the end: the last segment with `ended: true`. */
export function locate(timeline: Timeline, elapsedMs: number): Location | null {
  const segs = timeline.segments;
  if (segs.length === 0) return null;
  const e = Math.max(0, elapsedMs);
  if (timeline.totalMs !== null && e >= timeline.totalMs) {
    const last = segs[segs.length - 1];
    return { index: last.index, segment: last, inSegmentMs: e - last.startMs, remainingMs: 0, ended: true };
  }
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].startMs <= e) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  return { index: s.index, segment: s, inSegmentMs: e - s.startMs, remainingMs: s.endMs === null ? null : s.endMs - e, ended: false };
}

/**
 * Catch-up without bursts (D13): the cues due in (fromMs, toMs] that may still be played at `toMs`: only cues of the
 * segment current at `toMs` (a cue overtaken by a later segment is skipped, never played late), and of those only the
 * latest batch (same ms) — plus the end cue when the end lies in the window. Open-interval ticks are generated from
 * the segment's `openTickS`.
 */
export function cuesBetween(timeline: Timeline, fromMs: number, toMs: number): Cue[] {
  if (toMs <= fromMs) return [];
  const loc = locate(timeline, toMs);
  if (!loc) return [];
  const out: Cue[] = [];
  const current = loc.ended ? -1 : loc.index;
  let latest: Cue[] = [];
  for (const c of timeline.cues) {
    if (c.atMs <= fromMs) continue;
    if (c.atMs > toMs) break;
    if (c.kind === 'end') {
      out.push(c);
      continue;
    }
    if (c.segmentIndex !== current) continue;
    if (latest.length && latest[0].atMs !== c.atMs) latest = [];
    latest.push(c);
  }
  if (!loc.ended && loc.segment.endMs === null && loc.segment.openTickS > 0) {
    const tick = loc.segment.openTickS * 1000;
    const k = Math.floor((toMs - loc.segment.startMs) / tick);
    const at = loc.segment.startMs + k * tick;
    if (k >= 1 && at > fromMs && (latest.length === 0 || at >= latest[0].atMs)) {
      const o = timeline.options;
      latest = [{ atMs: at, kind: 'openTick', segmentIndex: loc.index, mode: 'beep', text: null, voiceClipId: null, beepClipId: BEEP_CLIP.openTick, vibration: o.vibrate ? (VIBRATION.openTick ?? null) : null, n: k }];
    }
  }
  return sortCues([...latest, ...out]);
}

/** The next cue strictly after `elapsedMs` (what a scheduler should arm for), including open-interval ticks. */
export function nextCueAfter(timeline: Timeline, elapsedMs: number): Cue | null {
  let best: Cue | null = null;
  for (const c of timeline.cues) {
    if (c.atMs > elapsedMs) {
      best = c;
      break;
    }
  }
  const loc = locate(timeline, elapsedMs);
  if (loc && !loc.ended && loc.segment.endMs === null && loc.segment.openTickS > 0) {
    const tick = loc.segment.openTickS * 1000;
    const k = Math.floor((elapsedMs - loc.segment.startMs) / tick) + 1;
    const at = loc.segment.startMs + k * tick;
    if (!best || at < best.atMs) {
      const o = timeline.options;
      best = { atMs: at, kind: 'openTick', segmentIndex: loc.index, mode: 'beep', text: null, voiceClipId: null, beepClipId: BEEP_CLIP.openTick, vibration: o.vibrate ? (VIBRATION.openTick ?? null) : null, n: k };
    }
  }
  return best;
}

/** Distinct voice clips of a timeline (what D15 pre-renders before Start). */
export function voiceClips(timeline: Timeline): { clipId: string; text: string }[] {
  const seen = new Map<string, string>();
  for (const c of timeline.cues) if (c.voiceClipId && c.text !== null && !seen.has(c.voiceClipId)) seen.set(c.voiceClipId, c.text);
  return [...seen].map(([clipId, text]) => ({ clipId, text }));
}

/**
 * Every distinct voice clip a timer can need, also after its open intervals (REVIEW N1): the laid-out timeline stops at
 * the first open interval, so this closes each open interval at its expected length and lays out the rest until the
 * whole timer is covered. What P5's pre-rendering renders before Start (D15). Order: first use.
 */
export function voiceClipsForTimer(def: TimerDef, options: Parameters<typeof buildTimeline>[1]): { clipId: string; text: string }[] {
  const seen = new Map<string, string>();
  let t = buildTimeline(def, options);
  for (;;) {
    for (const c of t.cues) if (c.voiceClipId && c.text !== null && !seen.has(c.voiceClipId)) seen.set(c.voiceClipId, c.text);
    const last = t.segments[t.segments.length - 1];
    if (t.totalMs !== null || !last || last.endMs !== null) break;
    t = rebase(t, last.startMs + (last.seconds ?? 1) * 1000);
  }
  return [...seen].map(([clipId, text]) => ({ clipId, text }));
}
