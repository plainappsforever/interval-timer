import { withTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  // 1: template demo schema (items + settings). Shipped by the template; the items table is dropped in migration 2.
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // 2: interval timer schema (SPEC §4, P1). Limits of SPEC §5.3 as CHECKs; `settings.value` becomes JSON.
  // Foreign keys are declared, but the data functions delete children explicitly (expo-sqlite does not promise
  // PRAGMA foreign_keys on every connection); a session keeps `timer_name` after its timer is deleted (timer_id NULL).
  `DROP TABLE items;
   CREATE TABLE timers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
     color TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_used_at INTEGER,
     sort_index INTEGER NOT NULL DEFAULT 0,
     kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom', 'template')),
     notes TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX timers_sort ON timers (sort_index, id);
   CREATE TABLE blocks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     timer_id INTEGER NOT NULL REFERENCES timers (id) ON DELETE CASCADE,
     sort_index INTEGER NOT NULL,
     name TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 40),
     rounds INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 99),
     rest_between_rounds_s INTEGER NOT NULL DEFAULT 0 CHECK (rest_between_rounds_s BETWEEN 0 AND 5999)
   );
   CREATE INDEX blocks_timer ON blocks (timer_id, sort_index);
   CREATE TABLE intervals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     block_id INTEGER NOT NULL REFERENCES blocks (id) ON DELETE CASCADE,
     sort_index INTEGER NOT NULL,
     name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
     seconds INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 5999),
     type TEXT NOT NULL CHECK (type IN ('prep', 'work', 'rest', 'cooldown', 'open')),
     color TEXT NOT NULL DEFAULT '',
     cue_start TEXT NOT NULL DEFAULT 'both' CHECK (cue_start IN ('voice', 'beep', 'both', 'none')),
     halfway_cue INTEGER NOT NULL DEFAULT 0 CHECK (halfway_cue IN (0, 1)),
     countdown_cue INTEGER NOT NULL DEFAULT 1 CHECK (countdown_cue IN (0, 1)),
     open_tick_s INTEGER NOT NULL DEFAULT 0 CHECK (open_tick_s BETWEEN 0 AND 5999)
   );
   CREATE INDEX intervals_block ON intervals (block_id, sort_index);
   CREATE TABLE timer_prefs (
     timer_id INTEGER PRIMARY KEY REFERENCES timers (id) ON DELETE CASCADE,
     prep_seconds INTEGER NOT NULL DEFAULT 10 CHECK (prep_seconds BETWEEN 0 AND 60),
     end_cue TEXT NOT NULL DEFAULT 'both' CHECK (end_cue IN ('voice', 'beep', 'both', 'none')),
     repeat_whole INTEGER NOT NULL DEFAULT 1 CHECK (repeat_whole BETWEEN 1 AND 10),
     vibrate INTEGER NOT NULL DEFAULT 1 CHECK (vibrate IN (0, 1))
   );
   CREATE TABLE sessions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     timer_id INTEGER REFERENCES timers (id) ON DELETE SET NULL,
     timer_name TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at INTEGER NOT NULL,
     planned_s INTEGER,
     actual_s INTEGER NOT NULL CHECK (actual_s >= 0),
     completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
     skipped_intervals INTEGER NOT NULL DEFAULT 0 CHECK (skipped_intervals >= 0),
     pauses INTEGER NOT NULL DEFAULT 0 CHECK (pauses >= 0),
     interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0, 1)),
     note TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX sessions_started ON sessions (started_at DESC);
   CREATE INDEX sessions_timer ON sessions (timer_id);
   UPDATE settings SET value = '"' || value || '"' WHERE key = 'theme' AND value NOT LIKE '"%';`,
];

export const LATEST_VERSION = MIGRATIONS.length;

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // The version is read INSIDE each unit: another JS handle on the same connection (e.g. a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice. One transaction per migration: a
  // failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}
