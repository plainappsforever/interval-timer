import { COLOR_NAMES, COLORS, colorOf, contrast, textOn, TYPE_COLORS } from './palette';

describe('palette (A16)', () => {
  it('every preset colour reaches 4.5:1 with its text colour', () => {
    for (const name of COLOR_NAMES) {
      const bg = COLORS[name];
      expect([name, Math.round(contrast(bg, textOn(bg)) * 100) / 100]).toEqual([name, expect.any(Number)]);
      expect(contrast(bg, textOn(bg))).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of Object.values(TYPE_COLORS)) expect(contrast(bg, textOn(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('known contrast values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('falls back to the type colour for an empty or malformed colour', () => {
    expect(colorOf('', 'work')).toBe(TYPE_COLORS.work);
    expect(colorOf('red', 'rest')).toBe(TYPE_COLORS.rest);
    expect(colorOf('#123456', 'rest')).toBe('#123456');
  });
});
