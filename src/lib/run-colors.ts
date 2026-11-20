// Run screen colours: the interval's own colour fills the screen with white or black text chosen for contrast (1.0.0 look);
// the brand accent is only the fallback when there is no interval colour.
import { textOn } from '@/engine/palette';

export function runColors(intervalColor: string | undefined | null, accent: string, onAccent: string): { bg: string; fg: string } {
  if (intervalColor && /^#[0-9a-fA-F]{6}$/.test(intervalColor)) return { bg: intervalColor, fg: textOn(intervalColor) };
  return { bg: accent, fg: onAccent };
}
