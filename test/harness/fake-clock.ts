// Deterministic fake monotonic clock + timer queue (SPEC §13 O2, A2). Timers fire `lateMs` after their due time
// (optionally with jitter from a seeded generator), in due order; `advanceTo` runs everything due up to a time.
import type { SchedulerClock } from '@/engine/cue-scheduler';

type Pending = { id: number; dueMs: number; fn: () => void };

export class FakeClock implements SchedulerClock {
  private t = 0;
  private seq = 0;
  private queue: Pending[] = [];
  private lateMs: number;
  private jitter: () => number;
  /** How late every timer fires (ms), plus optional jitter per timer. Plain fields (no parameter properties) so the
   * file also loads under Node's strip-only TypeScript (scripts/node/ts-hooks.mjs). */
  constructor(lateMs = 0, jitter: () => number = () => 0) {
    this.lateMs = lateMs;
    this.jitter = jitter;
  }

  now = () => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.queue.push({ id, dueMs: this.t + Math.max(0, ms) + this.lateMs + this.jitter(), fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue = this.queue.filter((p) => p.id !== handle);
  };

  /** Advances time to `ms`, firing due timers in order (a timer may schedule the next). */
  advanceTo(ms: number): void {
    for (;;) {
      this.queue.sort((a, b) => a.dueMs - b.dueMs || a.id - b.id);
      const next = this.queue[0];
      if (!next || next.dueMs > ms) break;
      this.queue.shift();
      this.t = Math.max(this.t, next.dueMs);
      next.fn();
    }
    this.t = Math.max(this.t, ms);
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.t + ms);
  }

  pendingCount(): number {
    return this.queue.length;
  }
}

/** Small seeded PRNG (mulberry32) for reproducible jitter. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
