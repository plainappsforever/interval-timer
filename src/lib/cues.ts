// Plays a running timer's cues (V1_PLAN P5, D12–D16). Android: the native session runner owns every cue (screen on or
// off) from the list runner-cues.ts builds; JS only forwards transitions. iOS (and Android without the runner): the JS
// cue scheduler (cue-scheduler.ts, A2) driven by runner.ts, playing preloaded beeps and pre-rendered voice clips while
// the keep-alive bed holds the audio session. Every JS-played cue goes into the timing log (A3/A4).
import { AppState } from 'react-native';

import SessionRunner, { type RunnerActionEvent } from '../../modules/session-runner/src/SessionRunnerModule';
import type { BeepSet } from '@/db/settings';
import { createCueScheduler, type CueScheduler } from '@/engine/cue-scheduler';
import { BEEP_CLIP } from '@/engine/cue-text';
import { elapsedAt, type RunnerState } from '@/engine/runner';
import type { Cue } from '@/engine/schedule';

import { CuePlayers, endBackgroundAudio, setSessionAudioMode } from './audio';
import { cueVolume } from './silent-audio';
import { rawBeepName, runnerCues, VOICE_GAP_MS, type VoiceClip } from './runner-cues';
import type { TimingLog } from './timing-log';

/** A pause longer than this releases the iOS background audio (bed + audio session); Resume restarts it (P8, breathe D62). */
export const PAUSE_RELEASE_MS = 60_000;

/** Why the caller syncs: a jump (Skip/Back/Next) moves elapsed, an extend (+30 s) only moves later cues. */
export type SyncReason = 'start' | 'pause' | 'resume' | 'jump' | 'extend' | 'end';

export type CueDriverOptions = {
  title: string;
  beepSet: BeepSet;
  volume: number;
  sound: boolean;
  respectSilent: boolean;
  voice: Map<string, VoiceClip>;
  log: TimingLog;
  labels: { skip: string; end: string };
  /** Actions from outside the app (Android notification, headset, call, unplugged headphones; iOS bed interrupted). */
  onAction?: (event: RunnerActionEvent) => void;
  /** JS-played cues only (iOS): called once per cue as it plays, with the current output switches and whether a
   *  pre-rendered clip exists for its voice part. The running screen uses it for foreground haptics (D17) and the
   *  live-speech fallback (D15). */
  onCue?: (cue: Cue, info: CueOutput & { voiceClip: boolean }) => void;
};

/** Run-time switches of the running screen's quick toggles. */
export type CueOutput = { sound: boolean; vibrate: boolean };

export type CueDriver = {
  readonly native: boolean;
  sync: (state: RunnerState, reason: SyncReason) => void;
  /** Sound / vibration on or off mid-run (quick toggles); takes effect from the next cue. */
  setOutput: (out: CueOutput, state: RunnerState) => void;
  dispose: () => void;
};

export function createCueDriver(o: CueDriverOptions): CueDriver {
  return SessionRunner ? nativeDriver(o) : jsDriver(o);
}

function nativeDriver(o: CueDriverOptions): CueDriver {
  const runner = SessionRunner!;
  const resolve = { beep: (id: string) => rawBeepName(id, o.beepSet), voice: (id: string) => o.voice.get(id) ?? null };
  const sub = o.onAction ? runner.addListener('onAction', o.onAction) : null;
  runner.prepare([...o.voice.values()].map((v) => v.path));
  let out: CueOutput = { sound: o.sound, vibrate: true };
  // muted: the cue list keeps its moments and labels (notification text) but plays nothing
  const cuesOf = (t: RunnerState['timeline']) => runnerCues(t, resolve).map((c) => ({ ...c, clips: out.sound ? c.clips : [], vibration: out.vibrate ? c.vibration : null }));
  return {
    native: true,
    sync(state, reason) {
      const now = performance.now();
      const elapsed = elapsedAt(state, now);
      const t = state.timeline;
      switch (reason) {
        case 'start':
          runner.start(cuesOf(t), { title: o.title, elapsedMs: elapsed, displayEndMs: t.totalMs, sound: o.sound, volume: cueVolume(o.volume), skipLabel: o.labels.skip, endLabel: o.labels.end });
          break;
        case 'pause':
          runner.pause();
          break;
        case 'resume':
          runner.resume(elapsed);
          break;
        case 'jump':
          runner.update(cuesOf(t), t.totalMs, elapsed);
          break;
        case 'extend':
          runner.update(cuesOf(t), t.totalMs, null);
          break;
        case 'end':
          // a natural end was played by the runner itself; the user's End stops without the end cue
          if (state.endedBy !== 'finished') runner.end(false);
          break;
      }
    },
    setOutput(next, state) {
      out = next;
      if (state.status === 'running' || state.status === 'paused') runner.update(cuesOf(state.timeline), state.timeline.totalMs, null);
    },
    dispose() {
      sub?.remove();
    },
  };
}

function jsDriver(o: CueDriverOptions): CueDriver {
  const players = new CuePlayers();
  players.preload(o.beepSet, [...o.voice.values()].map((v) => v.path), o.volume);
  let voiceFreeAt = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let current: RunnerState | null = null;
  let out: CueOutput = { sound: o.sound, vibrate: true };

  // Every play reports whether the player really started (A4/S1 evidence in the timing log).
  const failures = new Map<number, Set<string>>();
  const check = (what: 'beep' | 'voice', cueAtMs: number) => (ok: boolean) => {
    if (ok) return;
    const f = failures.get(cueAtMs) ?? new Set<string>();
    f.add(what);
    failures.set(cueAtMs, f);
    o.log.annotate(cueAtMs, [...f].map((w) => `${w}-not-playing`).join('+'));
  };
  const playVoice = (clip: VoiceClip, cueAtMs: number) => {
    players.play('voice', clip.path).then(check('voice', cueAtMs));
  };

  const emit = (cue: Cue, firedAtElapsedMs: number) => {
    const voice = cue.voiceClipId ? (o.voice.get(cue.voiceClipId) ?? null) : null;
    // the cue's own beep, or the fallback beep for a voice that could not be rendered (D15)
    const beepId = cue.beepClipId ?? (cue.voiceClipId && !voice ? BEEP_CLIP[cue.kind] : null);
    const played: string[] = [];
    if (out.sound && beepId) {
      players.play('beep', beepId).then(check('beep', cue.atMs));
      played.push('beep');
    }
    if (out.sound && voice) {
      const now = performance.now();
      const wait = Math.max(0, voiceFreeAt - now);
      voiceFreeAt = Math.max(now, voiceFreeAt) + voice.durationMs + VOICE_GAP_MS;
      if (wait === 0) playVoice(voice, cue.atMs);
      else {
        const h = setTimeout(() => {
          timers.delete(h);
          if (current?.status === 'running') playVoice(voice, cue.atMs);
        }, wait);
        timers.add(h);
      }
      played.push('voice');
    }
    o.onCue?.(cue, { ...out, voiceClip: voice !== null });
    const e = o.log.add({ cueAtMs: cue.atMs, firedAtMs: firedAtElapsedMs, kind: cue.kind, mode: AppState.currentState, played: played.join('+') || 'none', wallMs: Date.now() });
    if (__DEV__) console.log(`[cue] kind=${e.kind} nominalMs=${e.cueAtMs} lateMs=${e.delta} mode=${e.mode} played=${e.played}`);
  };

  const clock = { now: () => performance.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  // P8 (breathe D62, App Review 2.5.4): a pause longer than PAUSE_RELEASE_MS stops the near-silent bed and lets the audio
  // session go, so a paused workout in the background neither plays nor keeps the app awake; Resume restarts both.
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPauseTimer = () => {
    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = null;
  };
  // F5 (review 2026-10-26): the bed starts only once the background audio mode is set, and every audio-mode change waits
  // for the one before (`queueAudio`). Before, Resume after a > 60 s pause started the bed while the category was still
  // the non-background, silent-switch-respecting one that endBackgroundAudio leaves. bedGen: a Pause / End / dispose
  // that arrives while the mode change is in flight wins, so a late bed never starts in a paused or ended workout.
  let bedGen = 0;
  let disposed = false;
  const releaseAudio = () => {
    bedGen++;
    players.stopAmbient();
    void queueAudio(endBackgroundAudio);
  };
  const scheduler: CueScheduler = createCueScheduler(clock, emit, () => {
    // let the end chime / "Done" finish before the audio session goes
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      endTimer = null;
      releaseAudio();
    }, 3000);
  });

  return {
    native: false,
    sync(state, reason) {
      current = state;
      // a Skip or +30 s while paused keeps the pause's release timer running
      if (reason === 'pause' || reason === 'start' || reason === 'resume' || reason === 'end') clearPauseTimer();
      if (reason === 'pause' || reason === 'end') bedGen++;
      if (reason === 'pause') {
        pauseTimer = setTimeout(() => {
          pauseTimer = null;
          releaseAudio();
        }, PAUSE_RELEASE_MS);
      }
      if (reason === 'start' || reason === 'resume') {
        const gen = ++bedGen;
        void queueAudio(async () => {
          await setSessionAudioMode(o.respectSilent).catch(() => {});
          if (disposed || gen !== bedGen || current?.status !== 'running') return;
          players.startAmbient(() => o.onAction?.({ action: 'pause', elapsedMs: elapsedAt(state, performance.now()) }));
        });
      }
      if (reason === 'pause' || reason === 'jump' || reason === 'end') {
        for (const h of timers) clearTimeout(h);
        timers.clear();
        voiceFreeAt = 0;
      }
      scheduler.sync(state);
      if (reason === 'end' && state.endedBy !== 'finished') releaseAudio();
    },
    setOutput(next) {
      out = next;
    },
    dispose() {
      disposed = true;
      bedGen++;
      scheduler.stop();
      if (endTimer) clearTimeout(endTimer);
      clearPauseTimer();
      for (const h of timers) clearTimeout(h);
      timers.clear();
      players.release();
      void queueAudio(endBackgroundAudio);
    },
  };
}

/** One audio-session change at a time, app-wide (a new run's driver waits for the previous one's release too). */
let audioQueue: Promise<void> = Promise.resolve();
function queueAudio(step: () => Promise<unknown>): Promise<void> {
  audioQueue = audioQueue.then(step).then(
    () => undefined,
    () => undefined
  );
  return audioQueue;
}
