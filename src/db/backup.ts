// Backup I/O (SPEC §5.6, U10): export reads everything; restore applies a RestorePlan in ONE transaction so a failure
// leaves the database as it was.
import { buildBackup, encodeBackup, planRestore, type ParsedBackup, type ParsedTimer, type RestoreMode } from '@/engine/backup';

import { addSession, listSessions } from './sessions';
import { readSettings, setSetting, type Settings } from './settings';
import { listTimers } from './timers';
import { withTransaction } from './tx';
import type { Db } from './types';

export async function exportBackup(db: Db, now = Date.now()): Promise<string> {
  const [timers, sessions, settings] = await Promise.all([listTimers(db), listSessions(db), readSettings(db)]);
  return encodeBackup(buildBackup(timers, sessions, settings, now));
}

async function insertTimerRow(tx: Db, t: ParsedTimer, withId: boolean, sortIndex: number): Promise<number> {
  const cols = `${withId ? 'id, ' : ''}name, color, created_at, updated_at, last_used_at, sort_index, kind, notes`;
  const vals = `${withId ? '?, ' : ''}?, ?, ?, ?, ?, ?, ?, ?`;
  const params: (number | string | null)[] = [t.def.name, t.def.color, t.createdAt, t.updatedAt, t.lastUsedAt, sortIndex, t.kind, t.def.notes];
  if (withId) params.unshift(t.id);
  const r = await tx.runAsync(`INSERT INTO timers (${cols}) VALUES (${vals})`, ...params);
  return r.lastInsertRowId;
}

async function insertTree(tx: Db, timerId: number, t: ParsedTimer): Promise<void> {
  for (let b = 0; b < t.def.blocks.length; b++) {
    const blk = t.def.blocks[b];
    const ins = await tx.runAsync('INSERT INTO blocks (timer_id, sort_index, name, rounds, rest_between_rounds_s) VALUES (?, ?, ?, ?, ?)', timerId, b, blk.name, blk.rounds, blk.restBetweenRoundsS);
    for (let i = 0; i < blk.intervals.length; i++) {
      const iv = blk.intervals[i];
      await tx.runAsync(
        'INSERT INTO intervals (block_id, sort_index, name, seconds, type, color, cue_start, halfway_cue, countdown_cue, open_tick_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ins.lastInsertRowId,
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
  await tx.runAsync('INSERT INTO timer_prefs (timer_id, prep_seconds, end_cue, repeat_whole, vibrate) VALUES (?, ?, ?, ?, ?)', timerId, t.def.prefs.prepSeconds, t.def.prefs.endCue, t.def.prefs.repeatWhole, t.def.prefs.vibrate ? 1 : 0);
}

export type RestoreSummary = { timersReplaced: number; timersCreated: number; timersKeptIdentical: number; sessionsAdded: number; sessionsSkipped: number; settingsApplied: number };

/** Applies a parsed backup. Sessions referencing a timer id that does not exist afterwards keep timer_name only. */
export function restoreBackup(db: Db, backup: ParsedBackup, mode: RestoreMode): Promise<RestoreSummary> {
  return withTransaction(db, async (tx) => {
    const existing = await listTimers(tx);
    const sessions = await tx.getAllAsync<{ timer_name: string; started_at: number; ended_at: number }>('SELECT timer_name, started_at, ended_at FROM sessions');
    const plan = planRestore(
      backup,
      existing,
      sessions.map((s) => ({ timerName: s.timer_name, startedAt: s.started_at, endedAt: s.ended_at })),
      mode
    );
    const summary: RestoreSummary = { timersReplaced: 0, timersCreated: 0, timersKeptIdentical: 0, sessionsAdded: 0, sessionsSkipped: plan.skippedDuplicateSessions, settingsApplied: 0 };
    let nextSort = ((await tx.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(sort_index), -1) + 1 AS n FROM timers'))?.n ?? 0) as number;
    // backup timer id → id in this database (a "keep both" copy gets a new id; its sessions must follow it, REVIEW M1)
    const idMap = new Map<number, number>();
    for (const t of plan.replace) {
      await tx.runAsync('DELETE FROM intervals WHERE block_id IN (SELECT id FROM blocks WHERE timer_id = ?)', t.id);
      await tx.runAsync('DELETE FROM blocks WHERE timer_id = ?', t.id);
      await tx.runAsync('DELETE FROM timer_prefs WHERE timer_id = ?', t.id);
      await tx.runAsync('UPDATE timers SET name = ?, color = ?, notes = ?, kind = ?, created_at = ?, updated_at = ?, last_used_at = ?, sort_index = ? WHERE id = ?', t.def.name, t.def.color, t.def.notes, t.kind, t.createdAt, t.updatedAt, t.lastUsedAt, t.sortIndex, t.id);
      await insertTree(tx, t.id, t);
      idMap.set(t.id, t.id);
      summary.timersReplaced++;
    }
    for (const t of plan.insertWithId) {
      await insertTree(tx, await insertTimerRow(tx, t, true, t.sortIndex), t);
      idMap.set(t.id, t.id);
      summary.timersCreated++;
    }
    for (const t of plan.identical) {
      // keep both, same id, same timer: the row stays as it is; its backup sessions attach to it (D35)
      idMap.set(t.id, t.id);
      summary.timersKeptIdentical++;
    }
    for (const t of plan.create) {
      const newId = await insertTimerRow(tx, t, false, nextSort++);
      await insertTree(tx, newId, t);
      idMap.set(t.id, newId);
      summary.timersCreated++;
    }
    for (const s of plan.sessions) {
      // a session follows its backup timer; one whose timer is not in the backup keeps only its name
      await addSession(tx, { ...s, timerId: s.timerId !== null ? (idMap.get(s.timerId) ?? null) : null });
      summary.sessionsAdded++;
    }
    for (const [k, v] of Object.entries(backup.settings)) {
      try {
        await setSetting(tx, k as keyof Settings, v as never);
        summary.settingsApplied++;
      } catch {
        // an invalid value in the file: keep the current setting
      }
    }
    return summary;
  });
}
