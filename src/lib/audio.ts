// Audio for cues on iOS and in the Android foreground fallback (D14/D15/D16), from Breathe's src/lib/audio.ts: a
// near-silent looping bed keeps the audio session — and with it JS timers — alive while the iPhone is locked; beeps
// and pre-rendered voice clips are preloaded players, so a cue has no load latency. Android plays cues natively in
// modules/session-runner instead; this file is then only used when the runner is missing.
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync, type AudioPlayer } from 'expo-audio';

import type { BeepSet } from '@/db/settings';

const BEEPS = {
  classic: {
    'beep-start': require('../../assets/sounds/classic_start.wav'),
    'beep-halfway': require('../../assets/sounds/classic_halfway.wav'),
    'beep-tick': require('../../assets/sounds/classic_tick.wav'),
    'beep-end': require('../../assets/sounds/classic_end.wav'),
  },
  soft: {
    'beep-start': require('../../assets/sounds/soft_start.wav'),
    'beep-halfway': require('../../assets/sounds/soft_halfway.wav'),
    'beep-tick': require('../../assets/sounds/soft_tick.wav'),
    'beep-end': require('../../assets/sounds/soft_end.wav'),
  },
  bright: {
    'beep-start': require('../../assets/sounds/bright_start.wav'),
    'beep-halfway': require('../../assets/sounds/bright_halfway.wav'),
    'beep-tick': require('../../assets/sounds/bright_tick.wav'),
    'beep-end': require('../../assets/sounds/bright_end.wav'),
  },
} as const;

const AMBIENT_FILE = require('../../assets/sounds/ambient.wav');

/**
 * D16: a session mixes with the user's music and is heard in silent mode (a workout timer must be heard) unless the
 * user chose "Respect the silent switch"; background playback is what keeps cues going while locked (D14).
 */
export function setSessionAudioMode(respectSilent: boolean): Promise<void> {
  return setAudioModeAsync({ playsInSilentMode: !respectSilent, shouldPlayInBackground: true, interruptionMode: 'mixWithOthers' });
}

/**
 * After a session: let the audio session go, so iOS suspends the app instead of keeping it running in the background
 * (breathe REVIEW_V3 #1). Call it only once nothing of the session plays any more.
 */
export async function endBackgroundAudio(): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  await setIsAudioActiveAsync(false).catch(() => {});
  if (__DEV__) console.log('[audio] background audio released, audio session inactive');
}

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
}

/** Settings: plays a beep set's start beep once at the chosen volume (foreground only), then frees the player. */
export function previewBeep(beepSet: BeepSet, volume: number): void {
  try {
    const p = createAudioPlayer(BEEPS[beepSet]['beep-start']);
    p.volume = clampVolume(volume);
    p.play();
    setTimeout(() => p.remove(), 2000);
  } catch {
    // a preview must never break Settings
  }
}

/** Preloaded players for one session: the beep set, the timer's voice clips and the keep-alive bed. */
export class CuePlayers {
  private beeps = new Map<string, AudioPlayer>();
  private voices = new Map<string, AudioPlayer>();
  private subs: { remove(): void }[] = [];
  private ambient: AudioPlayer | null = null;
  private ambientSub: { remove(): void } | null = null;
  private interruptTimer: ReturnType<typeof setTimeout> | null = null;
  private volume = 1;

  preload(beepSet: BeepSet, voicePaths: string[], volume: number): void {
    this.volume = clampVolume(volume);
    for (const [id, source] of Object.entries(BEEPS[beepSet])) this.beeps.set(id, this.prepared(createAudioPlayer(source)));
    for (const path of voicePaths) this.addVoice(path);
  }

  addVoice(path: string): void {
    if (this.voices.has(path)) return;
    this.voices.set(path, this.prepared(createAudioPlayer({ uri: path.startsWith('file://') ? path : `file://${path}` })));
  }

  /**
   * A cue player rewinds itself as soon as it finishes, so the next cue starts at once. P5's first locked run showed why:
   * `seekTo(0)` is asynchronous, and a `play()` issued right behind it on a player that sat at its end did not start in
   * 31 of 125 cues (status probe below).
   */
  private prepared(p: AudioPlayer): AudioPlayer {
    p.volume = this.volume;
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) p.seekTo(0).catch(() => {});
    });
    this.subs.push(sub);
    return p;
  }

  /** Starts a player from its beginning; waits for the rewind only when the player is not there yet. */
  private async start(p: AudioPlayer): Promise<void> {
    if (p.playing || p.currentTime > 0.01) {
      p.pause();
      await p.seekTo(0).catch(() => {});
    }
    p.play();
  }

  /**
   * Plays a beep or voice clip and reports (S1/A4 evidence) whether the player said `playing` within `checkMs`: a
   * locked iPhone that refused to start audio would show up here, not only as silence.
   */
  play(kind: 'beep' | 'voice', id: string, checkMs = 400): Promise<boolean> {
    const p = kind === 'beep' ? this.beeps.get(id) : this.voices.get(id);
    if (!p) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        sub.remove();
        clearTimeout(timer);
        resolve(ok);
      };
      const sub = p.addListener('playbackStatusUpdate', (s) => {
        if (s.playing || s.didJustFinish) finish(true);
      });
      const timer = setTimeout(() => finish(p.playing), checkMs);
      this.start(p).then(() => {
        if (p.playing) finish(true);
      });
    });
  }

  /**
   * Near-silent looping bed that keeps the audio session (and background execution) alive, D14. onInterrupted: the OS
   * stopped the bed by itself (an incoming call on iOS), so the session can pause; no auto-resume (breathe D39). The 1 s
   * debounce ignores momentary loop-point states.
   */
  startAmbient(onInterrupted?: () => void): void {
    if (this.ambient) {
      if (!this.ambient.playing) this.ambient.play();
      return;
    }
    const player = createAudioPlayer(AMBIENT_FILE);
    player.loop = true;
    player.volume = 1; // the WAV itself is recorded at ~-40 dB
    player.play();
    this.ambient = player;
    if (onInterrupted) {
      this.ambientSub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.playing || !status.isLoaded || this.interruptTimer) return;
        this.interruptTimer = setTimeout(() => {
          this.interruptTimer = null;
          if (this.ambient === player && !player.playing) onInterrupted();
        }, 1000);
      });
    }
  }

  stopAmbient(): void {
    if (this.interruptTimer) clearTimeout(this.interruptTimer);
    this.interruptTimer = null;
    this.ambientSub?.remove();
    this.ambientSub = null;
    if (!this.ambient) return;
    // remove() alone frees the JS object but leaves the AVPlayer looping (breathe v3.1 F1).
    this.ambient.pause();
    this.ambient.remove();
    this.ambient = null;
  }

  release(): void {
    for (const sub of this.subs) sub.remove();
    this.subs = [];
    for (const p of [...this.beeps.values(), ...this.voices.values()]) {
      p.pause();
      p.remove();
    }
    this.beeps.clear();
    this.voices.clear();
    this.stopAmbient();
  }
}
