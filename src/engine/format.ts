// Time formatting (SPEC §5.4, D30): "mm:ss" (two-digit minutes) under one hour, "h:mm:ss" (unpadded hours) from one
// hour on; Western digits in every language (Arabic included, as print-cost). Pure.

/** Whole seconds → "mm:ss" (under an hour: "00:00", "09:59", "59:59") or "h:mm:ss" ("1:00:00"). Negatives clamp to 0. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** Remaining time on the running screen: ceil to whole seconds so "00:01" is shown until the boundary, never "00:00" early. */
export function formatRemainingMs(remainingMs: number): string {
  return formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000));
}

/** Elapsed time on the running screen: floor to whole seconds. */
export function formatElapsedMs(elapsedMs: number): string {
  return formatDuration(Math.floor(Math.max(0, elapsedMs) / 1000));
}
