import { formatDuration } from '@/engine/format';
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { decodeTimerLink, decodeTimerText } from '@/engine/share-codec';
import { plannedSeconds } from '@/engine/validation';

import { LINK_MAX_CHARS, sharePayload } from './share-payload';

const tabata: TimerDef = { name: 'Tabata', color: '', notes: '', blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })], prefs: { ...DEFAULT_PREFS } };

describe('share payload (U8, REVIEW S6)', () => {
  it('a normal timer goes out as words + a link in this build’s scheme that decodes to the same timer', () => {
    const p = sharePayload(tabata, plannedSeconds(tabata), formatDuration, 'plainintervals-dev');
    expect(p.kind).toBe('link');
    if (p.kind !== 'link') return;
    expect(p.url.startsWith('plainintervals-dev://t?d=')).toBe(true);
    expect(p.message.split('\n')[0]).toContain('Tabata');
    const back = decodeTimerLink(p.url);
    expect(back.ok && back.def).toEqual(tabata);
  });

  it('a maximal timer (20 blocks × 30 intervals) goes out as a .json file that decodes to the same timer', () => {
    const big: TimerDef = {
      name: 'Big / circuit: 💪',
      color: '',
      notes: '',
      blocks: Array.from({ length: 20 }, (_, b) => block(Array.from({ length: 30 }, (_, i) => interval(`Station ${b}-${i}`, 1, 'work')), { name: `B${b}` })),
      prefs: { ...DEFAULT_PREFS, prepSeconds: 0 },
    };
    const p = sharePayload(big, plannedSeconds(big), formatDuration);
    expect(p.kind).toBe('file');
    if (p.kind !== 'file') return;
    expect(p.fileName).toBe('Big-circuit.json');
    const back = decodeTimerText(p.content);
    expect(back.ok && back.def).toEqual(big);
    expect(LINK_MAX_CHARS).toBeLessThan(18_000);
  });
});
