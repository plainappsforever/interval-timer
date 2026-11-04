// The honest status line (D24, L26): the running screen says what was MEASURED for the platform in this build. P5
// sets LOCKED_MODE from the A3/A4 runs (docs/V1_LOG.md P5): a platform stays 'unverified' ("keep the screen on")
// until its run passed. Measured on the simulator/emulator; the real-device check is the owner's QA (SPEC §16).
import type { MessageKey } from '@/i18n/en';

export type StatusPlatform = 'ios' | 'android';
export type LockedModeOutcome = 'verified' | 'unverified' | 'failed';

/** Build outcome per platform (set by the phase that measured it; see docs/V1_LOG.md P5). */
export const LOCKED_MODE: Record<StatusPlatform, LockedModeOutcome> = {
  // P5 2026-10-26: 124 cues backgrounded 12 min, −8..+7 ms, every beep and voice player reported playing (A3/A4, S1).
  ios: 'verified',
  // P5 2026-10-26: native runner, screen off 12 min: 118 cues 0..28 ms; under forced Doze idle 124 cues 0..23 ms;
  // voice clip in every cue, mediaPlayback service in the foreground throughout (A3/A4, S2).
  android: 'verified',
};

export function statusLineKey(platform: StatusPlatform, outcome: LockedModeOutcome = LOCKED_MODE[platform]): MessageKey {
  if (outcome !== 'verified') return 'status.keepScreenOn';
  return platform === 'ios' ? 'status.lockedIos' : 'status.lockedAndroid';
}
