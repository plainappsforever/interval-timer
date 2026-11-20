import { block, interval, type TimerDef, DEFAULT_PREFS } from '@/engine/model';

import { patternOf, patternSummary, ringArcs } from './pattern';

const tabata: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  prefs: { ...DEFAULT_PREFS, prepSeconds: 10 },
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
};

describe('pattern', () => {
  test('tabata: sixteen alternating pieces, prep left out', () => {
    const p = patternOf(tabata);
    expect(p).toHaveLength(16);
    expect(p[0]).toMatchObject({ seconds: 20, kind: 'work' });
    expect(p[1]).toMatchObject({ seconds: 10, kind: 'rest' });
    expect(p.reduce((n, x) => n + x.seconds, 0)).toBe(240);
  });

  test('rest between rounds joins the rest before it and is not added after the last round', () => {
    const def: TimerDef = {
      ...tabata,
      blocks: [block([interval('Go', 30, 'work')], { rounds: 3, restBetweenRoundsS: 15 })],
    };
    expect(patternOf(def).map((x) => [x.kind, x.seconds])).toEqual([
      ['work', 30],
      ['rest', 15],
      ['work', 30],
      ['rest', 15],
      ['work', 30],
    ]);
  });

  test('neighbours of the same kind merge; the arcs cover the turn exactly once', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('A', 10, 'work'), interval('B', 10, 'work')], { rounds: 1 })] };
    expect(patternOf(def)).toHaveLength(1);
    const arcs = ringArcs(tabata);
    expect(arcs[0].from).toBe(0);
    expect(arcs[arcs.length - 1].to).toBeCloseTo(1);
  });

  test('summary and empty timer', () => {
    expect(patternSummary(tabata)).toEqual({ rounds: 8, lengths: [20, 10], blocks: 1 });
    expect(ringArcs({ ...tabata, blocks: [] })).toEqual([]);
  });
});
