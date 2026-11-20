// History (SPEC §4 `sessions`, A10). A session is written once when a run ends; the note can be edited later.
import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type Session = {
  id: number;
  /** NULL after the timer was deleted; `timerName` stays. */
  timerId: number | null;
  timerName: string;
  startedAt: number;
  endedAt: number;
  /** Planned length in seconds; null when the timer has open intervals (unknown in advance). */
  plannedS: number | null;
  actualS: number;
  completed: boolean;
  skippedIntervals: number;
  pauses: number;
  /** The run was resumed after the app was interrupted (process death, D24). */
  interrupted: boolean;
  note: string;
};

export type SessionInput = Omit<Session, 'id'>;

type Row = {
  id: number;
  timer_id: number | null;
  timer_name: string;
  started_at: number;
  ended_at: number;
  planned_s: number | null;
  actual_s: number;
  completed: number;
  skipped_intervals: number;
  pauses: number;
  interrupted: number;
  note: string;
};

const COLUMNS = 'id, timer_id, timer_name, started_at, ended_at, planned_s, actual_s, completed, skipped_intervals, pauses, interrupted, note';

function fromRow(r: Row): Session {
  return {
    id: r.id,
    timerId: r.timer_id,
    timerName: r.timer_name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    plannedS: r.planned_s,
    actualS: r.actual_s,
    completed: r.completed === 1,
    skippedIntervals: r.skipped_intervals,
    pauses: r.pauses,
    interrupted: r.interrupted === 1,
    note: r.note,
  };
}

export function addSession(db: Db, s: SessionInput): Promise<number> {
  return withWrite(db, async (tx) => {
    const result = await tx.runAsync(
      'INSERT INTO sessions (timer_id, timer_name, started_at, ended_at, planned_s, actual_s, completed, skipped_intervals, pauses, interrupted, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      s.timerId,
      s.timerName,
      s.startedAt,
      s.endedAt,
      s.plannedS,
      s.actualS,
      s.completed ? 1 : 0,
      s.skippedIntervals,
      s.pauses,
      s.interrupted ? 1 : 0,
      s.note
    );
    return result.lastInsertRowId;
  });
}

/** Newest first. `range` = [fromMs, toMs) on `started_at`. */
export async function listSessions(db: Db, range?: { fromMs: number; toMs: number }): Promise<Session[]> {
  const rows = await withRead(db, (r) =>
    range
      ? r.getAllAsync<Row>(`SELECT ${COLUMNS} FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC, id DESC`, range.fromMs, range.toMs)
      : r.getAllAsync<Row>(`SELECT ${COLUMNS} FROM sessions ORDER BY started_at DESC, id DESC`)
  );
  return rows.map(fromRow);
}

export async function getSession(db: Db, id: number): Promise<Session | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<Row>(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`, id));
  return row ? fromRow(row) : null;
}

export function updateSessionNote(db: Db, id: number, note: string): Promise<void> {
  return withWrite(db, async (tx) => {
    await tx.runAsync('UPDATE sessions SET note = ? WHERE id = ?', note, id);
  });
}

export function deleteSession(db: Db, id: number): Promise<void> {
  return withWrite(db, async (tx) => {
    await tx.runAsync('DELETE FROM sessions WHERE id = ?', id);
  });
}

/** Workouts that ran to their end (not ended early); the rating prompt counts these. */
export async function countCompletedSessions(db: Db): Promise<number> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE completed = 1'));
  return row?.n ?? 0;
}
