import { en } from '@/i18n/en';

import { formatDuration, formatElapsedMs, formatRemainingMs } from './format';
import { LIMITS } from './validation';

// SPEC §5.4 "mm:ss / h:mm:ss" (D30, after blind set B1 fm-01/02/03/12/13): two-digit minutes under one hour,
// unpadded hours from one hour on.
describe('formatDuration (SPEC §5.4)', () => {
  it.each([
    [0, '00:00'],
    [1, '00:01'],
    [59, '00:59'],
    [60, '01:00'],
    [75, '01:15'],
    [250, '04:10'],
    [599, '09:59'],
    [600, '10:00'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3661, '1:01:01'],
    [5999, '1:39:59'],
    [8 * 3600, '8:00:00'],
    [36_000, '10:00:00'],
  ])('%i s -> %s', (s, text) => {
    expect(formatDuration(s)).toBe(text);
  });

  it('clamps negatives to 0 and floors fractions', () => {
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(59.9)).toBe('00:59');
  });

  it('remaining rounds up (never "00:00" before the boundary), elapsed rounds down', () => {
    expect(formatRemainingMs(1)).toBe('00:01');
    expect(formatRemainingMs(0)).toBe('00:00');
    expect(formatRemainingMs(59_001)).toBe('01:00');
    expect(formatElapsedMs(59_999)).toBe('00:59');
  });

  it('the validation texts name the same maximum the editor shows', () => {
    const max = formatDuration(LIMITS.secondsMax);
    expect(en['validation.seconds']).toContain(max);
    expect(en['validation.restBetweenRounds']).toContain(formatDuration(LIMITS.restBetweenRoundsMax));
    expect(en['validation.openTick']).toContain(formatDuration(LIMITS.openTickMax));
  });
});
