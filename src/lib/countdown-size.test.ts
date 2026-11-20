import { countdownFontSize } from './countdown-size';

const base = { height: 900, fontScale: 1, landscape: false };

describe('countdownFontSize', () => {
  it('android keeps the fixed start size', () => {
    expect(countdownFontSize({ ...base, platform: 'android', width: 393 })).toBe(220);
  });
  it('ios sizes the numerals to the window width, capped at 220', () => {
    expect(countdownFontSize({ ...base, platform: 'ios', width: 440 })).toBe(133);
    expect(countdownFontSize({ ...base, platform: 'ios', width: 402 })).toBe(121);
    expect(countdownFontSize({ ...base, platform: 'ios', width: 1000 })).toBe(220);
  });
  it('ios never goes below the large-text floor on narrow windows', () => {
    expect(countdownFontSize({ ...base, platform: 'ios', width: 250 })).toBe(100);
  });
  it('keeps the SE large-text and landscape rules', () => {
    expect(countdownFontSize({ platform: 'ios', width: 375, height: 667, fontScale: 1.3, landscape: false })).toBe(112);
    expect(countdownFontSize({ platform: 'ios', width: 800, height: 400, fontScale: 1, landscape: true })).toBe(170);
  });
});
