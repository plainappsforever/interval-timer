// Backup file (SPEC §5.6, breathe D48 pattern): every timer, session and setting in one JSON; restore merges by id with
// "replace" or "keep both". Pure: the database side is src/db/backup.ts.
import type { Settings } from '@/db/settings';
import type { Session } from '@/db/sessions';

import type { Timer, TimerDef, TimerKind } from './model';
import { fromWire, SHARE_VERSION, toWire } from './share-codec';

export const BACKUP_FORMAT = 'plainintervals-backup';
export const BACKUP_VERSION = 1;

export type BackupTimer = { id: number; kind: TimerKind; createdAt: number; updatedAt: number; lastUsedAt: number | null; sortIndex: number; timer: ReturnType<typeof toWire> };
export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  timers: BackupTimer[];
  sessions: Session[];
  settings: Partial<Settings>;
};

/** Settings that travel in a backup (device/runtime state stays: recovery, last timer, seeding flags, voice id). */
const PORTABLE_SETTINGS: (keyof Settings)[] = ['language', 'theme', 'keepScreenOn', 'voiceEnabled', 'beepSet', 'volume', 'haptics', 'liveActivity', 'countdownFrom', 'halfwayDefault', 'respectSilent'];

export function buildBackup(timers: Timer[], sessions: Session[], settings: Settings, exportedAt = Date.now()): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    timers: timers.map((t) => ({ id: t.id, kind: t.kind, createdAt: t.createdAt, updatedAt: t.updatedAt, lastUsedAt: t.lastUsedAt, sortIndex: t.sortIndex, timer: toWire(t) })),
    // oldest first, so a restore on a fresh install recreates them in their original order (and ids)
    sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id),
    settings: Object.fromEntries(PORTABLE_SETTINGS.map((k) => [k, settings[k]])) as Partial<Settings>,
  };
}

export function encodeBackup(b: Backup): string {
  return JSON.stringify(b, null, 2);
}

export type ParsedTimer = { id: number; kind: TimerKind; createdAt: number; updatedAt: number; lastUsedAt: number | null; sortIndex: number; def: TimerDef };
export type ParsedBackup = { exportedAt: number; timers: ParsedTimer[]; sessions: Omit<Session, 'id'>[]; settings: Partial<Settings>; skippedTimers: number; skippedSessions: number };
export type ParseBackupResult = { ok: true; backup: ParsedBackup } | { ok: false; reason: 'format' | 'version' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Strict, never throws: a damaged timer or session is skipped (counted), not fatal. */
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, reason: 'format' };
  if (int(raw.version, 0) !== BACKUP_VERSION) return { ok: false, reason: 'version' };
  const timers: ParsedTimer[] = [];
  let skippedTimers = 0;
  for (const t of Array.isArray(raw.timers) ? raw.timers : []) {
    if (!isObj(t) || !Number.isInteger(t.id) || (t.id as number) <= 0) {
      skippedTimers++;
      continue;
    }
    const wire = isObj(t.timer) ? { ...t.timer, v: int((t.timer as Record<string, unknown>).v, SHARE_VERSION) } : null;
    const decoded = wire ? fromWire(wire) : null;
    if (!decoded || !decoded.ok) {
      skippedTimers++;
      continue;
    }
    timers.push({
      id: t.id as number,
      kind: t.kind === 'template' ? 'template' : 'custom',
      createdAt: int(t.createdAt, 0),
      updatedAt: int(t.updatedAt, 0),
      lastUsedAt: t.lastUsedAt === null || t.lastUsedAt === undefined ? null : int(t.lastUsedAt, 0),
      sortIndex: int(t.sortIndex, 0),
      def: decoded.def,
    });
  }
  const sessions: Omit<Session, 'id'>[] = [];
  let skippedSessions = 0;
  for (const s of Array.isArray(raw.sessions) ? raw.sessions : []) {
    if (!isObj(s) || typeof s.timerName !== 'string' || !Number.isFinite(s.startedAt) || !Number.isFinite(s.endedAt)) {
      skippedSessions++;
      continue;
    }
    sessions.push({
      timerId: Number.isInteger(s.timerId) && (s.timerId as number) > 0 ? (s.timerId as number) : null,
      timerName: s.timerName.slice(0, 200),
      startedAt: int(s.startedAt, 0),
      endedAt: int(s.endedAt, 0),
      plannedS: s.plannedS === null || s.plannedS === undefined ? null : Math.max(0, int(s.plannedS, 0)),
      actualS: Math.max(0, int(s.actualS, 0)),
      completed: bool(s.completed, false),
      skippedIntervals: Math.max(0, int(s.skippedIntervals, 0)),
      pauses: Math.max(0, int(s.pauses, 0)),
      interrupted: bool(s.interrupted, false),
      note: typeof s.note === 'string' ? s.note.slice(0, 2000) : '',
    });
  }
  const settings: Partial<Settings> = {};
  if (isObj(raw.settings)) for (const k of PORTABLE_SETTINGS) if (k in raw.settings) (settings as Record<string, unknown>)[k] = raw.settings[k];
  return { ok: true, backup: { exportedAt: int(raw.exportedAt, 0), timers, sessions, settings, skippedTimers, skippedSessions } };
}

export type RestoreMode = 'replace' | 'keepBoth';
export type RestorePlan = {
  /** Timers to write with their backup id (replace an existing timer with the same id, or create it under that id). */
  replace: ParsedTimer[];
  /** Timers to create as new rows (id collision under keepBoth). */
  create: ParsedTimer[];
  /** Timers whose id is free: created under their backup id in both modes. */
  insertWithId: ParsedTimer[];
  /** keepBoth only: the timer under the same id is IDENTICAL (same kind and definition) — kept once, nothing written;
   *  the backup's sessions of that timer attach to it (D35). */
  identical: ParsedTimer[];
  /** Sessions to add (duplicates — same start, end and name as an existing session — are skipped). */
  sessions: Omit<Session, 'id'>[];
  skippedDuplicateSessions: number;
};

/** A timer already in the database, as far as the restore plan needs it. */
export type ExistingTimer = TimerDef & { id: number; kind: TimerKind };

/** Same kind and the same definition in the share codec's canonical form (bookkeeping fields do not count). */
function sameTimer(a: ExistingTimer, b: ParsedTimer): boolean {
  return a.kind === b.kind && JSON.stringify(toWire(a)) === JSON.stringify(toWire(b.def));
}

/** Merge by id: an id that exists is replaced or kept as a second copy — unless, under keep both, the existing timer
 *  is identical, then it is kept once (D35); free ids are restored as they were. */
export function planRestore(backup: ParsedBackup, existing: ExistingTimer[], existingSessions: Pick<Session, 'timerName' | 'startedAt' | 'endedAt'>[], mode: RestoreMode): RestorePlan {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const seen = new Set(existingSessions.map((s) => `${s.startedAt}|${s.endedAt}|${s.timerName}`));
  const plan: RestorePlan = { replace: [], create: [], insertWithId: [], identical: [], sessions: [], skippedDuplicateSessions: 0 };
  for (const t of backup.timers) {
    const cur = byId.get(t.id);
    if (!cur) plan.insertWithId.push(t);
    else if (mode === 'replace') plan.replace.push(t);
    else if (sameTimer(cur, t)) plan.identical.push(t);
    else plan.create.push(t);
  }
  for (const s of backup.sessions) {
    const key = `${s.startedAt}|${s.endedAt}|${s.timerName}`;
    if (seen.has(key)) {
      plan.skippedDuplicateSessions++;
      continue;
    }
    seen.add(key);
    plan.sessions.push(s);
  }
  return plan;
}
