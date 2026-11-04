// One running workout (SPEC §7 screen 3, D13, D33, D38): owns the engine state, drives it ONLY through `apply`/`view`
// (D33) and the cue path ONLY through a CueDriver (`sync(state, reason)` after every transition, src/lib/cues.ts),
// writes the recovery record on every transition (A8) and the history row when the run ends (A10). Actions from outside
// the app (Android notification / headset / call, iOS audio interruption) arrive through `onRunnerAction`.
// No React here, so the whole life cycle is tested in Jest with a fake driver and the Node SQLite fake.
import type { RunnerActionEvent } from '../../modules/session-runner/src/SessionRunnerModule';
import { addSession } from '@/db/sessions';
import { setSetting } from '@/db/settings';
import type { Db } from '@/db/types';
import type { TimerDef } from '@/engine/model';
import { recoveryRecord, sessionOf } from '@/engine/recovery';
import { apply, settle, view, type RunnerAction, type RunnerState, type RunnerView } from '@/engine/runner';
import { cuesBetween, type Cue } from '@/engine/schedule';

import type { CueDriver, CueOutput, SyncReason } from './cues';

export type RunMeta = {
  timerId: number;
  timerName: string;
  def: TimerDef;
  /** Wall clock at the first Start (kept across a recovery). */
  startedAtWall: number;
  /** The run was resumed after the app was interrupted (D24: the Done screen says so). */
  interrupted: boolean;
};

export type RunSessionDeps = {
  db: Db;
  driver: CueDriver;
  /** Monotonic clock (performance.now on device). */
  now?: () => number;
  /** Wall clock (Date.now) for the recovery record and history timestamps. */
  wall?: () => number;
  /** The run ended and its history row is written. */
  onFinished?: (sessionId: number) => void;
  /** Android: the app was swiped away; the recovery record stays so the next launch offers Resume (A8). */
  onDetached?: () => void;
  /** Native driver only: a voice cue whose clip could not be rendered just passed (live-speech fallback, D15). */
  onMissingVoice?: (cue: Cue) => void;
  hasVoiceClip?: (clipId: string) => boolean;
};

/** Which driver sync a transition needs. A driver that never started (a recovered paused run) starts on resume. */
export function syncReasonFor(action: RunnerAction, next: RunnerState, started: boolean): SyncReason {
  if (next.status === 'ended') return 'end';
  switch (action) {
    case 'start':
      return 'start';
    case 'pause':
      return 'pause';
    case 'resume':
      return started ? 'resume' : 'start';
    case 'toggle':
      return next.status === 'paused' ? 'pause' : started ? 'resume' : 'start';
    case 'addTime':
      return 'extend';
    case 'skip':
    case 'back':
    case 'next':
      return 'jump';
    case 'end':
      return 'end';
  }
}

export class RunSession {
  private s: RunnerState;
  private started = false;
  private finished = false;
  private finishing: Promise<void> | null = null;
  private detached = false;
  private lastTickElapsed = 0;
  private output: CueOutput = { sound: true, vibrate: true };
  private listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly wall: () => number;

  constructor(
    private readonly deps: RunSessionDeps,
    readonly meta: RunMeta,
    initial: RunnerState
  ) {
    this.s = initial;
    this.now = deps.now ?? (() => performance.now());
    this.wall = deps.wall ?? (() => Date.now());
  }

  get state(): RunnerState {
    return this.s;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get isDetached(): boolean {
    return this.detached;
  }

  get outputs(): CueOutput {
    return this.output;
  }

  view(): RunnerView {
    return view(this.s, this.now());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /**
   * Starts the cue path: a fresh run (idle) starts now; a recovered RUNNING state continues its cues from where it is;
   * a recovered PAUSED state waits for the user's Resume.
   */
  begin(): void {
    if (this.s.status === 'idle') {
      this.act('start');
      return;
    }
    if (this.s.status === 'running') {
      this.deps.driver.sync(this.s, 'start');
      this.started = true;
    }
    this.lastTickElapsed = this.view().elapsedMs;
    void this.persist();
    this.emit();
  }

  /** A user action (screen button, or forwarded from outside). Returns false when it did not fit the state (no-op). */
  act(action: RunnerAction): boolean {
    if (this.finished) return false;
    const prev = this.s;
    const next = apply(prev, action, this.now());
    if (next === prev) return false;
    this.s = next;
    const reason = syncReasonFor(action, next, this.started);
    this.deps.driver.sync(next, reason);
    if (reason === 'start') this.started = true;
    if (reason === 'jump' || reason === 'start') this.lastTickElapsed = this.view().elapsedMs;
    if (next.status === 'ended') void this.finish();
    else void this.persist();
    this.emit();
    return true;
  }

  /** The screen's tick: persists the natural end (Done screen, history) and feeds the live-speech fallback. */
  tick(): void {
    if (this.finished) return;
    const now = this.now();
    const settled = settle(this.s, now);
    if (settled !== this.s && settled.status === 'ended') {
      this.s = settled;
      this.deps.driver.sync(settled, 'end');
      void this.finish();
      this.emit();
      return;
    }
    if (this.s.status !== 'running') return;
    const elapsed = view(this.s, now).elapsedMs;
    if (this.deps.driver.native && this.deps.onMissingVoice && this.output.sound && elapsed > this.lastTickElapsed) {
      for (const c of cuesBetween(this.s.timeline, this.lastTickElapsed, elapsed)) {
        if (c.voiceClipId && c.text && !(this.deps.hasVoiceClip?.(c.voiceClipId) ?? false)) this.deps.onMissingVoice(c);
      }
    }
    this.lastTickElapsed = elapsed;
  }

  /** Actions reported by the native runner (Android) or the iOS audio interruption (JS driver). */
  onRunnerAction(e: RunnerActionEvent): void {
    if (this.finished) return;
    const now = this.now();
    switch (e.action) {
      case 'pause':
      case 'resume': {
        // The runner already paused/resumed itself; the engine follows. The JS driver (iOS interruption) must stop
        // its own scheduler too.
        const next = apply(this.s, e.action, now);
        if (next === this.s) return;
        this.s = next;
        if (!this.deps.driver.native) this.deps.driver.sync(next, e.action);
        void this.persist();
        this.emit();
        return;
      }
      case 'skip':
        this.act('skip');
        return;
      case 'end': {
        // Notification End: the runner has stopped; record the session.
        const next = apply(this.s, 'end', now);
        if (next === this.s) return;
        this.s = next;
        void this.finish();
        this.emit();
        return;
      }
      case 'finished':
        this.tick();
        return;
      case 'taskRemoved':
        // A swipe-away is not the user's End: the recovery record stays, the next launch offers Resume (A8).
        this.detached = true;
        this.deps.onDetached?.();
        this.emit();
        return;
    }
  }

  /** Quick toggles on the running screen. */
  setOutput(out: CueOutput): void {
    this.output = out;
    this.deps.driver.setOutput(out, this.s);
    this.emit();
  }

  private persist(): Promise<void> {
    const record = recoveryRecord(this.s, this.meta, this.now(), this.wall());
    return setSetting(this.deps.db, 'recovery', record).catch(() => {});
  }

  /** Resolves once the history row of an ended run is written (the two-sessions guard waits for it, D41). */
  whenFinished(): Promise<void> {
    return this.finishing ?? Promise.resolve();
  }

  private finish(): Promise<void> {
    if (this.finished) return this.finishing ?? Promise.resolve();
    this.finished = true;
    this.finishing = this.writeHistory();
    return this.finishing;
  }

  private async writeHistory(): Promise<void> {
    const s = this.s;
    const row = sessionOf(this.meta.def, s, s.elapsedMs, s.endedBy === 'finished', this.meta.startedAtWall, this.wall(), this.meta.interrupted);
    let id = 0;
    try {
      id = await addSession(this.deps.db, { ...row, timerId: this.meta.timerId });
    } catch {
      // the timer was deleted meanwhile (foreign key): the row keeps its name only (SPEC §9)
      id = await addSession(this.deps.db, { ...row, timerId: null }).catch(() => 0);
    }
    await setSetting(this.deps.db, 'recovery', null).catch(() => {});
    this.deps.onFinished?.(id);
  }
}
