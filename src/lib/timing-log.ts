// Cue timing log (SPEC §13 O3, A3/A4): every played cue as { cueAtMs, firedAtMs, delta, mode } in a ring buffer, shown
// on the debug self-test route and written to a JSON file the phase agent reads from the simulator container. Pure
// apart from the optional file sink (injected), so the summary maths is unit-tested.

export type TimingEntry = {
  /** Nominal elapsed time of the cue. */
  cueAtMs: number;
  /** Elapsed time when it was played. */
  firedAtMs: number;
  /** firedAtMs − cueAtMs (positive = late). */
  delta: number;
  kind: string;
  /** App state when it fired: 'active' (screen shows the app) or 'background' (locked / another app in front). */
  mode: string;
  /** What was played: 'beep', 'voice', 'beep+voice', or a failure note ('voice-not-playing'). */
  played: string;
  /** Wall clock, for reading the log next to logcat / the simulator log. */
  wallMs: number;
};

export type TimingSummary = { n: number; min: number; mean: number; max: number; absMax: number };

export const TIMING_LOG_SIZE = 2000;

export function summarize(entries: readonly TimingEntry[], filter: (e: TimingEntry) => boolean = () => true): TimingSummary | null {
  const d = entries.filter(filter).map((e) => e.delta);
  if (d.length === 0) return null;
  const sum = d.reduce((a, b) => a + b, 0);
  return { n: d.length, min: Math.min(...d), mean: Math.round((sum / d.length) * 10) / 10, max: Math.max(...d), absMax: Math.max(...d.map(Math.abs)) };
}

export class TimingLog {
  private entries: TimingEntry[] = [];
  constructor(private readonly sink?: (entries: readonly TimingEntry[]) => void) {}

  add(e: Omit<TimingEntry, 'delta'>): TimingEntry {
    const entry = { ...e, delta: Math.round(e.firedAtMs - e.cueAtMs) };
    this.entries.push(entry);
    if (this.entries.length > TIMING_LOG_SIZE) this.entries.splice(0, this.entries.length - TIMING_LOG_SIZE);
    this.sink?.(this.entries);
    return entry;
  }

  /** Marks the latest entry for a cue time (the voice player reported its status after the cue fired). */
  annotate(cueAtMs: number, played: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].cueAtMs === cueAtMs) {
        this.entries[i] = { ...this.entries[i], played };
        this.sink?.(this.entries);
        return;
      }
    }
  }

  all(): readonly TimingEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.sink?.(this.entries);
  }
}
