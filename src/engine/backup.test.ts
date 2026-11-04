/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { exportBackup, restoreBackup } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addSession, deleteSession, listSessions } from '@/db/sessions';
import { readSettings, setSetting } from '@/db/settings';
import { createTimer, deleteTimer, listTimers, updateTimer } from '@/db/timers';
import type { Db } from '@/db/types';

import { buildBackup, encodeBackup, parseBackup, planRestore } from './backup';
import { seeded as rng } from '../../test/harness/fake-clock';

import { block, DEFAULT_PREFS, interval, type TimerDef } from './model';

const tabata: TimerDef = { name: 'Tabata', color: '#C62828', notes: '', blocks: [block([interval('Work', 20, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })], prefs: { ...DEFAULT_PREFS } };
const circuit: TimerDef = { name: 'Zirkel 🏋️', color: '', notes: 'n', blocks: [block([interval('Plank', 60, 'open', { openTickS: 15 })], { rounds: 2, restBetweenRoundsS: 30 })], prefs: { prepSeconds: 0, endCue: 'none', repeatWhole: 3, vibrate: false } };

async function seeded() {
  const db = createTestDb();
  await migrate(db);
  const a = await createTimer(db, tabata, 1, 'template');
  const b = await createTimer(db, circuit, 2);
  await addSession(db, { timerId: a, timerName: 'Tabata', startedAt: 100, endedAt: 350, plannedS: 250, actualS: 250, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: 'x' });
  await addSession(db, { timerId: b, timerName: 'Zirkel 🏋️', startedAt: 500, endedAt: 600, plannedS: null, actualS: 100, completed: false, skippedIntervals: 1, pauses: 2, interrupted: true, note: '' });
  await setSetting(db, 'countdownFrom', 10);
  await setSetting(db, 'language', 'de');
  await setSetting(db, 'lastTimerId', b);
  return { db, a, b };
}

describe('backup (SPEC §5.6, U10)', () => {
  it('export → restore on a fresh install gives identical timers, sessions and portable settings', async () => {
    const { db } = await seeded();
    const text = await exportBackup(db, 999);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.timers).toHaveLength(2);
    expect(parsed.backup.settings).toEqual(expect.objectContaining({ countdownFrom: 10, language: 'de' }));
    expect('lastTimerId' in parsed.backup.settings).toBe(false);
    const fresh = createTestDb();
    await migrate(fresh);
    const summary = await restoreBackup(fresh, parsed.backup, 'replace');
    expect(summary).toEqual({ timersReplaced: 0, timersCreated: 2, timersKeptIdentical: 0, sessionsAdded: 2, sessionsSkipped: 0, settingsApplied: Object.keys(parsed.backup.settings).length });
    expect(await listTimers(fresh)).toEqual(await listTimers(db));
    expect((await listSessions(fresh)).map(({ id: _id, ...s }) => s)).toEqual((await listSessions(db)).map(({ id: _id, ...s }) => s));
    expect(await readSettings(fresh)).toMatchObject({ countdownFrom: 10, language: 'de', lastTimerId: null });
    expect(await exportBackup(fresh, 999)).toBe(text); // idempotent: same file again
  });

  it('restore merges by id: replace overwrites, keep both adds copies of DIFFERENT timers only; duplicate sessions are skipped', async () => {
    const { db, a } = await seeded();
    const text = await exportBackup(db, 1);
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error('parse');
    await deleteTimer(db, a); // id a is free again → restored under its id
    const edited = { ...parsed.backup, timers: parsed.backup.timers.map((t) => (t.id === a ? t : { ...t, def: { ...t.def, name: 'Edited' } })) };
    const replaced = await restoreBackup(db, edited, 'replace');
    expect(replaced).toMatchObject({ timersReplaced: 1, timersCreated: 1, sessionsAdded: 0, sessionsSkipped: 2 });
    expect((await listTimers(db)).map((t) => [t.id, t.name, t.kind])).toEqual([
      [a, 'Tabata', 'template'],
      [a + 1, 'Edited', 'custom'],
    ]);
    const both = await restoreBackup(db, parsed.backup, 'keepBoth');
    // id a holds the identical Tabata (kept once, D35); id a+1 holds "Edited", which differs from the backup's Zirkel
    expect(both).toMatchObject({ timersReplaced: 0, timersCreated: 1, timersKeptIdentical: 1, sessionsSkipped: 2 });
    expect((await listTimers(db)).map((t) => t.name)).toEqual(['Tabata', 'Edited', 'Zirkel 🏋️']);
    expect(await listSessions(db)).toHaveLength(2);
  });

  it('keep both on the SAME phone: identical timers with the same id are kept once, not doubled (D35, B2 backup family)', async () => {
    const { db, a, b } = await seeded();
    const c = await createTimer(db, { ...tabata, name: 'Third' }, 3);
    const parsed = parseBackup(await exportBackup(db, 1));
    if (!parsed.ok) throw new Error('parse');
    const before = await listTimers(db);
    const summary = await restoreBackup(db, parsed.backup, 'keepBoth');
    expect(summary).toMatchObject({ timersReplaced: 0, timersCreated: 0, timersKeptIdentical: 3, sessionsAdded: 0, sessionsSkipped: 2 });
    expect(await listTimers(db)).toEqual(before);
    expect((await listTimers(db)).map((t) => t.id)).toEqual([a, b, c]);
    // a changed definition, kind or a single interval field makes it a different timer → a copy as before
    await updateTimer(db, c, { ...tabata, name: 'Third', blocks: [block([interval('Work', 21, 'work'), interval('Rest', 10, 'rest')], { rounds: 8 })] }, 4);
    const again = await restoreBackup(db, parsed.backup, 'keepBoth');
    expect(again).toMatchObject({ timersCreated: 1, timersKeptIdentical: 2 });
    expect((await listTimers(db)).map((t) => t.name)).toEqual(['Tabata', 'Zirkel 🏋️', 'Third', 'Third']);
    // a session of an identical timer that is missing on the phone comes back attached to that timer
    const fresh = createTestDb();
    await migrate(fresh);
    const t1 = await createTimer(fresh, tabata, 1, 'template');
    const summary2 = await restoreBackup(fresh, parsed.backup, 'keepBoth');
    expect(summary2).toMatchObject({ timersKeptIdentical: 1, sessionsAdded: 2 });
    expect((await listSessions(fresh)).find((s) => s.timerName === 'Tabata')!.timerId).toBe(t1);
    // same definition but another kind (custom vs template) is not identical
    const fresh2 = createTestDb();
    await migrate(fresh2);
    await createTimer(fresh2, tabata, 1, 'custom');
    expect(await restoreBackup(fresh2, parsed.backup, 'keepBoth')).toMatchObject({ timersKeptIdentical: 0 });
  });

  it('keep both: restored sessions follow the COPY of their timer, not the existing timer with the same id (REVIEW M1)', async () => {
    const { db, a, b } = await seeded();
    const parsed = parseBackup(await exportBackup(db, 1));
    if (!parsed.ok) throw new Error('parse');
    const fresh = createTestDb();
    await migrate(fresh);
    const other = await createTimer(fresh, { ...tabata, name: 'Other timer with id 1' }, 1); // occupies id a
    expect(other).toBe(a);
    const summary = await restoreBackup(fresh, parsed.backup, 'keepBoth');
    expect(summary).toMatchObject({ timersCreated: 2, sessionsAdded: 2 });
    const timers = await listTimers(fresh);
    const copyOfTabata = timers.find((t) => t.name === 'Tabata' && t.id !== other)!;
    const zirkel = timers.find((t) => t.name === 'Zirkel 🏋️')!;
    expect(zirkel.id).toBe(b); // id b was free: restored under its own id
    const sessions = await listSessions(fresh);
    expect(sessions.map((s) => [s.timerName, s.timerId])).toEqual([
      ['Zirkel 🏋️', zirkel.id],
      ['Tabata', copyOfTabata.id],
    ]);
    expect(sessions.some((s) => s.timerId === other)).toBe(false);
  });

  it('parseBackup is strict but forgiving: damaged entries are skipped, garbage is rejected, the plan is pure', () => {
    expect(parseBackup('nope')).toEqual({ ok: false, reason: 'format' });
    expect(parseBackup('{"format":"other"}')).toEqual({ ok: false, reason: 'format' });
    expect(parseBackup('{"format":"plainintervals-backup","version":9}')).toEqual({ ok: false, reason: 'version' });
    const b = buildBackup([], [], { language: 'en' } as never, 5);
    const text = encodeBackup({ ...b, timers: [{ id: 3, kind: 'custom', createdAt: 1, updatedAt: 1, lastUsedAt: null, sortIndex: 0, timer: { v: 1, n: '', b: [] } }, { id: 0 } as never], sessions: [{ timerName: 'T', startedAt: 1, endedAt: 2 } as never, { bad: true } as never], settings: { countdownFrom: 4, theme: 'dark' } as never });
    const parsed = parseBackup(text);
    expect(parsed).toMatchObject({ ok: true, backup: { timers: [], skippedTimers: 2, sessions: [{ timerName: 'T', actualS: 0, completed: false, plannedS: null }], skippedSessions: 1, settings: { countdownFrom: 4, theme: 'dark' } } });
    if (!parsed.ok) return;
    const plan = planRestore({ ...parsed.backup, timers: [{ id: 1, kind: 'custom', createdAt: 0, updatedAt: 0, lastUsedAt: null, sortIndex: 0, def: tabata }, { id: 9, kind: 'custom', createdAt: 0, updatedAt: 0, lastUsedAt: null, sortIndex: 0, def: tabata }] }, [{ id: 1, kind: 'custom', ...circuit }, { id: 2, kind: 'custom', ...tabata }], [{ timerName: 'T', startedAt: 1, endedAt: 2 }], 'keepBoth');
    expect(plan.create.map((t) => t.id)).toEqual([1]);
    expect(plan.insertWithId.map((t) => t.id)).toEqual([9]);
    expect(plan.identical).toEqual([]);
    const same = planRestore({ ...parsed.backup, timers: [{ id: 2, kind: 'custom', createdAt: 5, updatedAt: 6, lastUsedAt: 7, sortIndex: 3, def: tabata }] }, [{ id: 2, kind: 'custom', ...tabata }], [], 'keepBoth');
    expect(same.identical.map((t) => t.id)).toEqual([2]); // bookkeeping fields (dates, sort) do not make it different
    expect(same.create).toEqual([]);
    expect(planRestore({ ...parsed.backup, timers: same.identical }, [{ id: 2, kind: 'custom', ...tabata }], [], 'replace').replace.map((t) => t.id)).toEqual([2]);
    expect(plan.sessions).toEqual([]);
    expect(plan.skippedDuplicateSessions).toBe(1);
  });
});

// P4b: B1's backup checker compared timer and session CONTENTS but not which timer a session points to, so it could
// not have seen REVIEW M1 (keep both attached restored sessions to the wrong timer). This property test checks the
// attachment itself over random libraries, edits after the export (rename, edit, delete, new timers, deleted and new
// sessions) and id collisions on a fresh install, in both modes:
//   (1) every backup session that is added points to a timer whose definition equals its backup timer's (or to none
//       when its backup timer id was null / not in the backup);
//   (2) keep both: every session that was in the database before keeps its timer id, and that timer keeps its
//       definition; no restored session points to a timer that existed before unless the backup timer was restored
//       under that same (free) id;
//   (3) keep both adds every backup timer as a row; sessions are never lost or duplicated.
describe('backup: sessions stay attached to the right timer (P4b, REVIEW M1 generalised)', () => {
  const sig = (d: TimerDef) => JSON.stringify({ name: d.name, color: d.color, notes: d.notes, blocks: d.blocks, prefs: d.prefs });
  const defOf = (i: number, r: () => number): TimerDef => ({
    name: `T${i} ${['Tabata', 'Zirkel 🏋️', 'Бокс', '運動'][i % 4]}`,
    color: ['#C62828', '', '#00695C'][i % 3],
    notes: r() > 0.5 ? `note ${i}` : '',
    blocks: [block([interval('Work', 5 + Math.floor(r() * 60), 'work'), interval('Rest', 5 + Math.floor(r() * 30), 'rest')], { rounds: 1 + Math.floor(r() * 9) })],
    prefs: { ...DEFAULT_PREFS, prepSeconds: Math.floor(r() * 11) },
  });
  type View = Map<number, { timerId: number | null; sig: string | null }>; // keyed by startedAt (unique per test)
  async function view(db: Db): Promise<View> {
    const timers = new Map((await listTimers(db)).map((t) => [t.id, sig(t)]));
    return new Map((await listSessions(db)).map((s) => [s.startedAt, { timerId: s.timerId, sig: s.timerId === null ? null : (timers.get(s.timerId) ?? 'MISSING') }]));
  }

  it.each(Array.from({ length: 24 }, (_, i) => [i]))('seed %i: keep both and replace, same database after edits and a fresh install with id collisions', async (seed) => {
    const r = rng(1000 + seed);
    let clock = 10_000;
    let startedAt = 1_000_000;
    const src = createTestDb();
    await migrate(src);
    const ids: number[] = [];
    const n = 2 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) ids.push(await createTimer(src, defOf(i, r), clock++));
    // a deleted timer before the export: its sessions have timer_id NULL in the backup
    const gone = await createTimer(src, defOf(99, r), clock++);
    const sessionIds: number[] = [];
    const nSessions = 3 + Math.floor(r() * 10);
    for (let k = 0; k < nSessions; k++) {
      const pick = r() < 0.15 ? gone : ids[Math.floor(r() * ids.length)];
      const name = pick === gone ? defOf(99, r).name : (await listTimers(src)).find((t) => t.id === pick)!.name;
      sessionIds.push(await addSession(src, { timerId: pick, timerName: name, startedAt: startedAt++, endedAt: startedAt + 100, plannedS: 100, actualS: 100, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: '' }));
    }
    await deleteTimer(src, gone);
    const parsed = parseBackup(await exportBackup(src, clock++));
    if (!parsed.ok) throw new Error('parse');
    const backupSig = new Map(parsed.backup.timers.map((t) => [t.id, sig(t.def)]));
    const backupSessions = parsed.backup.sessions;
    expect(backupSessions).toHaveLength(nSessions);

    // target A: the same database after edits; target B: a fresh install whose own timers occupy some of the ids
    const a = src;
    for (const id of ids) {
      const x = r();
      if (x < 0.25) await updateTimer(a, id, { ...defOf(50 + id, r), name: `Edited ${id}` }, clock++);
      else if (x < 0.4) await deleteTimer(a, id);
    }
    for (let k = 0; k < 2; k++) await createTimer(a, defOf(70 + k, r), clock++);
    for (const sid of sessionIds) if (r() < 0.3) await deleteSession(a, sid);
    const liveA = (await listTimers(a))[0];
    if (liveA) await addSession(a, { timerId: liveA.id, timerName: liveA.name, startedAt: startedAt++, endedAt: startedAt + 50, plannedS: 50, actualS: 50, completed: true, skippedIntervals: 0, pauses: 0, interrupted: false, note: 'after export' });

    const b = createTestDb();
    await migrate(b);
    const occupy = 1 + Math.floor(r() * (n + 1));
    for (let k = 0; k < occupy; k++) await createTimer(b, defOf(80 + k, r), clock++);
    const firstB = (await listTimers(b))[0];
    await addSession(b, { timerId: firstB.id, timerName: firstB.name, startedAt: startedAt++, endedAt: startedAt + 70, plannedS: 70, actualS: 70, completed: false, skippedIntervals: 1, pauses: 0, interrupted: false, note: 'own' });

    // copies of the targets for the replace runs (rebuilt from the same steps is costly: restore into clones instead)
    const clone = async (db: Db): Promise<Db> => {
      const c = createTestDb();
      await migrate(c);
      const p = parseBackup(await exportBackup(db, 0));
      if (!p.ok) throw new Error('clone');
      await restoreBackup(c, p.backup, 'replace');
      return c;
    };
    const aReplace = await clone(a);
    const bReplace = await clone(b);

    for (const [db, mode] of [[a, 'keepBoth'], [b, 'keepBoth'], [aReplace, 'replace'], [bReplace, 'replace']] as const) {
      const before = await view(db);
      const timersBefore = new Map((await listTimers(db)).map((t) => [t.id, sig(t)]));
      const keyOf = (x: { startedAt: number; endedAt: number; timerName: string }) => `${x.startedAt}|${x.endedAt}|${x.timerName}`;
      const existingKeys = new Set((await listSessions(db)).map(keyOf));
      await restoreBackup(db, parsed.backup, mode);
      const after = await view(db);
      const timersAfter = await listTimers(db);
      // (3) no session lost or duplicated
      const added = backupSessions.filter((s) => !existingKeys.has(keyOf(s)));
      expect(after.size).toBe(before.size + added.length);
      // keep both adds every backup timer as a row, except one IDENTICAL to the timer under its id (kept once, D35)
      const identical = new Set(parsed.backup.timers.filter((t) => timersBefore.get(t.id) === sig(t.def)).map((t) => t.id));
      if (mode === 'keepBoth') expect(timersAfter).toHaveLength(timersBefore.size + parsed.backup.timers.length - identical.size);
      // (1) every added session points to a timer with its backup timer's definition
      for (const s of added) {
        const got = after.get(s.startedAt)!;
        const want = s.timerId !== null && backupSig.has(s.timerId) ? backupSig.get(s.timerId)! : null;
        expect({ startedAt: s.startedAt, mode, sig: got.sig }).toEqual({ startedAt: s.startedAt, mode, sig: want });
        // (2b) under keep both an added session only points at a pre-existing timer row if none existed with that id
        //      or the timer under that id is identical to its backup timer (kept once, D35)
        if (mode === 'keepBoth' && got.timerId !== null && !(s.timerId === got.timerId && identical.has(got.timerId))) expect(timersBefore.has(got.timerId)).toBe(false);
      }
      // (2) keep both never moves or rewrites what was there
      if (mode === 'keepBoth') {
        for (const [at, v] of before) expect({ at, ...after.get(at)! }).toEqual({ at, ...v });
        for (const [id, sg] of timersBefore) expect(timersAfter.find((t) => t.id === id) && sig(timersAfter.find((t) => t.id === id)!)).toBe(sg);
      }
    }
  });
});

