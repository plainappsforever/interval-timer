// The timer model shared by the data layer, the engines and the share codec (SPEC §4). Pure types, no imports.

export type IntervalType = 'prep' | 'work' | 'rest' | 'cooldown' | 'open';
export type CueMode = 'voice' | 'beep' | 'both' | 'none';
export type TimerKind = 'custom' | 'template';

export type IntervalDef = {
  name: string;
  /** 1..5999. For an `open` interval: the expected length shown in the editor; the segment runs until Next. */
  seconds: number;
  type: IntervalType;
  /** Hex colour, or '' for the type's default colour (src/engine/palette.ts). */
  color: string;
  cueStart: CueMode;
  halfwayCue: boolean;
  countdownCue: boolean;
  /** Reminder beep every N seconds inside an `open` interval; 0 = none (SPEC §4, ledger #45). */
  openTickS: number;
};

export type BlockDef = {
  name: string;
  /** 1..99 */
  rounds: number;
  /** 0..5999; a rest segment between rounds (not after the last one). */
  restBetweenRoundsS: number;
  intervals: IntervalDef[];
};

export type TimerPrefs = {
  /** 0..60 */
  prepSeconds: number;
  endCue: CueMode;
  /** 1..10 */
  repeatWhole: number;
  vibrate: boolean;
};

/** What the editor produces and the share codec carries: a timer without database bookkeeping. */
export type TimerDef = {
  name: string;
  color: string;
  notes: string;
  blocks: BlockDef[];
  prefs: TimerPrefs;
};

/** A saved timer. */
export type Timer = TimerDef & {
  id: number;
  kind: TimerKind;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  sortIndex: number;
};

export const DEFAULT_PREFS: TimerPrefs = { prepSeconds: 10, endCue: 'both', repeatWhole: 1, vibrate: true };

export function defaultInterval(type: IntervalType = 'work'): IntervalDef {
  return { name: '', seconds: 30, type, color: '', cueStart: 'both', halfwayCue: false, countdownCue: true, openTickS: 0 };
}

export function interval(name: string, seconds: number, type: IntervalType, extra: Partial<IntervalDef> = {}): IntervalDef {
  return { ...defaultInterval(type), name, seconds, ...extra };
}

export function block(intervals: IntervalDef[], extra: Partial<Omit<BlockDef, 'intervals'>> = {}): BlockDef {
  return { name: '', rounds: 1, restBetweenRoundsS: 0, ...extra, intervals };
}
