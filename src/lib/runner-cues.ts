// The engine timeline → the flat cue list the Android session runner plays (SPEC §6.1, D12/D14). Pure (Jest-tested):
// clip names and voice files are resolved by the caller. One RunnerCue per moment, because the runner's no-burst rule
// keeps only the LATEST due cue when it wakes late; the clips of a same-ms batch (beeps + the first voice) therefore play
// together, and a second voice of the batch ("Round 3 of 8" → "Work", D29.1) follows after the first one has been spoken.
import type { RunnerCue } from '../../modules/session-runner/src/SessionRunnerModule';
import { BEEP_CLIP } from '@/engine/cue-text';
import { VIBRATION, type Cue, type Timeline } from '@/engine/schedule';

export type { RunnerCue };

export type VoiceClip = { path: string; durationMs: number };

export type ClipResolver = {
  /** Beep clip id (BEEP_CLIP value, e.g. 'beep-tick') → what the player plays, or null when missing. */
  beep: (beepClipId: string) => string | null;
  /** Voice clip id → its rendered file, or null when it was not rendered (then the cue beeps instead, D15). */
  voice: (voiceClipId: string) => VoiceClip | null;
};

/** Silence between two voices of one moment. */
export const VOICE_GAP_MS = 80;
/** Open-interval reminder ticks are listed this far ahead (the runner cannot derive them; JS sends a new list on Next). */
export const OPEN_TICK_HORIZON_MS = 2 * 60 * 60 * 1000;

/** Android res/raw name of a beep in the chosen set ('beep-tick' + 'classic' → 'sr_classic_tick'). */
export function rawBeepName(beepClipId: string, beepSet: string): string {
  return `sr_${beepSet}_${beepClipId.replace(/^beep-/, '')}`;
}

/** What the notification shows for a segment: "Work · Round 3 of 8". */
export function segmentLabel(seg: { label: string; pathLabel: string }): string {
  return seg.pathLabel ? `${seg.label} · ${seg.pathLabel}` : seg.label;
}

export function runnerCues(timeline: Timeline, resolve: ClipResolver, horizonMs = OPEN_TICK_HORIZON_MS): RunnerCue[] {
  const byTime = new Map<number, { cues: Cue[]; label: string | null }>();
  const at = (ms: number) => {
    let b = byTime.get(ms);
    if (!b) byTime.set(ms, (b = { cues: [], label: null }));
    return b;
  };
  for (const seg of timeline.segments) at(seg.startMs).label = segmentLabel(seg);
  for (const c of timeline.cues) at(c.atMs).cues.push(c);
  // Reminder ticks inside an open interval that ends the laid-out part (D29.7: derived, beeps only).
  const last = timeline.segments[timeline.segments.length - 1];
  if (last && last.endMs === null && last.openTickS > 0) {
    const tick = last.openTickS * 1000;
    for (let k = 1, ms = last.startMs + tick; ms <= last.startMs + horizonMs; k++, ms += tick) {
      at(ms).cues.push({ atMs: ms, kind: 'openTick', segmentIndex: last.index, mode: 'beep', text: null, voiceClipId: null, beepClipId: BEEP_CLIP.openTick, vibration: timeline.options.vibrate ? (VIBRATION.openTick ?? null) : null, n: k });
    }
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const out: RunnerCue[] = [];
  times.forEach((ms, i) => {
    const { cues, label } = byTime.get(ms)!;
    const beeps: string[] = [];
    const voices: VoiceClip[] = [];
    let vibration: number[] | null = null;
    for (const c of cues) {
      const voice = c.voiceClipId ? resolve.voice(c.voiceClipId) : null;
      if (voice) voices.push(voice);
      // the cue's own beep, or the fallback beep for a voice that could not be rendered (D15)
      const beepId = c.beepClipId ?? (c.voiceClipId && !voice ? BEEP_CLIP[c.kind] : null);
      const beep = beepId ? resolve.beep(beepId) : null;
      if (beep && !beeps.includes(beep)) beeps.push(beep);
      if (!vibration && c.vibration) vibration = c.vibration;
    }
    const kind = cues.some((c) => c.kind === 'end') ? 'end' : (cues[0]?.kind ?? 'segment');
    out.push({ atMs: ms, kind, clips: voices.length ? [...beeps, voices[0].path] : beeps, vibration, label });
    // Later voices of the same moment are spoken one after the other; one that would run into the next moment is
    // dropped rather than talk over it (the next cue is newer information).
    const nextMs = times[i + 1] ?? Number.POSITIVE_INFINITY;
    let t = ms + (voices[0]?.durationMs ?? 0) + VOICE_GAP_MS;
    for (const v of voices.slice(1)) {
      const startAt = Math.ceil(t);
      if (startAt >= nextMs) break;
      out.push({ atMs: startAt, kind: 'voice', clips: [v.path], vibration: null, label: null });
      t = startAt + v.durationMs + VOICE_GAP_MS;
    }
  });
  return out;
}
