import { buckets, dayKey, isoWeekKey, monthKey } from './stats';
import type { Session } from '@/db/sessions';

// Zone dependent stats keys (L34). Assigning process.env.TZ inside Jest does not change the zone, so this test reads
// the zone the process REALLY runs in and checks the table below. Run it in every zone with
//   npm run test:zones -- src/engine/stats-zones.test.ts
// (scripts/tz-matrix.js starts one Jest process per zone and fails when a zone did not take effect or fails a case).
const AT = Date.UTC(2026, 11, 27, 23, 0); // Sun 2026-12-27 23:00 UTC

// day key, ISO week key per zone for AT (UTC+14 Kiritimati: the UTC Sunday is already Monday of W53)
const EXPECTED: Record<string, [string, string]> = {
  UTC: ['2026-12-27', '2026-W52'],
  'Etc/UTC': ['2026-12-27', '2026-W52'],
  'Europe/Berlin': ['2026-12-28', '2026-W53'],
  'America/Los_Angeles': ['2026-12-27', '2026-W52'],
  'Pacific/Auckland': ['2026-12-28', '2026-W53'],
  'Asia/Kolkata': ['2026-12-28', '2026-W53'],
  'Asia/Calcutta': ['2026-12-28', '2026-W53'],
  'America/St_Johns': ['2026-12-27', '2026-W52'],
  'Australia/Lord_Howe': ['2026-12-28', '2026-W53'],
  'Pacific/Kiritimati': ['2026-12-28', '2026-W53'],
};

const session = (startedAt: number): Session => ({
  id: 0,
  timerId: 1,
  timerName: 'Tabata',
  startedAt,
  endedAt: startedAt + 250_000,
  plannedS: 250,
  actualS: 250,
  completed: true,
  skippedIntervals: 0,
  pauses: 0,
  interrupted: false,
  note: '',
});

describe('stats keys follow the local calendar of the real process zone', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const expected = EXPECTED[zone];

  it('runs in a zone this table knows', () => {
    expect(expected).toBeDefined();
  });

  it('day, ISO week and month keys', () => {
    if (!expected) return;
    expect(dayKey(AT)).toBe(expected[0]);
    expect(isoWeekKey(AT)).toBe(expected[1]);
    expect(buckets([session(AT)], 'week')[0].key).toBe(expected[1]);
    expect(monthKey(AT)).toBe('2026-12');
  });
});
