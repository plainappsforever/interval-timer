// Exact comparison of our timeline with a fixture's expected list (SPEC §13 O1, A1): segment starts/ends/types/labels
// and cue times/kinds/texts, in ms. Used by `npm run blind` and the dev-set Jest test. Lives outside src/engine.
import type { TimerDef } from '@/engine/model';
import { buildTimeline, rebase, type Timeline } from '@/engine/schedule';

export type ExpectedSegment = { startMs: number; endMs: number | null; type: string; label?: string };
export type ExpectedCue = { atMs: number; kind: string; text: string | null };
export type Expected = { totalMs: number | null; segments: ExpectedSegment[]; cues: ExpectedCue[] };
export type Fixture = { name: string; timer: TimerDef; countdownFrom: 3 | 5 | 10; nextAt: number[]; expected: Expected };

export type FixtureResult = { name: string; segmentMismatches: number; cueMismatches: number; totalMismatch: boolean; diffs: string[] };

export function timelineOf(f: Fixture): Timeline {
  let t = buildTimeline(f.timer, { countdownFrom: f.countdownFrom, language: 'en', voiceId: null });
  for (const at of f.nextAt) t = rebase(t, at);
  return t;
}

const seg = (s: ExpectedSegment) => `${s.startMs}-${s.endMs ?? 'open'} ${s.type}${s.label !== undefined ? ` "${s.label}"` : ''}`;
const cue = (c: ExpectedCue) => `${c.atMs} ${c.kind}${c.text !== null ? ` "${c.text}"` : ''}`;

/** Lines that differ, with up to `limit` examples per list (segments, cues). */
export function scoreFixture(f: Fixture, limit = 5): FixtureResult {
  const t = timelineOf(f);
  const withLabels = f.expected.segments.some((s) => s.label !== undefined);
  const ours = t.segments.map((s) => seg({ startMs: s.startMs, endMs: s.endMs, type: s.type, label: withLabels ? s.label : undefined }));
  const want = f.expected.segments.map(seg);
  const ourCues = t.cues.map((c) => cue({ atMs: c.atMs, kind: c.kind, text: c.text }));
  const wantCues = f.expected.cues.map(cue);
  const diffs: string[] = [];
  const segmentMismatches = diffLists(ours, want, 'segment', diffs, limit);
  const cueMismatches = diffLists(ourCues, wantCues, 'cue', diffs, limit);
  const totalMismatch = t.totalMs !== f.expected.totalMs;
  if (totalMismatch) diffs.push(`total: ours ${t.totalMs} expected ${f.expected.totalMs}`);
  return { name: f.name, segmentMismatches, cueMismatches, totalMismatch, diffs };
}

function diffLists(ours: string[], want: string[], what: string, diffs: string[], limit: number): number {
  let n = 0;
  const len = Math.max(ours.length, want.length);
  for (let i = 0; i < len; i++) {
    if (ours[i] === want[i]) continue;
    n++;
    if (diffs.filter((d) => d.startsWith(what)).length < limit) diffs.push(`${what}[${i}]: ours ${ours[i] ?? '(none)'} | expected ${want[i] ?? '(none)'}`);
  }
  return n;
}

export type SetResult = { fixtures: number; clean: number; segmentMismatches: number; cueMismatches: number; totalMismatches: number; results: FixtureResult[] };

export function scoreSet(fixtures: Fixture[]): SetResult {
  const results = fixtures.map((f) => scoreFixture(f));
  return {
    fixtures: results.length,
    clean: results.filter((r) => r.segmentMismatches === 0 && r.cueMismatches === 0 && !r.totalMismatch).length,
    segmentMismatches: results.reduce((n, r) => n + r.segmentMismatches, 0),
    cueMismatches: results.reduce((n, r) => n + r.cueMismatches, 0),
    totalMismatches: results.filter((r) => r.totalMismatch).length,
    results,
  };
}

export function formatSet(label: string, r: SetResult): string {
  const lines = [`${label}: ${r.fixtures} fixtures, ${r.clean} exact, ${r.segmentMismatches} segment mismatches, ${r.cueMismatches} cue mismatches, ${r.totalMismatches} total mismatches`];
  for (const x of r.results) {
    if (x.segmentMismatches || x.cueMismatches || x.totalMismatch) {
      lines.push(`  ${x.name}: ${x.segmentMismatches} segment / ${x.cueMismatches} cue${x.totalMismatch ? ' / total' : ''}`);
      for (const d of x.diffs) lines.push(`    ${d}`);
    }
  }
  return lines.join('\n');
}

/** Loads a set in the FORMAT.md layout (timers/ + expected/). */
export function loadDevSet(dir: string, read: (p: string) => string, list: (d: string) => string[], join: (...p: string[]) => string): Fixture[] {
  const names = list(join(dir, 'timers')).filter((f) => f.endsWith('.json')).sort();
  return names.map((file) => {
    const raw = JSON.parse(read(join(dir, 'timers', file))) as { timer: TimerDef; settings?: { countdownFrom?: 3 | 5 | 10 }; nextAt?: number[] };
    const expected = JSON.parse(read(join(dir, 'expected', file))) as Expected;
    return { name: file.replace(/\.json$/, ''), timer: raw.timer, countdownFrom: raw.settings?.countdownFrom ?? 3, nextAt: raw.nextAt ?? [], expected };
  });
}
