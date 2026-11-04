// Interval colours (SPEC §7 screen 3: the colour fills the running screen; A16: white or black text must reach 4.5:1 on
// every preset). Pure.
import type { IntervalType } from './model';

export const COLORS = {
  red: '#C62828',
  orange: '#E65100',
  amber: '#F9A825',
  green: '#2E7D32',
  teal: '#00695C',
  blue: '#1565C0',
  indigo: '#283593',
  purple: '#6A1B9A',
  pink: '#AD1457',
  grey: '#455A64',
} as const;

export type ColorName = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

/** Default colour per interval type when an interval has none of its own. */
export const TYPE_COLORS: Record<IntervalType, string> = {
  prep: COLORS.amber,
  work: COLORS.red,
  rest: COLORS.green,
  cooldown: COLORS.blue,
  open: COLORS.purple,
};

export function colorOf(color: string, type: IntervalType): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : TYPE_COLORS[type];
}

function channel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** WCAG contrast ratio between two #rrggbb colours (≥ 1). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The text colour to use on a background: whichever of white/black contrasts more. */
export function textOn(background: string): '#FFFFFF' | '#000000' {
  return contrast(background, '#FFFFFF') >= contrast(background, '#000000') ? '#FFFFFF' : '#000000';
}
