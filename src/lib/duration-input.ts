// What the editor's length fields accept (SPEC §7 screen 2): plain seconds ("45", "90"), "m:ss" / "mm:ss" ("1:30",
// "04:10") and "h:mm:ss" ("1:00:00"), the same notation formatDuration writes (D30). Pure.

/** Whole seconds, or null when the text is not a duration (the field keeps the typed text and shows the last value). */
export function parseDurationInput(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  if (/^\d{1,5}$/.test(s)) return Number(s);
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, h, min, sec] = m;
  if (Number(sec) > 59) return null;
  if (h !== undefined && Number(min) > 59) return null;
  return (h ? Number(h) * 3600 : 0) + Number(min) * 60 + Number(sec);
}

/** Clamps a stepped value into [min, max]. */
export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
