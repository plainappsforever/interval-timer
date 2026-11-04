// Adapter for a BLIND fixture set written by a separate agent (SPEC §13 O1, P3a/P3b): maps the keys that set's own
// README documents onto the engine's calls, and the engine's outputs onto that README's dump format. Lives outside
// src/engine so adding it does not change the engine snapshot that is measured. Written in P3b (2026-10-16) for
// intervals-b1, BEFORE the single run, from the set's README ("Input schemas", "Dump interface", "Backup procedure").
// It never computes an expected value and never repairs an engine result; where the engine has no matching call the
// mapping used is listed in ADAPTER_NOTES (and in docs/blind-1-first-run.txt).
// P4b (2026-10-16, after the measured run): the runner and stats mappings now call engine API (D33/D34) instead of
// adapter-side choices — `apply`/`view` (start only from idle, natural end on every read) and the engine's ISO week /
// YYYY-MM bucket keys. B1 is a tuning set from here on (L27).
// Run: node --import ./scripts/node/ts-hooks.mjs scripts/blind-dump.mjs <set folder> <dump.json>
import { exportBackup, restoreBackup } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addSession, deleteSession, listSessions, type Session, type SessionInput } from '@/db/sessions';
import { getSetting, setSetting, type Settings } from '@/db/settings';
import { createTimer, deleteTimer, listTimers, updateTimer } from '@/db/timers';
import type { Db } from '@/db/types';
import { parseBackup, type RestoreMode } from '@/engine/backup';
import { decodeText, encodeText } from '@/engine/base64url';
import { toCsv } from '@/engine/csv';
import { formatDuration } from '@/engine/format';
import type { BlockDef, TimerDef } from '@/engine/model';
import { evaluateRecovery, parseRecovery, RECOVERY_VERSION, recoveredTimeline, restoreRunner } from '@/engine/recovery';
import * as R from '@/engine/runner';
import { buildTimeline, cuesBetween, locate, rebase, type Timeline } from '@/engine/schedule';
import { decodeTimerLink, decodeTimerText, encodeTimerFile, encodeTimerLink } from '@/engine/share-codec';
import { buckets, longestStreak, mostUsed, streak, totals } from '@/engine/stats';
import { plannedSeconds, validateTimer } from '@/engine/validation';

import { createTestDb } from './node-sqlite-db';
import { loadDevSet, type Fixture } from './timeline-score';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = Record<string, unknown>;
type CountdownFrom = 3 | 5 | 10;
type IndexEntry = { id: string; family: string; input: string; expected: string };

export const ADAPTER_NOTES = [
  'timeline: buildTimeline(timer, {countdownFrom, language: en, voiceId: null}) then rebase(t, at) per nextAt (as test/timeline-score.ts).',
  'cuesBetween: cuesBetween(buildTimeline(timer, settings), from, to) per window; kind/atMs/text of every returned cue.',
  'runner: one RunnerState from idle(buildTimeline(...)); every op except probe = apply(s, op, t) (the engine\'s single entry point: start only leaves idle, every transition settles the natural end first, D33); probe = no transition. Step values read through view(s, t) (natural end applied): status, elapsedMs, location.index / .remainingMs; timeline.totalMs.',
  'recovery: the README record is mapped onto RecoveryRecord (startedAtWallMs -> startedAtWall, savedAtWallMs -> writtenAtWall, baseWallMs -> baseWallMs or null, state -> status; events next -> {kind: next}, addTime -> {kind: extend, index: segment at atElapsedMs on the timeline with the earlier events replayed, deltaMs: 30000}); parseRecovery(record) null (state ended/idle) -> decision none; evaluateRecovery outcome resume -> resume (segmentIndex from restoreRunner), finished+completed -> finished, finished+!completed -> partial, discard -> none.',
  'validation: validateTimer issue keys validation.<x> -> rule <x>; validation.noIntervals -> "blocks" when its path is "blocks", else "intervals"; keys without a README rule id (prep, repeat, restBetweenRounds, openTick) are dumped under their own name.',
  'format: duration = formatDuration(seconds) (the engine takes no language: Western digits everywhere); blockTotal = plannedSeconds of a one-block timer with prep 0 and repeat 1 (the engine has no block-total function; plannedSeconds sums exactly this per block) + formatDuration; timerTotal = buildTimeline(...).totalMs and formatDuration(plannedSeconds(timer)) (what describeTimer shows).',
  'share: link = encodeTimerLink, linkTimer = decodeTimerLink(link).def, fileTimer = decodeTimerText(encodeTimerFile(timer)).def; payload edits for unknownField/tamper use the engine\'s own base64url (decodeText/encodeText) and re-import with decodeTimerLink.',
  'stats: process.env.TZ = zone for the call; sessions get id = position + 1, timerId null, interrupted false; totals(), buckets(day/week/month), streak(nowMs), longestStreak(), mostUsed() (default limit 5). Bucket keys = the engine\'s own keys (day YYYY-MM-DD, week ISO YYYY-Www, month YYYY-MM; D34). topTimer = mostUsed()[0].timerName.',
  'csv: toCsv(sessions) with id = position + 1, timerId null, interrupted false.',
  'backup: createTestDb() + migrate() (no seeding); initial timers via createTimer(db, def, now = 1 000 000 + position); initial sessions via addSession with timerId = the live timer with the same name (null when none), interrupted false; export = exportBackup(db, 2 000 000); mutations editTimer -> updateTimer, deleteTimer -> deleteTimer, addTimer -> createTimer, addSession -> addSession (timerId by name), deleteSession -> deleteSession; restore = parseBackup(text) then restoreBackup(db, backup, mode); ok = parse ok and restore did not throw. settings: SPEC §4 snake_case names -> Settings camelCase keys, setSetting before the export, getSetting after the restore.',
];

// ------------------------------------------------------------------------------------------------ helpers
const opts = (cf: CountdownFrom) => ({ countdownFrom: cf, language: 'en' as const, voiceId: null });
const cfOf = (settings: unknown): CountdownFrom => (settings as { countdownFrom?: CountdownFrom } | undefined)?.countdownFrom ?? 3;

function timelineDump(t: Timeline): Json {
  return {
    totalMs: t.totalMs,
    segments: t.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, type: s.type, label: s.label })),
    cues: t.cues.map((c) => ({ atMs: c.atMs, kind: c.kind, text: c.text })),
  };
}

function defDump(d: TimerDef): Json {
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

function sessionDump(s: Session): Json {
  return { timerName: s.timerName, startedAt: s.startedAt, endedAt: s.endedAt, plannedS: s.plannedS, actualS: s.actualS, completed: s.completed, skippedIntervals: s.skippedIntervals, pauses: s.pauses, note: s.note };
}

type InSession = { timerName: string; startedAt: number; endedAt: number; plannedS: number | null; actualS: number; completed: boolean; skippedIntervals: number; pauses: number; note: string };
const toSession = (s: InSession, i: number): Session => ({ id: i + 1, timerId: null, interrupted: false, ...s });

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// ------------------------------------------------------------------------------------------------ families
function timelineCase(inp: { timer: TimerDef; settings?: unknown; nextAt?: number[] }): Json {
  let t = buildTimeline(inp.timer, opts(cfOf(inp.settings)));
  for (const at of inp.nextAt ?? []) t = rebase(t, at);
  return timelineDump(t);
}

function cuesBetweenCase(inp: { timer: TimerDef; settings: unknown; windows: [number, number][] }): Json {
  const t = buildTimeline(inp.timer, opts(cfOf(inp.settings)));
  return { windows: inp.windows.map(([a, b]) => cuesBetween(t, a, b).map((c) => ({ atMs: c.atMs, kind: c.kind, text: c.text }))) };
}

function runnerCase(inp: { timer: TimerDef; settings: unknown; script: { t: number; op: string }[] }): Json {
  let s = R.idle(buildTimeline(inp.timer, opts(cfOf(inp.settings))));
  const steps: Json[] = [];
  const ops: readonly string[] = ['start', 'pause', 'resume', 'skip', 'back', 'addTime', 'end', 'next'];
  for (const { t, op } of inp.script) {
    if (ops.includes(op)) s = R.apply(s, op as R.RunnerAction, t);
    else if (op !== 'probe') throw new Error(`unknown runner op ${op}`);
    const v = R.view(s, t);
    steps.push({ state: v.status, elapsedMs: v.elapsedMs, segmentIndex: v.location ? v.location.index : null, remainingMs: v.location ? v.location.remainingMs : null, totalMs: s.timeline.totalMs });
  }
  return { steps, timeline: timelineDump(s.timeline) };
}

type InRecord = { state: string; startedAtWallMs: number; savedAtWallMs: number; elapsedMs: number; baseWallMs?: number; events: { op: 'next' | 'addTime'; atElapsedMs: number }[] };

function recoveryCase(inp: { timer: TimerDef; settings: unknown; record: InRecord; nowWallMs: number }): Json {
  const base = buildTimeline(inp.timer, opts(cfOf(inp.settings)));
  const events: R.TimelineEvent[] = [];
  let replay = base;
  for (const ev of inp.record.events) {
    const e: R.TimelineEvent = ev.op === 'next' ? { kind: 'next', atElapsedMs: ev.atElapsedMs } : { kind: 'extend', index: locate(replay, ev.atElapsedMs)?.index ?? 0, deltaMs: R.ADD_TIME_MS };
    events.push(e);
    replay = R.replayEvents(replay, [e]);
  }
  const raw = {
    version: RECOVERY_VERSION,
    timerId: 1,
    timerName: inp.timer.name,
    def: inp.timer,
    options: base.options,
    startedAtWall: inp.record.startedAtWallMs,
    baseWallMs: inp.record.baseWallMs ?? null,
    status: inp.record.state,
    elapsedMs: inp.record.elapsedMs,
    writtenAtWall: inp.record.savedAtWallMs,
    segmentIndex: locate(replay, inp.record.elapsedMs)?.index ?? 0,
    pauses: 0,
    skipped: 0,
    addedMs: events.filter((e) => e.kind === 'extend').length * R.ADD_TIME_MS,
    events,
    interrupted: false,
  };
  const record = parseRecovery(raw);
  if (!record) return { decision: 'none', engine: 'parseRecovery: no record for this state' };
  const outcome = evaluateRecovery(record, inp.nowWallMs);
  if (outcome.status === 'discard') return { decision: 'none', engine: 'discard' };
  if (outcome.status === 'finished') return { decision: outcome.completed ? 'finished' : 'partial', elapsedMs: outcome.elapsedMs, completed: outcome.completed };
  const state = restoreRunner(record, outcome, 0);
  return { decision: 'resume', elapsedMs: outcome.elapsedMs, segmentIndex: state.segmentIndex, recoveredTotalMs: recoveredTimeline(record).totalMs };
}

function validationCase(inp: { timer: TimerDef }): Json {
  const issues = validateTimer(inp.timer);
  const rules = issues.map((i) => {
    const k = i.key.replace(/^validation\./, '');
    if (k === 'noIntervals') return i.path === 'blocks' ? 'blocks' : 'intervals';
    return k;
  });
  return { valid: issues.length === 0, rules: [...new Set(rules)], issues: issues.map((i) => `${i.key}@${i.path}`) };
}

function formatCase(inp: { op: string; seconds?: number; lang?: string; block?: BlockDef; timer?: TimerDef }): Json {
  if (inp.op === 'duration') return { text: formatDuration(inp.seconds!) };
  if (inp.op === 'blockTotal') {
    const seconds = plannedSeconds({ name: '', color: '', notes: '', blocks: [inp.block!], prefs: { prepSeconds: 0, endCue: 'both', repeatWhole: 1, vibrate: true } });
    return { seconds, text: formatDuration(seconds) };
  }
  if (inp.op === 'timerTotal') return { totalMs: buildTimeline(inp.timer!, opts(3)).totalMs, text: formatDuration(plannedSeconds(inp.timer!)) };
  throw new Error(`unknown format op ${inp.op}`);
}

/** prefix up to and including `d=`, the payload (up to & or #), the rest. */
const LINK_PAYLOAD = /^(.*?[?&]d=)([^&#]*)(.*)$/;

function editPayload(link: string, edit: (json: string) => string): string {
  const m = LINK_PAYLOAD.exec(link);
  if (!m) throw new Error('link has no d= payload');
  return m[1] + encodeText(edit(decodeText(decodeURIComponent(m[2])))) + m[3];
}

function shareCase(inp: { op: string; timer?: TimerDef; find?: string; replace?: string; links?: string[] }): Json {
  if (inp.op === 'roundtrip') {
    const link = encodeTimerLink(inp.timer!);
    const l = decodeTimerLink(link);
    const f = decodeTimerText(encodeTimerFile(inp.timer!));
    return { link, linkTimer: l.ok ? defDump(l.def) : { failed: l.reason }, fileTimer: f.ok ? defDump(f.def) : { failed: f.reason } };
  }
  if (inp.op === 'unknownField') {
    const link = editPayload(encodeTimerLink(inp.timer!), (text) => {
      const obj: unknown = JSON.parse(text);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) (obj as Obj).zz_b1_unknown = { a: [1, 2, 3] };
      return JSON.stringify(obj);
    });
    const r = decodeTimerLink(link);
    return { ok: r.ok, timer: r.ok ? defDump(r.def) : { failed: r.reason } };
  }
  if (inp.op === 'tamper') {
    let markerCount = 0;
    const link = editPayload(encodeTimerLink(inp.timer!), (text) => {
      markerCount = text.split(inp.find!).length - 1;
      return text.split(inp.find!).join(inp.replace!);
    });
    const r = decodeTimerLink(link);
    return { ok: r.ok, markerCount };
  }
  if (inp.op === 'import') {
    return {
      ok: inp.links!.map((l) => {
        try {
          return decodeTimerLink(l).ok;
        } catch (e) {
          return `threw: ${errText(e)}`;
        }
      }),
    };
  }
  throw new Error(`unknown share op ${inp.op}`);
}

function statsCase(inp: { zone: string; nowMs: number; sessions: InSession[] }): Json {
  const prevTz = process.env.TZ;
  process.env.TZ = inp.zone;
  try {
    const sessions = inp.sessions.map(toSession);
    const all = totals(sessions);
    const map = (unit: 'day' | 'week' | 'month') => {
      const out: Record<string, Json> = {};
      for (const b of buckets(sessions, unit)) out[b.key] = { sessions: b.totals.sessions, actualS: b.totals.actualS };
      return out;
    };
    const used = mostUsed(sessions);
    return {
      sessions: all.sessions,
      completedSessions: all.completed,
      actualS: all.actualS,
      plannedS: all.plannedS,
      perDay: map('day'),
      perWeek: map('week'),
      perMonth: map('month'),
      streakCurrent: streak(sessions, inp.nowMs),
      streakLongest: longestStreak(sessions),
      mostUsed: Object.fromEntries(used.map((u) => [u.timerName, u.sessions])),
      topTimer: used[0]?.timerName ?? null,
    };
  } finally {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  }
}

function csvCase(inp: { sessions: InSession[] }): Json {
  return { csv: toCsv(inp.sessions.map(toSession)) };
}

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof Settings;

type BackupInput = {
  initial: { timers: TimerDef[]; sessions: InSession[] };
  mutations?: ({ op: 'editTimer'; ref: number; timer: TimerDef } | { op: 'deleteTimer'; ref: number } | { op: 'addTimer'; timer: TimerDef } | { op: 'addSession'; session: InSession } | { op: 'deleteSession'; ref: number })[];
  mode: RestoreMode;
  fresh?: boolean;
  settings?: Record<string, unknown>;
  hostile?: { kind: 'truncate-half' } | { kind: 'raw'; text: string };
};

async function emptyDb(): Promise<Db> {
  const db = createTestDb();
  await migrate(db);
  return db;
}

async function timerIdByName(db: Db, name: string): Promise<number | null> {
  return (await listTimers(db)).find((t) => t.name === name)?.id ?? null;
}

async function backupCase(inp: BackupInput): Promise<Json> {
  let db = await emptyDb();
  const timerIds: number[] = [];
  for (let i = 0; i < inp.initial.timers.length; i++) timerIds.push(await createTimer(db, inp.initial.timers[i], 1_000_000 + i));
  const sessionIds: number[] = [];
  for (const s of inp.initial.sessions) {
    const row: SessionInput = { ...s, timerId: await timerIdByName(db, s.timerName), interrupted: false };
    sessionIds.push(await addSession(db, row));
  }
  if (inp.settings) for (const [k, v] of Object.entries(inp.settings)) await setSetting(db, camel(k), v as never);
  const exported = await exportBackup(db, 2_000_000);
  let now = 3_000_000;
  for (const m of inp.mutations ?? []) {
    if (m.op === 'editTimer') await updateTimer(db, timerIds[m.ref], m.timer, now++);
    else if (m.op === 'deleteTimer') await deleteTimer(db, timerIds[m.ref]);
    else if (m.op === 'addTimer') await createTimer(db, m.timer, now++);
    else if (m.op === 'addSession') await addSession(db, { ...m.session, timerId: await timerIdByName(db, m.session.timerName), interrupted: false });
    else if (m.op === 'deleteSession') await deleteSession(db, sessionIds[m.ref]);
  }
  if (inp.fresh) db = await emptyDb();
  const text = !inp.hostile ? exported : inp.hostile.kind === 'truncate-half' ? exported.slice(0, Math.floor(exported.length / 2)) : inp.hostile.text;
  let ok = false;
  let note: string | null = null;
  const parsed = parseBackup(text);
  if (parsed.ok) {
    try {
      await restoreBackup(db, parsed.backup, inp.mode);
      ok = true;
    } catch (e) {
      note = `restore threw: ${errText(e)}`;
    }
  } else note = `parseBackup refused: ${parsed.reason}`;
  const out: Record<string, Json> = {
    ok,
    note,
    timers: (await listTimers(db)).map((t) => defDump(t)),
    sessions: (await listSessions(db)).map(sessionDump),
  };
  if (inp.settings) {
    const st: Record<string, Json> = {};
    for (const k of Object.keys(inp.settings)) st[k] = (await getSetting(db, camel(k))) as Json;
    out.settings = st;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ entry points
/** Every case of the set in its README dump format: `{engine, results: {<id>: output}}`. A throwing case is dumped as `{error}`. */
export async function dumpBlind(dir: string, read: (p: string) => string, join: (...p: string[]) => string, engine: string): Promise<{ engine: string; notes: string[]; results: Record<string, Json> }> {
  const index = (JSON.parse(read(join(dir, 'index.json'))) as { cases: IndexEntry[] }).cases;
  const results: Record<string, Json> = {};
  for (const e of index) {
    const file = JSON.parse(read(join(dir, e.input))) as Obj;
    const inp = (e.family === 'timeline' ? file : file.input) as never;
    try {
      if (e.family === 'timeline') results[e.id] = timelineCase(inp);
      else if (e.family === 'cuesBetween') results[e.id] = cuesBetweenCase(inp);
      else if (e.family === 'runner') results[e.id] = runnerCase(inp);
      else if (e.family === 'recovery') results[e.id] = recoveryCase(inp);
      else if (e.family === 'validation') results[e.id] = validationCase(inp);
      else if (e.family === 'format') results[e.id] = formatCase(inp);
      else if (e.family === 'share') results[e.id] = shareCase(inp);
      else if (e.family === 'stats') results[e.id] = statsCase(inp);
      else if (e.family === 'csv') results[e.id] = csvCase(inp);
      else if (e.family === 'backup') results[e.id] = await backupCase(inp);
      else results[e.id] = { error: `unknown family ${e.family}` };
    } catch (err) {
      results[e.id] = { error: errText(err) };
    }
  }
  return { engine, notes: ADAPTER_NOTES, results };
}

/** For `npm run blind <folder>` on a set without timers/ + expected/; intervals-b1 has them (FORMAT.md layout). */
export function loadBlind(dir: string, read: (p: string) => string, list: (d: string) => string[], join: (...p: string[]) => string): Fixture[] {
  return loadDevSet(dir, read, list, join);
}
