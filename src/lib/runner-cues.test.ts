import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { buildTimeline } from '@/engine/schedule';

import { OPEN_TICK_HORIZON_MS, rawBeepName, runnerCues, VOICE_GAP_MS, type ClipResolver } from './runner-cues';

const opts = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };
const tabata: TimerDef = { name: 'Tabata', color: '', notes: '', blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })], prefs: { ...DEFAULT_PREFS, prepSeconds: 10 } };
const resolver = (missing: string[] = []): ClipResolver & { texts: Map<string, string> } => {
  const texts = new Map<string, string>();
  return {
    texts,
    beep: (id) => rawBeepName(id, 'classic'),
    voice: (id) => (missing.includes(id) ? null : { path: `/cache/voice/${id}.wav`, durationMs: 600 }),
  };
};

describe('runnerCues (engine timeline → Android runner list)', () => {
  it('one cue per moment; a second voice of the same moment follows the first; labels at every segment start', () => {
    const t = buildTimeline(tabata, opts);
    const list = runnerCues(t, resolver());
    // strictly increasing times: the runner's no-burst rule can never drop half of a moment
    for (let i = 1; i < list.length; i++) expect(list[i].atMs).toBeGreaterThan(list[i - 1].atMs);
    const work1 = list.find((c) => c.atMs === 10_000)!;
    const roundVoice = t.cues.find((c) => c.atMs === 10_000 && c.kind === 'round')!.voiceClipId!;
    const workVoice = t.cues.find((c) => c.atMs === 10_000 && c.kind === 'start')!.voiceClipId!;
    expect(work1).toEqual({ atMs: 10_000, kind: 'round', clips: ['sr_classic_start', `/cache/voice/${roundVoice}.wav`], vibration: [0, 300], label: 'Work · Round 1 of 8' });
    expect(list.find((c) => c.atMs === 10_000 + 600 + VOICE_GAP_MS)).toEqual({ atMs: 10_680, kind: 'voice', clips: [`/cache/voice/${workVoice}.wav`], vibration: null, label: null });
    expect(list[0]).toMatchObject({ atMs: 0, label: 'Get ready' });
    expect(list.filter((c) => c.label !== null)).toHaveLength(t.segments.length);
    expect(list[list.length - 1]).toMatchObject({ atMs: 250_000, kind: 'end' });
    // countdown "3" = tick + voice together
    expect(list.find((c) => c.atMs === 27_000)!.clips).toHaveLength(2);
  });

  it('a voice that was not rendered becomes its beep (D15 fallback); a voice running into the next moment is dropped', () => {
    const t = buildTimeline(tabata, opts);
    const all = t.cues.map((c) => c.voiceClipId!).filter(Boolean);
    const list = runnerCues(t, resolver(all));
    expect(list.every((c) => c.clips.every((x) => x.startsWith('sr_')))).toBe(true);
    expect(list.find((c) => c.atMs === 27_000)!.clips).toEqual(['sr_classic_tick']);
    const long: ClipResolver = { beep: (id) => rawBeepName(id, 'soft'), voice: (id) => ({ path: `/v/${id}`, durationMs: 60_000 }) };
    expect(runnerCues(t, long).some((c) => c.kind === 'voice')).toBe(false);
  });

  it('open interval: reminder ticks listed to the horizon, no end cue, label of the open segment', () => {
    const def: TimerDef = { ...tabata, blocks: [block([interval('Work', 20, 'work'), interval('Plank', 60, 'open', { openTickS: 15 })])], prefs: { ...DEFAULT_PREFS, prepSeconds: 0 } };
    const t = buildTimeline(def, opts);
    const list = runnerCues(t, resolver(), 60_000);
    const ticks = list.filter((c) => c.kind === 'openTick');
    expect(ticks.map((c) => c.atMs)).toEqual([35_000, 50_000, 65_000, 80_000]);
    expect(ticks[0]).toMatchObject({ clips: ['sr_classic_tick'], vibration: [0, 60] });
    expect(list.some((c) => c.kind === 'end')).toBe(false);
    expect(list.find((c) => c.atMs === 20_000)!.label).toBe('Plank');
    expect(runnerCues(t, resolver()).filter((c) => c.kind === 'openTick')).toHaveLength(OPEN_TICK_HORIZON_MS / 15_000);
  });
});
