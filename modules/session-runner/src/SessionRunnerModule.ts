import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * One cue for the native runner (built by src/lib/runner-cues.ts from the engine timeline): ms since session start,
 * paused time excluded. clips: res/raw names ("sr_classic_tick") and absolute voice clip paths, played together.
 * label: set at a segment start; the notification shows it (no per-second updates).
 */
export type RunnerCue = { atMs: number; kind: string; clips: string[]; vibration: number[] | null; label: string | null };

export type RunnerOptions = {
  /** Timer name, shown in the notification. */
  title: string;
  /** Where the session is now (0 for a fresh start, > 0 when resuming a recovered session). */
  elapsedMs: number;
  /** Session end for the notification's progress bar; null while an open interval cuts the timeline. */
  displayEndMs: number | null;
  sound: boolean;
  /** 0-1: the cue volume setting. */
  volume: number;
  /** Notification button texts in the UI language. */
  skipLabel: string;
  endLabel: string;
};

/** Actions that came from outside the app (notification, lock screen, headset, a call, headphones unplugged), plus
 *  'finished' when the runner played the end cue and 'taskRemoved' when the app was swiped away (keep recovery). */
export type RunnerActionEvent = { action: 'pause' | 'resume' | 'skip' | 'end' | 'finished' | 'taskRemoved'; elapsedMs: number };

declare class SessionRunnerModule extends NativeModule<{ onAction: (event: RunnerActionEvent) => void }> {
  prepare(clips: string[]): void;
  start(cues: RunnerCue[], options: RunnerOptions): void;
  /** elapsedMs: the engine's position after a jump (Skip/Back/Next), or null to keep the runner's clock (+30 s). */
  update(cues: RunnerCue[], displayEndMs: number | null, elapsedMs: number | null): void;
  pause(): void;
  resume(elapsedMs: number): void;
  end(playCue: boolean): void;
  stop(): void;
  isRunning(): boolean;
}

/** Android only (D12/D14); null on iOS, web and in Jest. */
export default requireOptionalNativeModule<SessionRunnerModule>('SessionRunner');
