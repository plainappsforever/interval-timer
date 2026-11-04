import { block, interval } from '@/engine/model';
import { buildTimeline } from '@/engine/schedule';
import { plannedSeconds, validateTimer } from '@/engine/validation';
import { makeT } from '@/i18n';
import { templateDef, TEMPLATE_IDS } from '@/db/templates';

import { clampInt, parseDurationInput } from './duration-input';
import { cleanForSave, cycle, duplicateAt, hasOpenInterval, move, newTimerDef, nextInterval, removeAt, setAt } from './editor-ops';

describe('duration input (editor length fields)', () => {
  it('accepts seconds, m:ss, mm:ss and h:mm:ss', () => {
    expect(parseDurationInput('45')).toBe(45);
    expect(parseDurationInput(' 90 ')).toBe(90);
    expect(parseDurationInput('1:30')).toBe(90);
    expect(parseDurationInput('04:10')).toBe(250);
    expect(parseDurationInput('1:00:00')).toBe(3600);
    expect(parseDurationInput('1:39:59')).toBe(5999);
    expect(parseDurationInput('120:00')).toBe(7200);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '1:60', '1:60:00', '1::30', '-5', '1.5', '1:2:3:4']) expect([bad, parseDurationInput(bad)]).toEqual([bad, null]);
  });
  it('clamps steps', () => {
    expect(clampInt(-4, 1, 5999)).toBe(1);
    expect(clampInt(6004, 1, 5999)).toBe(5999);
  });
});

describe('editor list operations', () => {
  const list = ['a', 'b', 'c'];
  it('move, duplicate, remove, set never mutate', () => {
    expect(move(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(move(list, 0, -1)).toEqual(list);
    expect(duplicateAt(list, 1)).toEqual(['a', 'b', 'b', 'c']);
    expect(removeAt(list, 1)).toEqual(['a', 'c']);
    expect(setAt(list, 2, 'z')).toEqual(['a', 'b', 'z']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('duplicate copies deeply', () => {
    const blocks = [block([interval('Work', 20, 'work')])];
    const out = duplicateAt(blocks, 0);
    out[1].intervals[0].name = 'Changed';
    expect(blocks[0].intervals[0].name).toBe('Work');
  });
  it('cycle wraps', () => {
    expect(cycle(['voice', 'beep', 'both', 'none'], 'none')).toBe('voice');
    expect(cycle(['x', 'y'], 'x')).toBe('y');
  });
  it('add interval alternates work and rest', () => {
    const names = { work: 'Work', rest: 'Rest' };
    const b = block([interval('Work', 20, 'work')]);
    expect(nextInterval(b, names, false)).toMatchObject({ type: 'rest', name: 'Rest', seconds: 15 });
    expect(nextInterval(block([]), names, true)).toMatchObject({ type: 'work', name: 'Work', halfwayCue: true });
  });
});

describe('save clean-up (REVIEW S7, D31)', () => {
  it('trims names and clamps to 40 code points', () => {
    const def = newTimerDef('  Leg day  ', { work: 'Work', rest: 'Rest' }, false);
    def.blocks[0].name = ' A ';
    def.blocks[0].intervals[0].name = ` ${'💪'.repeat(45)} `;
    const out = cleanForSave(def);
    expect(out.name).toBe('Leg day');
    expect(out.blocks[0].name).toBe('A');
    expect(Array.from(out.blocks[0].intervals[0].name)).toHaveLength(40);
    expect(validateTimer(out)).toEqual([]);
  });
  it('a whitespace-only name stays invalid after trimming', () => {
    const def = cleanForSave(newTimerDef('   ', { work: 'Work', rest: 'Rest' }, false));
    expect(validateTimer(def).map((i) => i.path)).toEqual(['name']);
  });
});

describe('editor total equals the engine total (A15)', () => {
  it('for the new-timer default and every template', () => {
    const t = makeT('en');
    const defs = [newTimerDef('New', { work: 'Work', rest: 'Rest' }, false), ...TEMPLATE_IDS.map((id) => templateDef(id, t))];
    for (const def of defs) {
      expect(hasOpenInterval(def)).toBe(false);
      expect([def.name, plannedSeconds(def) * 1000]).toEqual([def.name, buildTimeline(def, { countdownFrom: 3, language: 'en', voiceId: null }).totalMs]);
    }
  });
});
