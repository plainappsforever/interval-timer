/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { makeT } from '@/i18n';

import { seedManyTimers } from './dev-seed';
import { LATEST_VERSION, migrate } from './migrations';
import { addSession, deleteSession, getSession, listSessions, updateSessionNote } from './sessions';
import { DEFAULT_SETTINGS, getSetting, getThemePreference, readSettings, setSetting, setThemePreference } from './settings';
import { restoreTemplates, seedTemplatesOnce, TEMPLATE_IDS, templateDef } from './templates';
import { countTimers, createTimer, deleteTimer, duplicateTimer, getTimer, lastUsedTimer, listTimers, reorderTimers, touchTimer, updateTimer } from './timers';
import { withTransaction } from './tx';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

const tabata: TimerDef = {
  name: 'Tabata',
  color: '#C62828',
  notes: 'classic',
  blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest', { cueStart: 'beep' })], { rounds: 8 })],
  prefs: { ...DEFAULT_PREFS },
};
const circuit: TimerDef = {
  name: 'Circuit',
  color: '#00695C',
  notes: '',
  blocks: [
    block([interval('Squats', 45, 'work', { halfwayCue: true }), interval('Rest', 15, 'rest')], { name: 'Legs', rounds: 3, restBetweenRoundsS: 60 }),
    block([interval('Plank', 60, 'open', { openTickS: 15, countdownCue: false })], { name: 'Core', rounds: 2 }),
  ],
  prefs: { prepSeconds: 5, endCue: 'voice', repeatWhole: 2, vibrate: false },
};

describe('migrations', () => {
  it('reaches the latest version and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(2);
  });

  it('migration 2 drops the template demo table and converts an old plain theme row to JSON', async () => {
    const db = createTestDb();
    await migrate(db, ['CREATE TABLE items (id INTEGER PRIMARY KEY); CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);']);
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    await migrate(db);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'")).toBeNull();
    expect(await getThemePreference(db)).toBe('dark');
  });

  it('CHECK constraints enforce the SPEC §5.3 limits at the database too', async () => {
    const db = await freshDb();
    await expect(createTimer(db, { ...tabata, blocks: [block([interval('Work', 6000, 'work')])] })).rejects.toThrow();
    await expect(createTimer(db, { ...tabata, blocks: [block([interval('Work', 5, 'work')], { rounds: 100 })] })).rejects.toThrow();
    await expect(createTimer(db, { ...tabata, prefs: { ...DEFAULT_PREFS, prepSeconds: 61 } })).rejects.toThrow();
    await expect(createTimer(db, { ...tabata, name: '' })).rejects.toThrow();
    expect(await countTimers(db)).toBe(0); // a failed create leaves nothing behind (one transaction)
  });
});

describe('timers', () => {
  it('saves a timer with blocks, intervals and prefs in one transaction and reads it back exactly', async () => {
    const db = await freshDb();
    const id = await createTimer(db, circuit, 1000);
    const saved = await getTimer(db, id);
    expect(saved).toMatchObject({ ...circuit, id, kind: 'custom', createdAt: 1000, updatedAt: 1000, lastUsedAt: null, sortIndex: 0 });
    expect(saved?.blocks).toEqual(circuit.blocks);
  });

  it('lists in sort order, then reorders', async () => {
    const db = await freshDb();
    const a = await createTimer(db, tabata, 1);
    const b = await createTimer(db, circuit, 2);
    const c = await createTimer(db, { ...tabata, name: 'Third' }, 3);
    expect((await listTimers(db)).map((t) => t.id)).toEqual([a, b, c]);
    await reorderTimers(db, [c, a]);
    expect((await listTimers(db)).map((t) => [t.id, t.sortIndex])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
    ]);
  });

  it('update replaces the whole tree and keeps kind, position and usage', async () => {
    const db = await freshDb();
    const id = await createTimer(db, tabata, 1, 'template');
    await touchTimer(db, id, 50);
    await updateTimer(db, id, { ...circuit, name: 'Edited' }, 99);
    const saved = await getTimer(db, id);
    expect(saved).toMatchObject({ name: 'Edited', kind: 'template', lastUsedAt: 50, updatedAt: 99, createdAt: 1 });
    expect(saved?.blocks).toEqual(circuit.blocks);
    expect(saved?.prefs).toEqual(circuit.prefs);
    const orphans = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM intervals WHERE block_id NOT IN (SELECT id FROM blocks)');
    expect(orphans?.n).toBe(0);
    await expect(updateTimer(db, 999, circuit)).rejects.toThrow('not found');
  });

  it('duplicate makes a custom copy right after the original', async () => {
    const db = await freshDb();
    const a = await createTimer(db, tabata, 1, 'template');
    const b = await createTimer(db, circuit, 2);
    const copy = await duplicateTimer(db, a, 'Tabata copy', 3);
    const list = await listTimers(db);
    expect(list.map((t) => t.id)).toEqual([a, copy, b]);
    expect(list[1]).toMatchObject({ name: 'Tabata copy', kind: 'custom', lastUsedAt: null, blocks: tabata.blocks, prefs: tabata.prefs });
  });

  it('delete removes the tree and leaves sessions with their timer_name', async () => {
    const db = await freshDb();
    const id = await createTimer(db, tabata, 1);
    const sid = await addSession(db, { timerId: id, timerName: 'Tabata', startedAt: 10, endedAt: 250, plannedS: 250, actualS: 240, completed: true, skippedIntervals: 0, pauses: 1, interrupted: false, note: '' });
    await deleteTimer(db, id);
    expect(await getTimer(db, id)).toBeNull();
    expect(await db.getFirstAsync('SELECT 1 FROM blocks')).toBeNull();
    expect(await db.getFirstAsync('SELECT 1 FROM intervals')).toBeNull();
    expect(await db.getFirstAsync('SELECT 1 FROM timer_prefs')).toBeNull();
    expect(await getSession(db, sid)).toMatchObject({ timerId: null, timerName: 'Tabata' });
  });

  it('lastUsedTimer prefers the most recently started timer, else the first in the list', async () => {
    const db = await freshDb();
    const a = await createTimer(db, tabata, 1);
    const b = await createTimer(db, circuit, 2);
    expect((await lastUsedTimer(db))?.id).toBe(a);
    await touchTimer(db, b, 100);
    expect((await lastUsedTimer(db))?.id).toBe(b);
    await touchTimer(db, a, 200);
    expect((await lastUsedTimer(db))?.id).toBe(a);
  });

  it('a failing transaction rolls everything back, including nested writes', async () => {
    const db = await freshDb();
    await expect(
      withTransaction(db, async (tx) => {
        await createTimer(tx, tabata, 1);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await countTimers(db)).toBe(0);
  });

  it('keeps 15-language names and emoji intact', async () => {
    const db = await freshDb();
    const names = ['Тренировка', '運動 🏃', 'تمرين', 'Übung', '운동', 'पैदल'];
    for (const name of names) await createTimer(db, { ...tabata, name, blocks: [block([interval(name, 5, 'work')])] });
    expect((await listTimers(db)).map((t) => [t.name, t.blocks[0].intervals[0].name])).toEqual(names.map((n) => [n, n]));
  });

  it('the CHECK on names agrees with validation: 40 code points fit (40 emoji = 80 UTF-16 units), 41 do not (D31)', async () => {
    const db = await freshDb();
    const e40 = '💪'.repeat(40);
    await createTimer(db, { ...tabata, name: e40, blocks: [block([interval(e40, 5, 'work')], { name: e40 })] });
    const [t] = await listTimers(db);
    expect([t.name, t.blocks[0].name, t.blocks[0].intervals[0].name]).toEqual([e40, e40, e40]);
    await expect(createTimer(db, { ...tabata, name: '💪'.repeat(41) })).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('writes, lists newest first, filters by range, edits the note and deletes', async () => {
    const db = await freshDb();
    const base = { timerId: null, timerName: 'T', plannedS: null, actualS: 60, completed: false, skippedIntervals: 2, pauses: 0, interrupted: true, note: '' };
    const s1 = await addSession(db, { ...base, startedAt: 100, endedAt: 160 });
    const s2 = await addSession(db, { ...base, startedAt: 200, endedAt: 260, plannedS: 60, completed: true });
    expect((await listSessions(db)).map((s) => s.id)).toEqual([s2, s1]);
    expect((await listSessions(db, { fromMs: 0, toMs: 200 })).map((s) => s.id)).toEqual([s1]);
    expect(await getSession(db, s2)).toMatchObject({ plannedS: 60, completed: true, interrupted: true, skippedIntervals: 2 });
    await updateSessionNote(db, s1, 'felt good');
    expect((await getSession(db, s1))?.note).toBe('felt good');
    await deleteSession(db, s1);
    expect(await getSession(db, s1)).toBeNull();
  });
});

describe('settings (JSON values with defaults)', () => {
  it('defaults, persists, rejects invalid values and ignores damaged rows', async () => {
    const db = await freshDb();
    expect(await readSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.liveActivity).toBe(false);
    expect(DEFAULT_SETTINGS.respectSilent).toBe(false);
    await setSetting(db, 'countdownFrom', 10);
    await setSetting(db, 'language', 'ja');
    await setSetting(db, 'recovery', { timerId: 3, baseWallMs: 5 });
    await setSetting(db, 'lastTimerId', 7);
    expect(await readSettings(db)).toMatchObject({ countdownFrom: 10, language: 'ja', recovery: { timerId: 3, baseWallMs: 5 }, lastTimerId: 7 });
    await expect(setSetting(db, 'countdownFrom', 4 as never)).rejects.toThrow('invalid');
    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'countdown_from'");
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('volume', '7')");
    expect(await getSetting(db, 'countdownFrom')).toBe(3);
    expect(await getSetting(db, 'volume')).toBe(1);
    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key = 'theme'")).toEqual({ value: '"dark"' });
    await expect(setSetting(db, 'recovery', [1, 2] as never)).rejects.toThrow('invalid'); // REVIEW S2: object or null only
    await expect(setSetting(db, 'recovery', 'x' as never)).rejects.toThrow('invalid');
    await setSetting(db, 'recovery', null);
    expect(await getSetting(db, 'recovery')).toBeNull();
  });
});

describe('templates', () => {
  it('seeds the seven templates once, in the UI language, and restores deleted ones', async () => {
    const db = await freshDb();
    const t = makeT('de');
    expect(await seedTemplatesOnce(db, t, 1)).toBe(true);
    expect(await seedTemplatesOnce(db, t, 2)).toBe(false);
    const list = await listTimers(db);
    expect(list.map((x) => [x.name, x.kind])).toEqual([
      ['Tabata', 'template'],
      ['HIIT 30/15', 'template'],
      ['EMOM 10', 'template'],
      ['Boxen 3/1', 'template'],
      ['Gehen/Laufen', 'template'],
      ['Zirkel', 'template'],
      ['Dehnen', 'template'],
    ]);
    expect(list[0].blocks).toEqual(templateDef('tabata', t).blocks);
    expect(list[5].blocks[0].intervals).toHaveLength(12);
    expect(list[5].blocks[0].intervals[0].name).toBe('Station 1');
    await deleteTimer(db, list[3].id);
    await deleteTimer(db, list[6].id);
    expect(await restoreTemplates(db, t, 3)).toBe(2);
    expect(await restoreTemplates(db, t, 4)).toBe(0);
    expect((await listTimers(db)).map((x) => x.name).sort()).toEqual(TEMPLATE_IDS.map((id) => templateDef(id, t).name).sort());
  });

  it('seeding is one transaction: a failure half-way leaves no templates and no flag (REVIEW S1)', async () => {
    const db = await freshDb();
    const broken: typeof makeT extends (l: infer _L) => infer T ? T : never = (key, params) => {
      if (key === 'template.boxing') throw new Error('boom');
      return makeT('en')(key, params);
    };
    await expect(seedTemplatesOnce(db, broken, 1)).rejects.toThrow('boom');
    expect(await countTimers(db)).toBe(0);
    expect(await getSetting(db, 'templatesSeeded')).toBe(false);
    expect(await seedTemplatesOnce(db, makeT('en'), 2)).toBe(true);
    expect(await countTimers(db)).toBe(7);
  });
});

describe('dev seed (A9)', () => {
  it('creates 500 varied timers and lists them in well under a second on Node', async () => {
    const db = await freshDb();
    const ids = await seedManyTimers(db, 500, 1);
    expect(ids).toHaveLength(500);
    const t0 = performance.now();
    const list = await listTimers(db);
    const ms = performance.now() - t0;
    expect(list).toHaveLength(500);
    expect(new Set(list.map((x) => x.name)).size).toBe(500);
    expect(list.filter((x) => x.blocks.length === 3).length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1000);
  });
});
