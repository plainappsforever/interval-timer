// Zone mechanics for the blind runners (L34). Assigning process.env.TZ inside a running process is not a reliable way to
// change the zone, so a zone case is computed only in a process that was STARTED with that zone (TZ set from outside).
// In any other process the case is returned as `{needZone}`; resolveZoneCases() then re-runs the same script once per
// missing zone in a child process (TZ=<zone>) and takes those cases from the child's results.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Json = unknown;
const ICU_NAMES: Record<string, string[]> = { UTC: ['Etc/UTC', 'UTC'], 'Asia/Kolkata': ['Asia/Calcutta'] };

export function processZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function inZone(zone: string): boolean {
  let canonical = zone;
  try {
    canonical = Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    // unknown name: fall back to the name as written
  }
  return [zone, canonical, ...(ICU_NAMES[zone] ?? [])].includes(processZone());
}

/** Runs fn when this process really runs in `zone`, else marks the case for a child process of that zone. */
export function zoneCase<T>(zone: string, fn: () => T): T {
  if (inZone(zone)) return fn();
  return { needZone: zone } as unknown as T;
}

const needsZone = (v: Json): string | null => (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { needZone?: unknown }).needZone === 'string' ? (v as { needZone: string }).needZone : null);

/**
 * Replaces every `{needZone}` placeholder in `results` by the value a child process (this script, TZ=zone) computed.
 * `extract` pulls the results map out of what the script writes (the whole object for B2, `.results` for B1).
 * In a child (env BLIND_ZONE_CHILD set) it does nothing.
 */
export function resolveZoneCases(results: Record<string, Json>, scriptArgs: (outFile: string) => string[], extract: (written: Json) => Record<string, Json>): void {
  if (process.env.BLIND_ZONE_CHILD) return;
  const zones = new Set<string>();
  for (const v of Object.values(results)) {
    const z = needsZone(v);
    if (z) zones.add(z);
  }
  const root = path.resolve(import.meta.dirname, '..');
  const dir = path.join(root, 'artifacts', 'tz');
  fs.mkdirSync(dir, { recursive: true });
  for (const zone of zones) {
    const outFile = path.join(dir, `interval-timer-child-${zone.replace(/\W/g, '_')}.json`);
    const r = spawnSync(process.execPath, [...process.execArgv, ...scriptArgs(outFile)], {
      cwd: root,
      env: { ...process.env, TZ: zone, BLIND_ZONE_CHILD: '1' },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`zone child ${zone} failed: ${(r.stderr || '').slice(-400)}`);
    const child = extract(JSON.parse(fs.readFileSync(outFile, 'utf8')));
    for (const [id, v] of Object.entries(results)) {
      if (needsZone(v) === zone) {
        const got = child[id];
        if (needsZone(got)) throw new Error(`zone child ${zone} did not run in that zone (case ${id})`);
        results[id] = got;
      }
    }
  }
}
