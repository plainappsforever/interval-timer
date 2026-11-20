// Settings (SPEC §4): one row per key, the value stored as JSON. Every key has a default and a guard, so a damaged or
// outdated row falls back to the default instead of crashing a screen.
import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'en' | 'de' | 'es' | 'pt-BR' | 'fr' | 'it' | 'tr' | 'ru' | 'id' | 'hi' | 'ja' | 'zh-CN' | 'ko' | 'vi' | 'ar';
export type CountdownFrom = 3 | 5 | 10;
export type BeepSet = 'classic' | 'soft' | 'bright';

export type Settings = {
  language: LanguagePreference;
  theme: ThemePreference;
  keepScreenOn: boolean;
  voiceEnabled: boolean;
  /** Platform voice identifier chosen in Settings; null = the system default voice for the language. */
  voiceId: string | null;
  beepSet: BeepSet;
  /** 0..1 */
  volume: number;
  haptics: boolean;
  /** iOS Live Activity, opt-in (D18); default off (orchestrator default D27). */
  liveActivity: boolean;
  countdownFrom: CountdownFrom;
  halfwayDefault: boolean;
  /** Cues respect the iOS silent switch / Android silent mode. Default off: a workout timer must be heard (D16, D27). */
  respectSilent: boolean;
  lastTimerId: number | null;
  /** Running-session recovery record (D13), JSON produced by src/engine/recovery.ts; null when nothing is running. */
  recovery: unknown;
  templatesSeeded: boolean;
  /** The "no voice installed for this language" note was shown once (D15). */
  voiceNoteShown: boolean;
  /** App version the rating prompt was last requested in (src/lib/rating.ts); null = never. At most once per version. */
  ratingAskedVersion: string | null;
};

const LANGUAGES: readonly LanguagePreference[] = ['system', 'en', 'de', 'es', 'pt-BR', 'fr', 'it', 'tr', 'ru', 'id', 'hi', 'ja', 'zh-CN', 'ko', 'vi', 'ar'];
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const BEEP_SETS: readonly BeepSet[] = ['classic', 'soft', 'bright'];

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf =
  <T>(values: readonly T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T);
const isNullableId = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0);

type Spec<T> = { key: string; fallback: T; guard: (v: unknown) => v is T };

const SPECS: { [K in keyof Settings]: Spec<Settings[K]> } = {
  language: { key: 'language', fallback: 'system', guard: oneOf(LANGUAGES) },
  theme: { key: 'theme', fallback: 'system', guard: oneOf(THEMES) },
  keepScreenOn: { key: 'keep_screen_on', fallback: true, guard: isBool },
  voiceEnabled: { key: 'voice_enabled', fallback: true, guard: isBool },
  voiceId: { key: 'voice_id', fallback: null, guard: (v): v is string | null => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 200) },
  beepSet: { key: 'beep_set', fallback: 'classic', guard: oneOf(BEEP_SETS) },
  volume: { key: 'volume', fallback: 1, guard: (v): v is number => typeof v === 'number' && v >= 0 && v <= 1 },
  haptics: { key: 'haptics', fallback: true, guard: isBool },
  liveActivity: { key: 'live_activity', fallback: false, guard: isBool },
  countdownFrom: { key: 'countdown_from', fallback: 3, guard: oneOf([3, 5, 10] as const) },
  halfwayDefault: { key: 'halfway_default', fallback: false, guard: isBool },
  respectSilent: { key: 'respect_silent', fallback: false, guard: isBool },
  lastTimerId: { key: 'last_timer_id', fallback: null, guard: isNullableId },
  recovery: { key: 'recovery', fallback: null, guard: (v): v is unknown => v === null || (typeof v === 'object' && !Array.isArray(v)) },
  templatesSeeded: { key: 'templates_seeded', fallback: false, guard: isBool },
  voiceNoteShown: { key: 'voice_note_shown', fallback: false, guard: isBool },
  ratingAskedVersion: { key: 'rating_asked_version', fallback: null, guard: (v): v is string | null => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 32) },
};

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(Object.entries(SPECS).map(([k, s]) => [k, s.fallback])) as Settings;

function parse(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Reads every setting (missing or invalid rows → defaults). */
export async function readSettings(db: Db): Promise<Settings> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(SPECS)) {
    const value = parse(byKey.get(spec.key));
    out[name] = value !== undefined && spec.guard(value) ? value : spec.fallback;
  }
  return out as Settings;
}

export async function getSetting<K extends keyof Settings>(db: Db, name: K): Promise<Settings[K]> {
  const spec = SPECS[name] as Spec<Settings[K]>;
  const row = await withRead(db, (r) => r.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', spec.key));
  const value = parse(row?.value);
  return value !== undefined && spec.guard(value) ? value : spec.fallback;
}

export function setSetting<K extends keyof Settings>(db: Db, name: K, value: Settings[K]): Promise<void> {
  const spec = SPECS[name] as Spec<Settings[K]>;
  if (!spec.guard(value)) return Promise.reject(new Error(`invalid value for setting ${name}`));
  return withWrite(db, async (tx) => {
    await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', spec.key, JSON.stringify(value));
  });
}

export function getThemePreference(db: Db): Promise<ThemePreference> {
  return getSetting(db, 'theme');
}

export function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, 'theme', theme);
}
