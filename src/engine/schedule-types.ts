// Timeline types (SPEC §5.1). Kept apart from schedule.ts so cue-text.ts and the runner can import them without a cycle.
import type { CueMode, IntervalDef, IntervalType } from './model';

export type CueKind = 'start' | 'halfway' | 'countdown' | 'end' | 'round' | 'openTick';
export type SegmentKind = 'prep' | 'interval' | 'roundRest';

/** One step of the expanded timer, before offsets are assigned. */
export type LogicalSegment = {
  kind: SegmentKind;
  type: IntervalType;
  /** Interval name; "Get ready" for prep; "Rest" for the rest between rounds. */
  label: string;
  color: string;
  /** null for an open interval (runs until Next). */
  seconds: number | null;
  /** 0-based; -1 for prep. */
  blockIndex: number;
  /** 0-based round within the block; -1 for prep. For a roundRest: the round just finished. */
  roundIndex: number;
  /** 0-based within the block; -1 for prep and roundRest. */
  intervalIndex: number;
  /** 0-based whole-timer repeat; 0 for prep. */
  repeatIndex: number;
  rounds: number;
  repeats: number;
  cueStart: CueMode;
  halfwayCue: boolean;
  countdownCue: boolean;
  openTickS: number;
  interval: IntervalDef | null;
};

export type Segment = LogicalSegment & {
  index: number;
  startMs: number;
  /** null while an open interval has not been closed by Next. */
  endMs: number | null;
  /** "Round 3 of 8" when the block has more than one round, else ''. */
  pathLabel: string;
  /** "Repeat 2 of 3" when the timer repeats, else ''. */
  repeatLabel: string;
};

export type Cue = {
  atMs: number;
  kind: CueKind;
  segmentIndex: number;
  /** How the cue is rendered: voice and/or beep. */
  mode: Exclude<CueMode, 'none'>;
  /** Spoken text (voice part), null for ticks. */
  text: string | null;
  /** Voice clip id (D15) or null when the mode has no voice part. */
  voiceClipId: string | null;
  /** Beep clip name or null when the mode has no beep part. */
  beepClipId: string | null;
  /** Android waveform [off, on, off, on, ...] in ms, or null (vibration off or no pattern for this kind). */
  vibration: number[] | null;
  /** Countdown number (3, 2, 1) or round number. */
  n?: number;
};

export type Timeline = {
  segments: Segment[];
  cues: Cue[];
  /** Length in ms, or null while the laid-out part ends in an open interval. */
  totalMs: number | null;
  /** Steps not yet laid out (after an open interval); empty when `totalMs` is set. */
  pending: LogicalSegment[];
  options: TimelineOptions;
};

export type TimelineOptions = {
  countdownFrom: 3 | 5 | 10;
  language: import('@/i18n').Language;
  voiceId: string | null;
  endCue: CueMode;
  vibrate: boolean;
};
