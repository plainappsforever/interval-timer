// History CSV export (SPEC §5.6, A11): RFC 4180 (CRLF, quotes doubled, every cell quoted when needed), UTF-8 BOM for
// spreadsheet apps, and a formula guard: a text cell starting with = + - @ TAB CR gets a leading apostrophe.
import type { Session } from '@/db/sessions';

export const CSV_HEADER = ['date', 'time', 'timer', 'planned_s', 'actual_s', 'completed', 'skipped_intervals', 'pauses', 'interrupted', 'note'] as const;
/** Columns whose cells are plain numbers/flags (never formula-guarded). */
export const CSV_NUMERIC = new Set(['planned_s', 'actual_s', 'completed', 'skipped_intervals', 'pauses', 'interrupted']);

const DANGER = /^[=+\-@\t\r]/;

export function guardCell(text: string): string {
  return DANGER.test(text) ? `'${text}` : text;
}

export function quoteCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local date/time of a timestamp, as a spreadsheet reads them. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The cells of one session, after the formula guard (what the writer means to write). */
export function sessionCells(s: Session): string[] {
  return [
    localDate(s.startedAt),
    localTime(s.startedAt),
    guardCell(s.timerName),
    s.plannedS === null ? '' : String(s.plannedS),
    String(s.actualS),
    s.completed ? '1' : '0',
    String(s.skippedIntervals),
    String(s.pauses),
    s.interrupted ? '1' : '0',
    guardCell(s.note),
  ];
}

export function toCsv(sessions: readonly Session[]): string {
  const rows = [[...CSV_HEADER], ...sessions.map(sessionCells)];
  return '﻿' + rows.map((r) => r.map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
