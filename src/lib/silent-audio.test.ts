import { silentAudioAllowed, volumeFor } from './silent-audio';

describe('silent audio mode (test only)', () => {
  it('is on only in the development variant with the flag', () => {
    expect(silentAudioAllowed('development', '1')).toBe(true);
    expect(silentAudioAllowed('development', undefined)).toBe(false);
    expect(silentAudioAllowed('development', '0')).toBe(false);
  });
  it('is never on in preview or production, flag or not', () => {
    for (const variant of ['preview', 'production', undefined]) {
      expect(silentAudioAllowed(variant, '1')).toBe(false);
    }
  });
  it('hands the Android native runner volume 0 only in the silent development variant', () => {
    expect(volumeFor(0.8, 'development', '1')).toBe(0);
    expect(volumeFor(0.8, 'development', undefined)).toBe(0.8);
    for (const variant of ['preview', 'production', undefined]) expect(volumeFor(0.8, variant, '1')).toBe(0.8);
  });
});
