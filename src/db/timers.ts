// Timers with their blocks and intervals (SPEC §4). One write unit per operation; the tree is replaced wholesale on
// update (an editor saves the whole timer). Reads assemble the tree in JS from three queries, so listing 500 timers
// stays three statements (A9).
import type { BlockDef, CueMode, IntervalDef, IntervalType, Timer, TimerDef, TimerKind, TimerPrefs } from '@/engine/model';
import { DEFAULT_PREFS } from '@/engine/model';

import { withRead, withTransaction, withWrite } from './tx';
import type { Db } from './types';

type TimerRow = {
  id: number;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  sort_index: number;
  kind: TimerKind;
  notes: string;
};
type BlockRow = { id: number; timer_id: number; sort_index: number; name: string; rounds: number; rest_between_rounds_s: number };
type IntervalRow = {
  id: number;
  block_id: number;
  sort_index: number;
  name: string;
  seconds: number;
  type: IntervalType;
  color: string;
  cue_start: CueMode;
  halfway_cue: number;
  countdown_cue: number;
  open_tick_s: number;
};
type PrefsRow = { timer_id: number; prep_seconds: number; end_cue: CueMode; repeat_whole: number; vibrate: number };

const TIMER_COLUMNS = 'id, name, color, created_at, updated_at, last_used_at, sort_index, kind, notes';

function assemble(timers: TimerRow[], blocks: BlockRow[], intervals: IntervalRow[], prefs: PrefsRow[]): Timer[] {
  const intervalsByBlock = new Map<number, IntervalDef[]>();
  for (const r of intervals) {
    const list = intervalsByBlock.get(r.block_id) ?? [];
    list.push({
      name: r.name,
      seconds: r.seconds,
      type: r.type,
      color: r.color,
      cueStart: r.cue_start,
      halfwayCue: r.halfway_cue === 1,
      countdownCue: r.countdown_cue === 1,
      openTickS: r.open_tick_s,
    });
    intervalsByBlock.set(r.block_id, list);
  }
  const blocksByTimer = new Map<number, BlockDef[]>();
  for (const r of blocks) {
    const list = blocksByTimer.get(r.timer_id) ?? [];
    list.push({ name: r.name, rounds: r.rounds, restBetweenRoundsS: r.rest_between_rounds_s, intervals: intervalsByBlock.get(r.id) ?? [] });
    blocksByTimer.set(r.timer_id, list);
  }
  const prefsByTimer = new Map<number, TimerPrefs>();
  for (const r of prefs) {
    prefsByTimer.set(r.timer_id, { prepSeconds: r.prep_seconds, endCue: r.end_cue, repeatWhole: r.repeat_whole, vibrate: r.vibrate === 1 });
  }
  return timers.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    notes: t.notes,
    kind: t.kind,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    lastUsedAt: t.last_used_at,
    sortIndex: t.sort_index,
    blocks: blocksByTimer.get(t.id) ?? [],
    prefs: prefsByTimer.get(t.id) ?? { ...DEFAULT_PREFS },
  }));
}

async function loadTree(r: Db, where: string, ...params: (number | string)[]): Promise<Timer[]> {
  const timers = await r.getAllAsync<TimerRow>(`SELECT ${TIMER_COLUMNS} FROM timers ${where} ORDER BY sort_index, id`, ...params);
  if (timers.length === 0) return [];
  const sub = `SELECT id FROM timers ${where}`;
  const blocks = await r.getAllAsync<BlockRow>(`SELECT * FROM blocks WHERE timer_id IN (${sub}) ORDER BY timer_id, sort_index, id`, ...params);
  const intervals = await r.getAllAsync<IntervalRow>(
    `SELECT * FROM intervals WHERE block_id IN (SELECT id FROM blocks WHERE timer_id IN (${sub})) ORDER BY block_id, sort_index, id`,
    ...params
  );
  const prefs = await r.getAllAsync<PrefsRow>(`SELECT * FROM timer_prefs WHERE timer_id IN (${sub})`, ...params);
  return assemble(timers, blocks, intervals, prefs);
}

/** Every saved timer with its blocks, intervals and prefs, in list order (sort_index, then id). */
export function listTimers(db: Db): Promise<Timer[]> {
  return withRead(db, (r) => loadTree(r, ''));
}

export async function getTimer(db: Db, id: number): Promise<Timer | null> {
  const rows = await withRead(db, (r) => loadTree(r, 'WHERE id = ?', id));
  return rows[0] ?? null;
}

/** The timer with the newest `last_used_at`, else the first in list order (the home screen's big Start button). */
export async function lastUsedTimer(db: Db): Promise<Timer | null> {
  const row = await withRead(db, (r) =>
    r.getFirstAsync<{ id: number }>('SELECT id FROM timers ORDER BY last_used_at IS NULL, last_used_at DESC, sort_index, id LIMIT 1')
  );
  return row ? getTimer(db, row.id) : null;
}

async function insertTree(tx: Db, timerId: number, def: TimerDef): Promise<void> {
  for (let b = 0; b < def.blocks.length; b++) {
    const blockDef = def.blocks[b];
    const inserted = await tx.runAsync(
      'INSERT INTO blocks (timer_id, sort_index, name, rounds, rest_between_rounds_s) VALUES (?, ?, ?, ?, ?)',
      timerId,
      b,
      blockDef.name,
      blockDef.rounds,
      blockDef.restBetweenRoundsS
    );
    const blockId = inserted.lastInsertRowId;
    for (let i = 0; i < blockDef.intervals.length; i++) {
      const iv = blockDef.intervals[i];
      await tx.runAsync(
        'INSERT INTO intervals (block_id, sort_index, name, seconds, type, color, cue_start, halfway_cue, countdown_cue, open_tick_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        blockId,
        i,
        iv.name,
        iv.seconds,
        iv.type,
        iv.color,
        iv.cueStart,
        iv.halfwayCue ? 1 : 0,
        iv.countdownCue ? 1 : 0,
        iv.openTickS
      );
    }
  }
  await tx.runAsync(
    'INSERT INTO timer_prefs (timer_id, prep_seconds, end_cue, repeat_whole, vibrate) VALUES (?, ?, ?, ?, ?)',
    timerId,
    def.prefs.prepSeconds,
    def.prefs.endCue,
    def.prefs.repeatWhole,
    def.prefs.vibrate ? 1 : 0
  );
}

async function deleteTree(tx: Db, timerId: number): Promise<void> {
  await tx.runAsync('DELETE FROM intervals WHERE block_id IN (SELECT id FROM blocks WHERE timer_id = ?)', timerId);
  await tx.runAsync('DELETE FROM blocks WHERE timer_id = ?', timerId);
  await tx.runAsync('DELETE FROM timer_prefs WHERE timer_id = ?', timerId);
}

/** Saves a new timer (timer row, blocks, intervals, prefs) in one transaction; it goes to the end of the list. */
export function createTimer(db: Db, def: TimerDef, now = Date.now(), kind: TimerKind = 'custom'): Promise<number> {
  return withTransaction(db, async (tx) => {
    const next = await tx.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(sort_index), -1) + 1 AS n FROM timers');
    const inserted = await tx.runAsync(
      'INSERT INTO timers (name, color, created_at, updated_at, last_used_at, sort_index, kind, notes) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      def.name,
      def.color,
      now,
      now,
      next?.n ?? 0,
      kind,
      def.notes
    );
    await insertTree(tx, inserted.lastInsertRowId, def);
    return inserted.lastInsertRowId;
  });
}

/** Replaces name, colour, notes, blocks, intervals and prefs; keeps id, kind, list position and usage. */
export function updateTimer(db: Db, id: number, def: TimerDef, now = Date.now()): Promise<void> {
  return withTransaction(db, async (tx) => {
    const changed = await tx.runAsync('UPDATE timers SET name = ?, color = ?, notes = ?, updated_at = ? WHERE id = ?', def.name, def.color, def.notes, now, id);
    if (changed.changes === 0) throw new Error(`timer ${id} not found`);
    await deleteTree(tx, id);
    await insertTree(tx, id, def);
  });
}

/** Deletes the timer and its tree. Sessions keep their `timer_name`; their `timer_id` becomes NULL (SPEC §9). */
export function deleteTimer(db: Db, id: number): Promise<void> {
  return withTransaction(db, async (tx) => {
    await tx.runAsync('UPDATE sessions SET timer_id = NULL WHERE timer_id = ?', id);
    await deleteTree(tx, id);
    await tx.runAsync('DELETE FROM timers WHERE id = ?', id);
  });
}

/** A copy (always kind 'custom') placed right after the original. */
export function duplicateTimer(db: Db, id: number, newName: string, now = Date.now()): Promise<number> {
  return withTransaction(db, async (tx) => {
    const [source] = await loadTree(tx, 'WHERE id = ?', id);
    if (!source) throw new Error(`timer ${id} not found`);
    await tx.runAsync('UPDATE timers SET sort_index = sort_index + 1 WHERE sort_index > ?', source.sortIndex);
    const inserted = await tx.runAsync(
      'INSERT INTO timers (name, color, created_at, updated_at, last_used_at, sort_index, kind, notes) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
      newName,
      source.color,
      now,
      now,
      source.sortIndex + 1,
      'custom',
      source.notes
    );
    await insertTree(tx, inserted.lastInsertRowId, source);
    return inserted.lastInsertRowId;
  });
}

/** New list order: the given ids get sort_index 0..n-1 in that order; ids not listed keep their relative order after them. */
export function reorderTimers(db: Db, ids: number[]): Promise<void> {
  return withTransaction(db, async (tx) => {
    const rest = await tx.getAllAsync<{ id: number }>('SELECT id FROM timers ORDER BY sort_index, id');
    const order = [...ids, ...rest.map((r) => r.id).filter((id) => !ids.includes(id))];
    for (let i = 0; i < order.length; i++) await tx.runAsync('UPDATE timers SET sort_index = ? WHERE id = ?', i, order[i]);
  });
}

/** Marks the timer as the last used one (Start was tapped). */
export function touchTimer(db: Db, id: number, now = Date.now()): Promise<void> {
  return withWrite(db, async (tx) => {
    await tx.runAsync('UPDATE timers SET last_used_at = ? WHERE id = ?', now, id);
  });
}

export function countTimers(db: Db): Promise<number> {
  return withRead(db, async (r) => (await r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM timers'))?.n ?? 0);
}
