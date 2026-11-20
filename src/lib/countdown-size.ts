/**
 * Start size of the big countdown numerals (R4 2026-11-19). The OS shrink-to-fit (adjustsFontSizeToFit) stays as the
 * safety net, but on iOS it fires early with the heavy face and left the numerals at about 65 % of the width. On iOS
 * the start size is now computed from the window width so that "00:00" just fills the line; Android keeps the fixed
 * start size (it already fills). Large-text small screens (SE class) keep the 130 cap.
 */
export const COUNTDOWN_MAX = 220;
export const COUNTDOWN_MIN = 100;
export const COUNTDOWN_LANDSCAPE = 170;
export const COUNTDOWN_SMALL_LARGE_TEXT = 130;
/** Width of "00:00" in the heavy tabular face, in em (four digits plus a colon). */
export const NUMERALS_EM = 3.05;
const SIDE_PADDING = 32;

export function countdownFontSize(o: {
  platform: 'ios' | 'android' | string;
  width: number;
  height: number;
  fontScale: number;
  landscape: boolean;
}): number {
  if (o.landscape) return COUNTDOWN_LANDSCAPE;
  const fit = Math.floor((o.width - SIDE_PADDING) / NUMERALS_EM);
  if (o.height < 720 && o.fontScale > 1.15) return o.platform === 'ios' ? Math.max(COUNTDOWN_MIN, Math.min(COUNTDOWN_SMALL_LARGE_TEXT, fit)) : COUNTDOWN_SMALL_LARGE_TEXT;
  if (o.platform !== 'ios') return COUNTDOWN_MAX;
  return Math.max(COUNTDOWN_MIN, Math.min(COUNTDOWN_MAX, fit));
}
