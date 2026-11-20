// Dev/test-only SILENT mode (owner rule: no test sounds on the Mac speakers). The cue engine runs exactly as normal
// (schedule, voice and beep decisions, play calls, timing log), but every player and every spoken cue gets volume 0.
// The Android native runner (modules/session-runner) gets volume 0 in its start options, which its SoundPool plays
// with (voice clips and beeps alike); same gate. Only the development variant honours it, and only when Metro was started with EXPO_PUBLIC_SILENT_AUDIO=1
// (`npm run dev:silent`); preview and production builds can never be silent through it.
import Constants from 'expo-constants';

/** Pure rule, unit-tested: silent only in the development variant with the flag set to "1". */
export function silentAudioAllowed(variant: unknown, flag: unknown): boolean {
  return variant === 'development' && flag === '1';
}

/** Pure: the volume handed to a cue player (iOS player, Android native runner) for a variant and flag. */
export function volumeFor(volume: number, variant: unknown, flag: unknown): number {
  return silentAudioAllowed(variant, flag) ? 0 : volume;
}

export function isSilentAudio(): boolean {
  return silentAudioAllowed(Constants.expoConfig?.extra?.appVariant, process.env.EXPO_PUBLIC_SILENT_AUDIO);
}

/** Volume for a cue player: 0 in silent mode, else the user's volume. */
export function cueVolume(volume: number): number {
  return volumeFor(volume, Constants.expoConfig?.extra?.appVariant, process.env.EXPO_PUBLIC_SILENT_AUDIO);
}

/** Extra options for Speech.speak: volume 0 in silent mode, nothing otherwise. */
export function speechSilence(): { volume?: number } {
  return isSilentAudio() ? { volume: 0 } : {};
}
