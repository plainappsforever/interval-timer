// Adapter for BLIND SET B2 (test/fixtures/timeline/blind-2/, P4c, L27): runs every case of that set through the
// engine and writes the ONE results file its README ("How to run", "Families", "Common input shapes") documents:
// `{ "<case id>": <engine output in the family's result shape> }`, scored by the set's own checker.py.
// Written 2026-10-16 from the B2 README only, BEFORE the single run, against the engine snapshot b2b66c0. It never
// computes an expected value and never repairs an engine result; every place where the engine has no call of exactly
// the README's shape is listed in ADAPTER_NOTES_B2 (and in docs/blind-2-first-run.txt).
// Run: node --import ./scripts/node/ts-hooks.mjs scripts/blind2-dump.mjs <set folder> <results.json>
import { execFileSync } from 'node:child_process';

import { exportBackup, restoreBackup } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addSession, deleteSession, listSessions, type Session } from '@/db/sessions';
import { restoreTemplates, seedTemplatesOnce } from '@/db/templates';
import { createTimer, deleteTimer, listTimers, updateTimer } from '@/db/timers';
import type { Db } from '@/db/types';
import { parseBackup, type RestoreMode } from '@/engine/backup';
import { toCsv } from '@/engine/csv';
import { formatDuration } from '@/engine/format';
import type { Timer, TimerDef, TimerKind } from '@/engine/model';
import { evaluateRecovery, parseRecovery, recoveredTimeline, recoveryRecord, restoreRunner, type RecoveryRecord } from '@/engine/recovery';
import * as R from '@/engine/runner';
import { buildTimeline, cuesBetween, locate, nextCueAfter, rebase, type Cue, type Timeline } from '@/engine/schedule';
import { decodeTimerLink, decodeTimerText, encodeTimerFile, encodeTimerLink, type DecodeResult } from '@/engine/share-codec';
import { buckets, dayKey, isoWeekKey, monthKey, streak } from '@/engine/stats';
import { clampName, validateTimer } from '@/engine/validation';
import { makeT } from '@/i18n';

import { createTestDb } from './node-sqlite-db';
import { zoneCase } from './zone-child';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type CountdownFrom = 3 | 5 | 10;
type Settings = { countdownFrom?: CountdownFrom } | undefined;
type Case = { id: string; family: string; input?: Record<string, unknown>; timerFile?: string };

export const ADAPTER_NOTES_B2 = [
  'timeline: buildTimeline(timer, {countdownFrom, language: en, voiceId: null}) (timer prefs are part of the TimerDef), then rebase(t, at) for each nextAt in order; dumped totalMs, segments {startMs,endMs,type,label}, cues {atMs,kind,text}.',
  'format: formatDuration(seconds); the engine takes no language argument (one Western-digit format for every UI language), so `language` is not passed.',
  'validation: valid = validateTimer(timer) returns no issue. clamp: clampName(input) (default max = LIMITS.nameMax).',
  'runner: s = idle(buildTimeline(...)); per step s = apply(s, do, at) except do "view" (read only); headset "toggle" -> apply toggle; `source` ignored (all sources use apply, D33). View = view(s, at): state = status, elapsedMs, segmentIndex = location.index, remainingMs = location.remainingMs; totalMs = s.timeline.totalMs (current, rebuilt timeline).',
  'recovery: one clock for monotonic and wall time (at = wall ms). After every step the app persists recoveryRecord(s, meta, at, at) (null = record cleared), JSON round trip as in settings.recovery, read back with parseRecovery; then evaluateRecovery(record, relaunchAt). resume -> state paused|running from outcome.paused, segmentIndex from restoreRunner(record, outcome, relaunchAt).segmentIndex, remainingMs/totalMs from locate/recoveredTimeline, nextCue = nextCueAfter(recoveredTimeline, elapsedMs) with the kinds of every timeline cue at that ms. finished + completed -> finished, finished + !completed -> partial (elapsedMs reported as the engine gives it). `interrupted: true` on finished is the flag the app passes to sessionOf for a recovered run, not an engine decision. No record left -> decision none; discard -> decision discard.',
  'cuesBetween: cuesBetween(buildTimeline(...), frm, to) -> {atMs, kind, text}.',
  'nextCueAfter: nextCueAfter(buildTimeline(...), after) returns ONE cue; kinds = kinds of every timeline cue at that atMs in timeline order (the engine sorts same-ms cues), or ["openTick"] when the engine returns a generated tick.',
  'backup: two in-memory DBs (createTestDb + migrate, no seeding). Each gets its timers through createTimer(db, def, 1 000 000 + i, kind) and sessions through addSession (interrupted false); to land on the README ids, an id gap gets a row that is deleted again with deleteTimer/deleteSession (the same holes a deleted timer/session leaves on a phone). The backup file = exportBackup(backupDb, 2 000 000); restore = parseBackup(text) + restoreBackup(currentDb, parsed, mode). Result = listTimers/listSessions of the current DB.',
  'csv: toCsv(sessions) with interrupted = false.',
  'share: none = decodeTimerLink(encodeTimerLink(timer)); file = decodeTimerText(encodeTimerFile(timer)); tamper ops = the set\'s own share_tamper.py applied to the engine\'s link, then decodeTimerLink; encodeInvalid = encodeTimerLink (a throw -> ok false) then decodeTimerLink. ok -> {ok, timer}; refused -> {ok:false}; a throw anywhere -> {threw, error}.',
  'stats: computed in a process started with TZ = tz (test/zone-child.ts re-runs the script per zone). statsKeys = dayKey/isoWeekKey/monthKey(atMs). statsTotals = buckets(sessions, period) -> {key: {count: totals.sessions, actualS}}. streak = streak(sessions, nowMs). Sessions get id = position + 1, timerId null, timerName "", endedAt = startedAt + actualS * 1000, plannedS null, completed true, 0 skips/pauses, interrupted false, note "".',
  'templates: seedTemplatesOnce(db, makeT("en")) on an empty DB; the timer whose lowercased name contains keyword; totalMs = buildTimeline(it, {countdownFrom 3, en}).totalMs. templateRestore: seed; deleteTimer for each deleteKeywords match; updateTimer renames the renameKeyword timer (name + suffix) and sets the editKeyword timer\'s first interval seconds; restoreTemplates(db, makeT("en")); result timers {name, blocks}.',
];

// ------------------------------------------------------------------------------------------------ helpers
const opts = (s: Settings) => ({ countdownFrom: (s?.countdownFrom ?? 3) as CountdownFrom, language: 'en' as const, voiceId: null });
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const cueDump = (c: Cue): Json => ({ atMs: c.atMs, kind: c.kind, text: c.text });

function timelineDump(t: Timeline): Json {
  return {
    totalMs: t.totalMs,
    segments: t.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, type: s.type, label: s.label })),
    cues: t.cues.map(cueDump),
  };
}

function defDump(d: TimerDef): { [k: string]: Json } {
  return {
    name: d.name,
    color: d.color,
    notes: d.notes,
    blocks: d.blocks.map((b) => ({
      name: b.name,
      rounds: b.rounds,
      restBetweenRoundsS: b.restBetweenRoundsS,
      intervals: b.intervals.map((iv) => ({ name: iv.name, seconds: iv.seconds, type: iv.type, color: iv.color, cueStart: iv.cueStart, halfwayCue: iv.halfwayCue, countdownCue: iv.countdownCue, openTickS: iv.openTickS })),
    })),
    prefs: { prepSeconds: d.prefs.prepSeconds, endCue: d.prefs.endCue, repeatWhole: d.prefs.repeatWhole, vibrate: d.prefs.vibrate },
  };
}

const asDef = (t: TimerDef): TimerDef => ({ name: t.name, color: t.color, notes: t.notes, blocks: t.blocks, prefs: t.prefs });

function nextCueDump(t: Timeline, after: number): Json {
  const c = nextCueAfter(t, after);
  if (!c) return null;
  const kinds = c.kind === 'openTick' ? ['openTick'] : t.cues.filter((x) => x.atMs === c.atMs).map((x) => x.kind);
  return { atMs: c.atMs, kinds };
}

const withTz = zoneCase;

type MiniSession = { startedAt: number; actualS: number };
const statsSession = (s: MiniSession, i: number): Session => ({ id: i + 1, timerId: null, timerName: '', startedAt: s.startedAt, endedAt: s.startedAt + s.actualS * 1000, plannedS: null, actualS: s.actualS, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: '' });

type InSession = Omit<Session, 'interrupted'>;

// ------------------------------------------------------------------------------------------------ families
function runnerCase(inp: { timer: TimerDef; settings: Settings; steps: { at: number; do: string }[] }): Json {
  let s = R.idle(buildTimeline(inp.timer, opts(inp.settings)));
  const out: Json[] = [];
  for (const step of inp.steps) {
    if (step.do !== 'view') s = R.apply(s, step.do as R.RunnerAction, step.at);
    const v = R.view(s, step.at);
    out.push({ state: v.status, elapsedMs: v.elapsedMs, totalMs: s.timeline.totalMs, segmentIndex: v.location ? v.location.index : null, remainingMs: v.location ? v.location.remainingMs : null });
  }
  return out;
}

function recoveryCase(inp: { timer: TimerDef; settings: Settings; steps: { at: number; do: string }[]; relaunchAt: number }): Json {
  let s = R.idle(buildTimeline(inp.timer, opts(inp.settings)));
  let startedAtWall = 0;
  let stored: string | null = null;
  for (const step of inp.steps) {
    const before = s.status;
    s = R.apply(s, step.do as R.RunnerAction, step.at);
    if (before === 'idle' && s.status !== 'idle') startedAtWall = step.at;
    const rec = recoveryRecord(s, { timerId: 1, timerName: inp.timer.name, def: inp.timer, startedAtWall, interrupted: false }, step.at, step.at);
    stored = rec ? JSON.stringify(rec) : null;
  }
  const record: RecoveryRecord | null = stored === null ? null : parseRecovery(JSON.parse(stored));
  if (!record) return { decision: 'none' };
  const outcome = evaluateRecovery(record, inp.relaunchAt);
  const tl = recoveredTimeline(record);
  if (outcome.status === 'discard') return { decision: 'discard' };
  if (outcome.status === 'finished') {
    if (outcome.completed) return { decision: 'finished', elapsedMs: outcome.elapsedMs, totalMs: tl.totalMs, completed: true, interrupted: true };
    return { decision: 'partial', completed: false, totalMs: tl.totalMs, elapsedMs: outcome.elapsedMs };
  }
  const restored = restoreRunner(record, outcome, inp.relaunchAt);
  const loc = locate(tl, outcome.elapsedMs);
  const res: { [k: string]: Json } = {
    decision: 'resume',
    state: outcome.paused ? 'paused' : 'running',
    elapsedMs: outcome.elapsedMs,
    segmentIndex: restored.segmentIndex,
    remainingMs: loc ? loc.remainingMs : null,
    totalMs: tl.totalMs,
  };
  if (!outcome.paused) res.nextCue = nextCueDump(tl, outcome.elapsedMs);
  return res;
}

function shareCase(inp: { timer: TimerDef; op: string }, tamperPy: string): Json {
  const res = (r: DecodeResult): Json => (r.ok ? { ok: true, timer: defDump(r.def) } : { ok: false });
  try {
    if (inp.op === 'none') return res(decodeTimerLink(encodeTimerLink(inp.timer)));
    if (inp.op === 'file') return res(decodeTimerText(encodeTimerFile(inp.timer)));
    if (inp.op === 'encodeInvalid') {
      let link: string;
      try {
        link = encodeTimerLink(inp.timer);
      } catch {
        return { ok: false };
      }
      return res(decodeTimerLink(link));
    }
    const link = encodeTimerLink(inp.timer);
    const tampered = execFileSync('python3', ['-I', '-B', tamperPy, inp.op, link], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r?\n$/, '');
    return res(decodeTimerLink(tampered));
  } catch (e) {
    return { threw: true, error: errText(e) };
  }
}

async function emptyDb(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  return db;
}

/** A DB holding exactly these timers and sessions on these ids (an id gap = a row created and deleted again). */
async function libraryDb(lib: { timers: (TimerDef & { id: number; kind?: TimerKind })[]; sessions: InSession[] }): Promise<Db> {
  const db = await emptyDb();
  const holes: number[] = [];
  const timers = [...lib.timers].sort((a, b) => a.id - b.id);
  for (let i = 0; i < timers.length; i++) {
    const t = timers[i];
    for (;;) {
      const id = await createTimer(db, asDef(t), 1_000_000 + i, t.kind ?? 'custom');
      if (id === t.id) break;
      if (id > t.id) throw new Error(`cannot place timer id ${t.id} (got ${id})`);
      holes.push(id);
    }
  }
  for (const id of holes) await deleteTimer(db, id);
  const sHoles: number[] = [];
  const sessions = [...lib.sessions].sort((a, b) => a.id - b.id);
  for (const s of sessions) {
    for (;;) {
      const id = await addSession(db, { timerId: s.timerId, timerName: s.timerName, startedAt: s.startedAt, endedAt: s.endedAt, plannedS: s.plannedS, actualS: s.actualS, completed: s.completed, skippedIntervals: s.skippedIntervals, pauses: s.pauses, interrupted: false, note: s.note });
      if (id === s.id) break;
      if (id > s.id) throw new Error(`cannot place session id ${s.id} (got ${id})`);
      sHoles.push(id);
    }
  }
  for (const id of sHoles) await deleteSession(db, id);
  // check: the library is exactly as given
  const got = await listTimers(db);
  if (got.length !== timers.length || got.some((t) => !timers.find((x) => x.id === t.id && x.name === t.name))) throw new Error('adapter: library timers not placed as given');
  const gotS = await listSessions(db);
  if (gotS.length !== sessions.length || gotS.some((s) => !sessions.find((x) => x.id === s.id && x.timerId === s.timerId))) throw new Error('adapter: library sessions not placed as given');
  return db;
}

async function backupCase(inp: { mode: RestoreMode; current: Parameters<typeof libraryDb>[0]; backup: Parameters<typeof libraryDb>[0] }): Promise<Json> {
  const current = await libraryDb(inp.current);
  const source = await libraryDb(inp.backup);
  const text = await exportBackup(source, 2_000_000);
  const parsed = parseBackup(text);
  if (!parsed.ok) throw new Error(`parseBackup refused the engine's own export: ${parsed.reason}`);
  await restoreBackup(current, parsed.backup, inp.mode);
  const timers = (await listTimers(current)).map((t: Timer) => ({ id: t.id, ...defDump(t) }));
  const sessions = (await listSessions(current)).map((s) => ({ id: s.id, timerId: s.timerId, timerName: s.timerName, startedAt: s.startedAt, endedAt: s.endedAt, plannedS: s.plannedS, actualS: s.actualS, completed: s.completed, skippedIntervals: s.skippedIntervals, pauses: s.pauses, note: s.note }));
  return { timers, sessions };
}

async function seeded(): Promise<Db> {
  const db = await emptyDb();
  await seedTemplatesOnce(db, makeT('en'), 1_000_000);
  return db;
}

const byKeyword = (timers: Timer[], kw: string) => timers.filter((t) => t.name.toLowerCase().includes(kw.toLowerCase()));

async function templatesCase(inp: { keyword: string }): Promise<Json> {
  const db = await seeded();
  const found = byKeyword(await listTimers(db), inp.keyword);
  if (found.length !== 1) throw new Error(`${found.length} seeded templates match "${inp.keyword}": ${found.map((t) => t.name).join(', ')}`);
  return { totalMs: buildTimeline(found[0], opts({ countdownFrom: 3 })).totalMs };
}

async function templateRestoreCase(inp: { deleteKeywords: string[]; renameKeyword: string; renameSuffix: string; editKeyword: string; editFirstIntervalSeconds: number }): Promise<Json> {
  const db = await seeded();
  for (const kw of inp.deleteKeywords) for (const t of byKeyword(await listTimers(db), kw)) await deleteTimer(db, t.id);
  for (const t of byKeyword(await listTimers(db), inp.renameKeyword)) await updateTimer(db, t.id, { ...asDef(t), name: t.name + inp.renameSuffix }, 2_000_000);
  for (const t of byKeyword(await listTimers(db), inp.editKeyword)) {
    const def = asDef(t);
    const blocks = def.blocks.map((b, bi) => (bi === 0 ? { ...b, intervals: b.intervals.map((iv, ii) => (ii === 0 ? { ...iv, seconds: inp.editFirstIntervalSeconds } : iv)) } : b));
    await updateTimer(db, t.id, { ...def, blocks }, 2_000_000);
  }
  await restoreTemplates(db, makeT('en'), 3_000_000);
  return { timers: (await listTimers(db)).map((t) => ({ name: t.name, blocks: defDump(t).blocks })) };
}

// ------------------------------------------------------------------------------------------------ entry point
/** Every case of the set -> `{<id>: output}`; a throwing case -> `{error}` (share: `{threw, error}`). */
export async function runBlind2(dir: string, read: (p: string) => string, list: (d: string) => string[], join: (...p: string[]) => string): Promise<Record<string, Json>> {
  const results: Record<string, Json> = {};
  const tamperPy = join(dir, 'share_tamper.py');
  for (const file of list(join(dir, 'cases')).filter((f) => f.endsWith('.json')).sort()) {
    const cases = JSON.parse(read(join(dir, 'cases', file))) as Case[];
    for (const c of cases) {
      const inp = c.input as never;
      try {
        switch (c.family) {
          case 'timeline': {
            const raw = JSON.parse(read(join(dir, c.timerFile!))) as { timer: TimerDef; settings?: Settings; nextAt?: number[] };
            let t = buildTimeline(raw.timer, opts(raw.settings));
            for (const at of raw.nextAt ?? []) t = rebase(t, at);
            results[c.id] = timelineDump(t);
            break;
          }
          case 'format':
            results[c.id] = formatDuration((inp as { seconds: number }).seconds);
            break;
          case 'validation':
            results[c.id] = { valid: validateTimer((inp as { timer: TimerDef }).timer).length === 0 };
            break;
          case 'clamp':
            results[c.id] = clampName((inp as { input: string }).input);
            break;
          case 'runner':
            results[c.id] = runnerCase(inp);
            break;
          case 'recovery':
            results[c.id] = recoveryCase(inp);
            break;
          case 'cuesBetween': {
            const i = inp as { timer: TimerDef; settings: Settings; frm: number; to: number };
            results[c.id] = cuesBetween(buildTimeline(i.timer, opts(i.settings)), i.frm, i.to).map(cueDump);
            break;
          }
          case 'nextCueAfter': {
            const i = inp as { timer: TimerDef; settings: Settings; after: number };
            results[c.id] = nextCueDump(buildTimeline(i.timer, opts(i.settings)), i.after);
            break;
          }
          case 'backup':
            results[c.id] = await backupCase(inp);
            break;
          case 'csv':
            results[c.id] = toCsv((inp as { sessions: InSession[] }).sessions.map((s) => ({ ...s, interrupted: false })));
            break;
          case 'share':
            results[c.id] = shareCase(inp, tamperPy);
            break;
          case 'statsKeys': {
            const i = inp as { atMs: number; tz: string };
            results[c.id] = withTz(i.tz, () => ({ day: dayKey(i.atMs), week: isoWeekKey(i.atMs), month: monthKey(i.atMs) }));
            break;
          }
          case 'statsTotals': {
            const i = inp as { tz: string; period: 'day' | 'week' | 'month'; sessions: MiniSession[] };
            results[c.id] = withTz(i.tz, () => Object.fromEntries(buckets(i.sessions.map(statsSession), i.period).map((b) => [b.key, { count: b.totals.sessions, actualS: b.totals.actualS }])));
            break;
          }
          case 'streak': {
            const i = inp as { tz: string; nowMs: number; sessions: MiniSession[] };
            results[c.id] = withTz(i.tz, () => streak(i.sessions.map(statsSession), i.nowMs));
            break;
          }
          case 'templates':
            results[c.id] = await templatesCase(inp);
            break;
          case 'templateRestore':
            results[c.id] = await templateRestoreCase(inp);
            break;
          default:
            results[c.id] = { error: `adapter: unknown family ${c.family}` };
        }
      } catch (err) {
        results[c.id] = c.family === 'share' ? { threw: true, error: errText(err) } : { error: errText(err) };
      }
    }
  }
  return results;
}
