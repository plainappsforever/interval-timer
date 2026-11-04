/**
 * @jest-environment node
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Session } from '@/db/sessions';

import { CSV_HEADER, guardCell, quoteCell, sessionCells, toCsv } from './csv';

const s = (over: Partial<Session>): Session => ({ id: 1, timerId: 1, timerName: 'Tabata', startedAt: new Date(2026, 0, 2, 7, 30, 5).getTime(), endedAt: 0, plannedS: 250, actualS: 250, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: '', ...over });

describe('history CSV (A11)', () => {
  it('quotes, doubles quotes, guards formulas, keeps numbers plain', () => {
    expect(quoteCell('plain')).toBe('plain');
    expect(quoteCell('a,b')).toBe('"a,b"');
    expect(quoteCell('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCell('line\nbreak')).toBe('"line\nbreak"');
    expect(guardCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(guardCell('-5 rounds')).toBe("'-5 rounds");
    expect(guardCell('@x')).toBe("'@x");
    expect(guardCell('Tabata')).toBe('Tabata');
    expect(sessionCells(s({ timerName: '=HIIT', note: 'felt "ok", tired', plannedS: null }))).toEqual(['2026-01-02', '07:30:05', "'=HIIT", '', '250', '1', '0', '0', '0', 'felt "ok", tired']);
    const csv = toCsv([s({ note: 'a,b' })]);
    expect(csv.startsWith('﻿' + CSV_HEADER.join(','))).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('parses back with Python csv to the same rows (referee/python/csv_check.py)', () => {
    const sessions = [
      s({ timerName: 'Zirkel 🏋️', note: 'multi\nline, with "quotes"' }),
      s({ timerName: '+plus', note: '@at', completed: false, interrupted: true, skippedIntervals: 2, pauses: 1, plannedS: null, actualS: 61 }),
      s({ timerName: 'Тренировка', note: '' }),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'csv-'));
    const csvPath = join(dir, 'history.csv');
    const expectedPath = join(dir, 'expected.json');
    writeFileSync(csvPath, toCsv(sessions), 'utf8');
    writeFileSync(expectedPath, JSON.stringify({ header: [...CSV_HEADER], rows: sessions.map(sessionCells), numericColumns: ['planned_s', 'actual_s', 'completed', 'skipped_intervals', 'pauses', 'interrupted'] }), 'utf8');
    const run = spawnSync('python3', ['-I', join(__dirname, '../../referee/python/csv_check.py'), csvPath, expectedPath], { encoding: 'utf8' });
    expect([run.status, run.stdout, run.stderr]).toEqual([0, expect.stringContaining('OK'), '']);
  });
});
