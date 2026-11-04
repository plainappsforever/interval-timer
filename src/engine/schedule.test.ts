import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';
import { buildTimeline, cuesBetween, expand, extendSegment, locate, nextCueAfter, rebase, voiceClips, voiceClipsForTimer, type Cue } from './schedule';

const opts = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
const tabata: TimerDef = {
  name: 'Tabata',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 10 },
};
const brief = (c: Cue) => `${c.atMs} ${c.kind}${c.text !== null ? ` "${c.text}"` : ''}`;

describe('buildTimeline (SPEC §5.1)', () => {
  it('lays Tabata out from absolute offsets with prep, rounds and countdowns', () => {
    const t = buildTimeline(tabata, opts);
    expect(t.totalMs).toBe(250_000);
    expect(t.segments).toHaveLength(17);
    expect(t.segments.slice(0, 3).map((s) => [s.startMs, s.endMs, s.type, s.label, s.pathLabel])).toEqual([
      [0, 10_000, 'prep', 'Get ready', ''],
      [10_000, 30_000, 'work', 'Work', 'Round 1 of 8'],
      [30_000, 40_000, 'rest', 'Rest', 'Round 1 of 8'],
    ]);
    expect(t.segments[16]).toMatchObject({ startMs: 240_000, endMs: 250_000, roundIndex: 7, intervalIndex: 1, pathLabel: 'Round 8 of 8' });
    expect(t.cues).toHaveLength(77);
    expect(t.cues.slice(0, 12).map(brief)).toEqual([
      '0 start "Get ready"',
      '7000 countdown "3"',
      '8000 countdown "2"',
      '9000 countdown "1"',
      '10000 round "Round 1 of 8"',
      '10000 start "Work"',
      '27000 countdown "3"',
      '28000 countdown "2"',
      '29000 countdown "1"',
      '30000 start "Rest"',
      '37000 countdown "3"',
      '38000 countdown "2"',
    ]);
    expect(brief(t.cues[t.cues.length - 1])).toBe('250000 end "Done"');
    expect(t.cues.every((c, i) => i === 0 || t.cues[i - 1].atMs <= c.atMs)).toBe(true);
    expect(t.pending).toEqual([]);
  });

  it('voice/beep parts follow the cue mode; vibration follows prefs', () => {
    const t = buildTimeline({ ...tabata, blocks: [block([interval('Work', 20, 'work', { cueStart: 'voice' }), interval('Rest', 10, 'rest', { cueStart: 'beep' }), interval('Go', 5, 'work', { cueStart: 'none' })])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0, vibrate: false } }, opts);
    const starts = t.cues.filter((c) => c.kind === 'start');
    expect(starts.map((c) => [c.text, c.voiceClipId !== null, c.beepClipId])).toEqual([
      ['Work', true, null],
      ['Rest', false, 'beep-start'],
    ]);
    expect(t.cues.every((c) => c.vibration === null)).toBe(true);
    const vib = buildTimeline(tabata, opts);
    expect(vib.cues.find((c) => c.kind === 'start')?.vibration).toEqual([0, 300]);
    expect(voiceClips(vib).map((c) => c.text).sort()).toEqual(['1', '2', '3', 'Done', 'Get ready', 'Rest', 'Round 1 of 8', 'Round 2 of 8', 'Round 3 of 8', 'Round 4 of 8', 'Round 5 of 8', 'Round 6 of 8', 'Round 7 of 8', 'Round 8 of 8', 'Work']);
  });

  it('halfway at start + len/2 only for intervals ≥ 10 s with the flag; countdown from 5/10 only strictly after the start', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('A', 10, 'work', { halfwayCue: true }), interval('B', 9, 'work', { halfwayCue: true }), interval('C', 4, 'work'), interval('D', 25, 'work', { halfwayCue: true })])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    const t = buildTimeline(def, { ...opts, countdownFrom: 5 });
    expect(t.cues.map(brief)).toEqual([
      '0 start "A"',
      '5000 halfway "Halfway"',
      '5000 countdown "5"',
      '6000 countdown "4"',
      '7000 countdown "3"',
      '8000 countdown "2"',
      '9000 countdown "1"',
      '10000 start "B"',
      '14000 countdown "5"',
      '15000 countdown "4"',
      '16000 countdown "3"',
      '17000 countdown "2"',
      '18000 countdown "1"',
      '19000 start "C"',
      '20000 countdown "3"',
      '21000 countdown "2"',
      '22000 countdown "1"',
      '23000 start "D"',
      '35500 halfway "Halfway"',
      '43000 countdown "5"',
      '44000 countdown "4"',
      '45000 countdown "3"',
      '46000 countdown "2"',
      '47000 countdown "1"',
      '48000 end "Done"',
    ]);
    const ten = buildTimeline({ ...def, blocks: [block([interval('A', 10, 'work', { halfwayCue: true })])] }, { ...opts, countdownFrom: 10 });
    expect(ten.cues.filter((c) => c.kind === 'countdown').map((c) => c.n)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('an interval TYPED prep inside a block follows its own cue flags; only the timer-level prep segment is fixed (D32)', () => {
    // B1 tl-40: the set read a prep-typed interval like the prep segment (always countdown, never halfway). Decision:
    // the interval's own halfwayCue/countdownCue/cueStart apply; D29.2–4's fixed treatment is for prefs.prepSeconds only.
    const def: TimerDef = {
      ...tabata,
      blocks: [block([interval('Breather', 20, 'prep', { halfwayCue: true, countdownCue: false }), interval('Set up', 10, 'prep', { cueStart: 'none' })])],
      prefs: { ...DEFAULT_PREFS, prepSeconds: 5, endCue: 'none' },
    };
    const t = buildTimeline(def, opts);
    expect(t.segments.map((s) => [s.startMs, s.type, s.label])).toEqual([
      [0, 'prep', 'Get ready'],
      [5_000, 'prep', 'Breather'],
      [25_000, 'prep', 'Set up'],
    ]);
    expect(t.cues.map(brief)).toEqual([
      '0 start "Get ready"',
      '2000 countdown "3"',
      '3000 countdown "2"',
      '4000 countdown "1"',
      '5000 start "Breather"',
      '15000 halfway "Halfway"', // own flag: halfway yes, countdown no
      // "Set up": cueStart none → no start cue; countdownCue (default true) → 3/2/1; no halfway flag
      '32000 countdown "3"',
      '33000 countdown "2"',
      '34000 countdown "1"',
    ]);
  });

  it('rest between rounds, several blocks, repeat whole; no end cue when end_cue is none; no round cue for 1 round', () => {
    const def: TimerDef = {
      ...tabata,
      blocks: [block([interval('Squat', 30, 'work')], { rounds: 3, restBetweenRoundsS: 60 }), block([interval('Plank', 45, 'work'), interval('Rest', 15, 'rest')], { name: 'Core' })],
      prefs: { prepSeconds: 0, endCue: 'none', repeatWhole: 2, vibrate: true },
    };
    const t = buildTimeline(def, opts);
    const perRepeat = 3 * 30 + 2 * 60 + 60;
    expect(t.totalMs).toBe(perRepeat * 2 * 1000);
    expect(t.segments.map((s) => `${s.repeatIndex}:${s.blockIndex}:${s.roundIndex}:${s.intervalIndex} ${s.label} ${s.startMs}-${s.endMs} ${s.pathLabel}|${s.repeatLabel}`)).toEqual([
      '0:0:0:0 Squat 0-30000 Round 1 of 3|Repeat 1 of 2',
      '0:0:0:-1 Rest 30000-90000 Round 1 of 3|Repeat 1 of 2',
      '0:0:1:0 Squat 90000-120000 Round 2 of 3|Repeat 1 of 2',
      '0:0:1:-1 Rest 120000-180000 Round 2 of 3|Repeat 1 of 2',
      '0:0:2:0 Squat 180000-210000 Round 3 of 3|Repeat 1 of 2',
      '0:1:0:0 Plank 210000-255000 |Repeat 1 of 2',
      '0:1:0:1 Rest 255000-270000 |Repeat 1 of 2',
      '1:0:0:0 Squat 270000-300000 Round 1 of 3|Repeat 2 of 2',
      '1:0:0:-1 Rest 300000-360000 Round 1 of 3|Repeat 2 of 2',
      '1:0:1:0 Squat 360000-390000 Round 2 of 3|Repeat 2 of 2',
      '1:0:1:-1 Rest 390000-450000 Round 2 of 3|Repeat 2 of 2',
      '1:0:2:0 Squat 450000-480000 Round 3 of 3|Repeat 2 of 2',
      '1:1:0:0 Plank 480000-525000 |Repeat 2 of 2',
      '1:1:0:1 Rest 525000-540000 |Repeat 2 of 2',
    ]);
    expect(t.cues.filter((c) => c.kind === 'round').map(brief)).toEqual(['0 round "Round 1 of 3"', '90000 round "Round 2 of 3"', '180000 round "Round 3 of 3"', '270000 round "Round 1 of 3"', '360000 round "Round 2 of 3"', '450000 round "Round 3 of 3"']);
    expect(t.cues.some((c) => c.kind === 'end')).toBe(false);
    expect(t.cues.filter((c) => c.segmentIndex === 1).map(brief)).toEqual(['30000 start "Rest"', '87000 countdown "3"', '88000 countdown "2"', '89000 countdown "1"']);
  });

  it('texts follow the language; Arabic voice texts carry no bidi isolates', () => {
    const de = buildTimeline(tabata, { ...opts, language: 'de' });
    expect(de.cues.slice(0, 5).map((c) => c.text)).toEqual(['Bereit machen', '3', '2', '1', 'Runde 1 von 8']);
    expect(de.segments[2].pathLabel).toBe('Runde 1 von 8');
    const ar = buildTimeline(tabata, { ...opts, language: 'ar' });
    expect(ar.cues[4].text).toBe('الجولة 1 من 8');
    expect(ar.cues[4].text?.includes('⁨')).toBe(false);
    expect(ar.cues[4].voiceClipId).not.toBe(de.cues[4].voiceClipId);
    expect(buildTimeline(tabata, { ...opts, voiceId: 'com.apple.voice.x' }).cues[0].voiceClipId).not.toBe(de.cues[0].voiceClipId);
  });

  it('cuts the timeline at an open interval and continues from Next with rebase', () => {
    const def: TimerDef = {
      ...tabata,
      blocks: [block([interval('Work', 20, 'work'), interval('Plank', 60, 'open', { openTickS: 15 }), interval('Rest', 10, 'rest')], { rounds: 2 })],
      prefs: { ...DEFAULT_PREFS, prepSeconds: 0 },
    };
    const t = buildTimeline(def, opts);
    expect(t.totalMs).toBeNull();
    expect(t.segments.map((s) => [s.label, s.startMs, s.endMs])).toEqual([
      ['Work', 0, 20_000],
      ['Plank', 20_000, null],
    ]);
    expect(t.pending.map((s) => s.label)).toEqual(['Rest', 'Work', 'Plank', 'Rest']);
    expect(t.cues.map(brief)).toEqual(['0 round "Round 1 of 2"', '0 start "Work"', '17000 countdown "3"', '18000 countdown "2"', '19000 countdown "1"', '20000 start "Plank"']);
    expect(t.cues.some((c) => c.kind === 'end')).toBe(false);
    // ticks are derived, not listed
    expect(nextCueAfter(t, 20_000)?.atMs).toBe(35_000);
    expect(nextCueAfter(t, 35_000)).toMatchObject({ atMs: 50_000, kind: 'openTick', n: 2 });
    expect(cuesBetween(t, 34_000, 36_000).map(brief)).toEqual(['35000 openTick']);

    const r = rebase(t, 47_300);
    expect(r.segments.map((s) => [s.label, s.startMs, s.endMs])).toEqual([
      ['Work', 0, 20_000],
      ['Plank', 20_000, 47_300],
      ['Rest', 47_300, 57_300],
      ['Work', 57_300, 77_300],
      ['Plank', 77_300, null],
    ]);
    expect(r.totalMs).toBeNull();
    expect(r.cues.slice(6).map(brief)).toEqual(['47300 start "Rest"', '54300 countdown "3"', '55300 countdown "2"', '56300 countdown "1"', '57300 round "Round 2 of 2"', '57300 start "Work"', '74300 countdown "3"', '75300 countdown "2"', '76300 countdown "1"', '77300 start "Plank"']);

    const done = rebase(r, 100_000);
    expect(done.totalMs).toBe(110_000);
    expect(done.segments[4].endMs).toBe(100_000);
    expect(done.cues.slice(-2).map(brief)).toEqual(['109000 countdown "1"', '110000 end "Done"']);
    expect(rebase(done, 200_000)).toBe(done);
    expect(rebase(t, 5).segments[1].endMs).toBe(20_000); // never before its own start
  });

  it('a timer that ends in an open interval gets its end cue when Next closes it', () => {
    const t = buildTimeline({ ...tabata, blocks: [block([interval('Hold', 30, 'open')])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } }, opts);
    expect(t.totalMs).toBeNull();
    const r = rebase(t, 42_000);
    expect(r.totalMs).toBe(42_000);
    expect(r.cues.map(brief)).toEqual(['0 start "Hold"', '42000 end "Done"']);
  });

  it('extendSegment (+30 s) shifts later segments and cues and moves the countdown with the end', () => {
    const t = buildTimeline(tabata, opts);
    const e = extendSegment(t, 1, 30_000);
    expect(e.totalMs).toBe(280_000);
    expect(e.segments[1]).toMatchObject({ startMs: 10_000, endMs: 60_000, seconds: 50 });
    expect(e.segments[2]).toMatchObject({ startMs: 60_000, endMs: 70_000 });
    expect(e.cues.filter((c) => c.segmentIndex === 1).map(brief)).toEqual(['10000 round "Round 1 of 8"', '10000 start "Work"', '57000 countdown "3"', '58000 countdown "2"', '59000 countdown "1"']);
    expect(e.cues.filter((c) => c.segmentIndex === 0).map(brief)).toEqual(t.cues.filter((c) => c.segmentIndex === 0).map(brief));
    expect(brief(e.cues[e.cues.length - 1])).toBe('280000 end "Done"');
    expect(e.cues).toHaveLength(t.cues.length);
    expect(extendSegment(t, 99, 30_000)).toBe(t);
  });

  it('locate finds the segment at any elapsed, with remaining time; past the end it reports ended', () => {
    const t = buildTimeline(tabata, opts);
    expect(locate(t, 0)).toMatchObject({ index: 0, inSegmentMs: 0, remainingMs: 10_000, ended: false });
    expect(locate(t, 9_999)).toMatchObject({ index: 0, remainingMs: 1 });
    expect(locate(t, 10_000)).toMatchObject({ index: 1, inSegmentMs: 0, remainingMs: 20_000 });
    expect(locate(t, 249_999)).toMatchObject({ index: 16, remainingMs: 1 });
    expect(locate(t, 250_000)).toMatchObject({ index: 16, remainingMs: 0, ended: true });
    expect(locate(t, -5)).toMatchObject({ index: 0 });
  });

  it('cuesBetween never bursts: only the latest batch of the current segment, plus the end cue', () => {
    const t = buildTimeline(tabata, opts);
    expect(cuesBetween(t, -1, 0).map(brief)).toEqual(['0 start "Get ready"']);
    expect(cuesBetween(t, 6_000, 8_500).map(brief)).toEqual(['8000 countdown "2"']); // "3" overtaken by "2"
    expect(cuesBetween(t, 8_500, 10_000).map(brief)).toEqual(['10000 round "Round 1 of 8"', '10000 start "Work"']);
    expect(cuesBetween(t, 5_000, 31_000).map(brief)).toEqual(['30000 start "Rest"']); // the whole Work segment was overtaken
    expect(cuesBetween(t, 240_000, 260_000).map(brief)).toEqual(['250000 end "Done"']); // countdown 3-2-1 overtaken by the end
    expect(cuesBetween(t, 10_000, 10_000)).toEqual([]);
    expect(cuesBetween(t, 28_500, 29_000).map(brief)).toEqual(['29000 countdown "1"']);
  });

  it('expand gives the logical steps; an empty timer gives an empty timeline', () => {
    expect(expand(tabata, 'en')).toHaveLength(17);
    const empty = buildTimeline({ ...tabata, blocks: [], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } }, opts);
    expect(empty.segments).toEqual([]);
    expect(empty.totalMs).toBeNull();
    expect(locate(empty, 0)).toBeNull();
  });
});

describe('voiceClipsForTimer (REVIEW N1: pre-render from every step, not the cut timeline)', () => {
  it('covers the steps after open intervals, which voiceClips(timeline) cannot see', () => {
    const def: TimerDef = {
      name: 'Open',
      color: '',
      notes: '',
      blocks: [block([interval('Work', 20, 'work'), interval('Plank', 60, 'open'), interval('Cooldown walk', 30, 'cooldown')], { rounds: 3 })],
      prefs: { ...DEFAULT_PREFS, prepSeconds: 5 },
    };
    const cut = voiceClips(buildTimeline(def, opts)).map((c) => c.text);
    const all = voiceClipsForTimer(def, opts).map((c) => c.text);
    expect(cut).not.toContain('Cooldown walk');
    expect(cut).not.toContain('Round 3 of 3');
    expect(all).toEqual(expect.arrayContaining(['Get ready', 'Round 1 of 3', 'Work', 'Plank', 'Cooldown walk', 'Round 2 of 3', 'Round 3 of 3', 'Done', '3', '2', '1']));
    expect(new Set(all).size).toBe(all.length);
    // without open intervals it is exactly voiceClips(buildTimeline)
    expect(voiceClipsForTimer(tabata, opts)).toEqual(voiceClips(buildTimeline(tabata, opts)));
  });
});
