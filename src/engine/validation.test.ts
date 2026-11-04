import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { clampName, LIMITS, nameLength, plannedSeconds, validateTimer } from './validation';

const tabata: TimerDef = {
  name: 'Tabata',
  color: '#ff0000',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS },
};

describe('validateTimer (SPEC §5.3)', () => {
  it('accepts a plain Tabata and computes its planned length', () => {
    expect(validateTimer(tabata)).toEqual([]);
    expect(plannedSeconds(tabata)).toBe(10 + 8 * 30);
  });

  it('counts rest between rounds (not after the last) and whole repeats', () => {
    const t: TimerDef = { ...tabata, blocks: [block(tabata.blocks[0].intervals, { rounds: 3, restBetweenRoundsS: 60 })], prefs: { ...DEFAULT_PREFS, prepSeconds: 0, repeatWhole: 2 } };
    expect(plannedSeconds(t)).toBe((3 * 30 + 2 * 60) * 2);
  });

  it.each([
    ['empty name', { ...tabata, name: '  ' }, 'validation.name'],
    ['name too long', { ...tabata, name: 'x'.repeat(41) }, 'validation.name'],
    ['no blocks', { ...tabata, blocks: [] }, 'validation.noIntervals'],
    ['block without intervals', { ...tabata, blocks: [block([])] }, 'validation.noIntervals'],
    ['seconds 0', { ...tabata, blocks: [block([interval('Work', 0, 'work')])] }, 'validation.seconds'],
    ['seconds 6000', { ...tabata, blocks: [block([interval('Work', 6000, 'work')])] }, 'validation.seconds'],
    ['seconds fractional', { ...tabata, blocks: [block([interval('Work', 2.5, 'work')])] }, 'validation.seconds'],
    ['rounds 0', { ...tabata, blocks: [block([interval('Work', 5, 'work')], { rounds: 0 })] }, 'validation.rounds'],
    ['rounds 100', { ...tabata, blocks: [block([interval('Work', 5, 'work')], { rounds: 100 })] }, 'validation.rounds'],
    ['rest between rounds 6000', { ...tabata, blocks: [block([interval('Work', 5, 'work')], { restBetweenRoundsS: 6000 })] }, 'validation.restBetweenRounds'],
    ['21 blocks', { ...tabata, blocks: Array.from({ length: 21 }, () => block([interval('Work', 5, 'work')])) }, 'validation.blocks'],
    ['31 intervals', { ...tabata, blocks: [block(Array.from({ length: 31 }, () => interval('Work', 5, 'work')))] }, 'validation.intervals'],
    ['prep 61', { ...tabata, prefs: { ...DEFAULT_PREFS, prepSeconds: 61 } }, 'validation.prep'],
    ['repeat 11', { ...tabata, prefs: { ...DEFAULT_PREFS, repeatWhole: 11 } }, 'validation.repeat'],
    ['open tick 6000', { ...tabata, blocks: [block([interval('Set', 60, 'open', { openTickS: 6000 })])] }, 'validation.openTick'],
    ['over 8 hours', { ...tabata, blocks: [block([interval('Work', 5999, 'work')], { rounds: 5 })] }, 'validation.total'],
  ] as const)('rejects %s', (_name, def, key) => {
    expect(validateTimer(def as TimerDef).map((i) => i.key)).toContain(key);
  });

  it('exactly 8 hours is allowed', () => {
    const t: TimerDef = { ...tabata, blocks: [block([interval('Work', 3600, 'work')], { rounds: 8 })], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    expect(plannedSeconds(t)).toBe(LIMITS.totalSecondsMax);
    expect(validateTimer(t)).toEqual([]);
  });
});

// D31 (after blind set B1 va-19): names are limited to 40 Unicode CODE POINTS, not UTF-16 units (JS .length) — a
// 40-emoji name is 80 UTF-16 units and must be accepted. The same rule for timer, block and interval names.
describe('name length in code points (D31)', () => {
  const emoji40 = '💪'.repeat(40);
  const emoji41 = '💪'.repeat(41);
  const withNames = (name: string, ivName = 'Work', blockName = ''): TimerDef => ({ ...tabata, name, blocks: [block([interval(ivName, 20, 'work')], { name: blockName })] });

  it('counts code points', () => {
    expect(emoji40.length).toBe(80);
    expect(nameLength(emoji40)).toBe(40);
    expect(nameLength('運動'.repeat(20))).toBe(40);
    expect(nameLength('')).toBe(0);
  });

  it('accepts 40 emoji / 40 CJK characters and refuses 41 for timer, block and interval names', () => {
    expect(validateTimer(withNames(emoji40))).toEqual([]);
    expect(validateTimer(withNames('Tabata', emoji40))).toEqual([]);
    expect(validateTimer(withNames('Tabata', 'Work', emoji40))).toEqual([]);
    expect(validateTimer(withNames('運'.repeat(40)))).toEqual([]);
    expect(validateTimer(withNames(emoji41)).map((i) => i.path)).toEqual(['name']);
    expect(validateTimer(withNames('Tabata', emoji41)).map((i) => i.path)).toEqual(['blocks[0].intervals[0].name']);
    expect(validateTimer(withNames('Tabata', 'Work', emoji41)).map((i) => i.path)).toEqual(['blocks[0].name']);
    expect(validateTimer(withNames('運'.repeat(41))).map((i) => i.path)).toEqual(['name']);
  });

  it('a lone surrogate counts as one code point (no crash, no undercount)', () => {
    expect(nameLength('\ud83d'.repeat(40))).toBe(40);
    expect(validateTimer(withNames('\ud83d'.repeat(41))).map((i) => i.path)).toEqual(['name']);
  });

  it('clampName trims to 40 code points without splitting a surrogate pair', () => {
    expect(clampName(emoji41)).toBe(emoji40);
    expect(clampName('a' + emoji40)).toBe('a' + '💪'.repeat(39));
    expect(clampName('Tabata')).toBe('Tabata');
    const cut = clampName('x'.repeat(39) + '💪💪');
    expect(cut).toBe('x'.repeat(39) + '💪');
    expect(/[\ud800-\udbff]$/.test(cut)).toBe(false);
  });
});

