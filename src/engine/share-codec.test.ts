import { base64urlDecode, base64urlEncode, decodeText, encodeText, utf8Decode, utf8Encode } from './base64url';
import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { decodeTimerLink, decodeTimerText, describeTimer, encodeTimerFile, encodeTimerLink, fromWire, toWire } from './share-codec';
import { formatDuration } from './format';
import { plannedSeconds } from './validation';
import { seeded } from '../../test/harness/fake-clock';

const circuit: TimerDef = {
  name: 'Zirkel 🏋️ Тренировка',
  color: '#00695C',
  notes: 'left side first',
  blocks: [
    block([interval('Squats', 45, 'work', { halfwayCue: true, color: '#C62828' }), interval('Rest', 15, 'rest', { cueStart: 'beep' })], { name: 'Legs', rounds: 3, restBetweenRoundsS: 60 }),
    block([interval('Plank 運動', 60, 'open', { openTickS: 15, countdownCue: false })], { name: 'Core', rounds: 2 }),
  ],
  prefs: { prepSeconds: 5, endCue: 'voice', repeatWhole: 2, vibrate: false },
};
const plain: TimerDef = { name: 'Tabata', color: '', notes: '', blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })], prefs: { ...DEFAULT_PREFS } };

describe('base64url / utf-8', () => {
  it('round-trips text incl. emoji and CJK, matches Node for ASCII, rejects garbage', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'Zirkel 🏋️ Тренировка 運動 العربية', '\u{1F600}']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
      expect(decodeText(encodeText(s))).toBe(s);
      expect(encodeText(s)).toBe(Buffer.from(s, 'utf8').toString('base64url'));
    }
    expect(base64urlEncode([255, 254])).toBe('__4');
    expect(base64urlDecode('__4=')).toEqual([255, 254]);
    expect(base64urlDecode('//4=')).toEqual([255, 254]); // standard alphabet accepted
    expect(base64urlDecode('/+4')).toEqual([255, 238]);
    expect(() => base64urlDecode('a')).toThrow();
    expect(() => base64urlDecode('ab$c')).toThrow();
    expect(() => utf8Decode([0xc3])).toThrow();
    expect(() => utf8Decode([0xed, 0xa0, 0x80])).toThrow(); // surrogate
  });
});

describe('share codec (SPEC §5.5, A11)', () => {
  it('link round-trip is exact, incl. 15-language names and emoji; defaults are omitted from the wire', () => {
    const link = encodeTimerLink(circuit);
    expect(link.startsWith('plainintervals://t?d=')).toBe(true);
    expect(link).toMatch(/^[a-z]+:\/\/t\?d=[A-Za-z0-9_-]+$/);
    expect(decodeTimerLink(link)).toEqual({ ok: true, def: circuit });
    expect(decodeTimerLink(link.replace('plainintervals://', 'plainintervals-dev://'))).toEqual({ ok: true, def: circuit });
    expect(toWire(plain)).toEqual({ v: 1, n: 'Tabata', b: [{ r: 8, i: [{ n: 'Work', s: 20, t: 'work' }, { n: 'Rest', s: 10, t: 'rest' }] }] });
    expect(decodeTimerLink(encodeTimerLink(plain))).toEqual({ ok: true, def: plain });
    expect(encodeTimerLink(plain).length).toBeLessThan(200);
  });

  it('file round-trip; decodeTimerText reads files, bare objects and pasted links', () => {
    const file = encodeTimerFile(circuit);
    expect(JSON.parse(file)).toMatchObject({ format: 'plainintervals-timer', version: 1 });
    expect(decodeTimerText(file)).toEqual({ ok: true, def: circuit });
    expect(decodeTimerText(JSON.stringify(toWire(circuit)))).toEqual({ ok: true, def: circuit });
    expect(decodeTimerText(`  ${encodeTimerLink(circuit)}\n`)).toEqual({ ok: true, def: circuit });
    expect(decodeTimerText(file.replace('"version": 1', '"version": 2'))).toEqual({ ok: false, reason: 'version' });
  });

  it('unknown fields are ignored; limits are enforced; wrong shapes never throw', () => {
    const wire = { ...toWire(plain), extra: 1, b: [{ ...toWire(plain).b[0], zz: true, i: [{ n: 'Work', s: 20, t: 'work', future: [1] }] }] };
    expect(fromWire(wire)).toMatchObject({ ok: true, def: { blocks: [{ intervals: [{ name: 'Work', seconds: 20 }] }] } });
    expect(fromWire({ v: 1, n: 'x', b: [{ r: 100, i: [{ n: 'a', s: 5, t: 'work' }] }] })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fromWire({ v: 1, n: 'x', b: [{ r: 1, i: [{ n: 'a', s: 6000, t: 'work' }] }] })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fromWire({ v: 1, n: 'x', b: [{ r: 1, i: [{ n: 'a', s: 5, t: 'work' }] }], p: { rw: 99 } })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fromWire({ v: 1, n: 'x', b: [{ r: 1, i: [{ n: 'a', s: 5, t: 'nonsense', cs: 'loud', c: 'red' }] }] })).toMatchObject({ ok: true, def: { blocks: [{ intervals: [{ type: 'work', cueStart: 'both', color: '' }] }] } });
    expect(fromWire({ v: 2, n: 'x', b: [] })).toEqual({ ok: false, reason: 'version' });
    expect(fromWire(null)).toEqual({ ok: false, reason: 'format' });
    expect(fromWire([])).toEqual({ ok: false, reason: 'format' });
    expect(fromWire({ v: 1, n: 'x', b: 'no' })).toEqual({ ok: false, reason: 'format' });
    expect(fromWire({ v: 1, n: 'x', b: [{ r: 1, i: 'no' }] })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(decodeTimerLink('https://example.com/?d=abc')).toEqual({ ok: false, reason: 'format' });
    expect(decodeTimerLink('plainintervals://t?x=1')).toEqual({ ok: false, reason: 'format' });
    expect(decodeTimerLink('plainintervals://t?d=%%%')).toEqual({ ok: false, reason: 'format' });
    expect(decodeTimerLink('plainintervals://t?d=' + encodeText('{"v":1'))).toEqual({ ok: false, reason: 'format' });
    expect(decodeTimerText('')).toEqual({ ok: false, reason: 'format' });
    expect(decodeTimerText('{}')).toEqual({ ok: false, reason: 'version' });
  });

  it('fuzz: 1,000 random mutations of a valid link/file never throw and either decode to a valid timer or fail cleanly', () => {
    const rnd = seeded(7);
    const sources = [encodeTimerLink(circuit), encodeTimerFile(circuit), JSON.stringify(toWire(plain))];
    const chars = 'abcXYZ019{}[]":,\\/+-_=%.é中\ud83c';
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      let s = sources[i % sources.length];
      const edits = 1 + Math.floor(rnd() * 6);
      for (let e = 0; e < edits; e++) {
        const pos = Math.floor(rnd() * (s.length + 1));
        const op = rnd();
        if (op < 0.4) s = s.slice(0, pos) + chars[Math.floor(rnd() * chars.length)] + s.slice(pos);
        else if (op < 0.8) s = s.slice(0, pos) + s.slice(pos + 1);
        else s = s.slice(0, pos) + s.slice(pos, pos + 3).repeat(3) + s.slice(pos);
      }
      const result = decodeTimerText(s);
      if (result.ok) {
        ok++;
        expect(result.def.blocks.length).toBeGreaterThan(0);
        expect(plannedSeconds(result.def)).toBeLessThanOrEqual(8 * 3600);
      } else {
        expect(['format', 'version', 'invalid']).toContain(result.reason);
      }
    }
    expect(ok).toBeGreaterThan(0); // some mutations (e.g. in notes) still decode
  });

  it('describeTimer puts the timer in words', () => {
    expect(describeTimer(plain, formatDuration, plannedSeconds(plain))).toBe('Tabata: Work 00:20 / Rest 00:10 × 8 (04:10)');
    expect(describeTimer(circuit, formatDuration, plannedSeconds(circuit))).toBe('Zirkel 🏋️ Тренировка: Squats 00:45 / Rest 00:15 × 3 · Plank 運動 01:00 × 2 × 2 (14:05)');
  });
});
