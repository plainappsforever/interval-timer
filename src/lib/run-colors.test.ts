import { COLORS } from '@/engine/palette';
import { runColors } from './run-colors';

describe('runColors', () => {
  it('fills with the interval colour and picks readable text', () => {
    expect(runColors(COLORS.red, '#111111', '#222222')).toEqual({ bg: COLORS.red, fg: '#FFFFFF' });
    expect(runColors(COLORS.amber, '#111111', '#222222')).toEqual({ bg: COLORS.amber, fg: '#000000' });
  });
  it('falls back to the accent only without an interval colour', () => {
    expect(runColors(undefined, '#111111', '#222222')).toEqual({ bg: '#111111', fg: '#222222' });
    expect(runColors('', '#111111', '#222222')).toEqual({ bg: '#111111', fg: '#222222' });
  });
});
