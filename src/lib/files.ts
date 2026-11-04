// Files the user takes out of the app or brings back (SPEC §5.6, U10, A11): the history CSV and backups. Backups are
// kept in the app's documents folder (`backups/`, newest first in Settings > Restore) and can be shared to Files,
// Drive or a message from there; a backup from another phone comes in through the system file picker. Nothing here
// touches the network: a file leaves the phone only through a share target the user picks.
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { BACKUP_FORMAT } from '@/engine/backup';

const two = (n: number) => String(n).padStart(2, '0');

/** `2026-10-26-0705` in local time (file names sort by time). */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

export function backupFileName(ms: number): string {
  return `${BACKUP_FORMAT}-${stamp(ms)}.json`;
}

export function csvFileName(ms: number): string {
  return `plainintervals-history-${stamp(ms)}.csv`;
}

function folder(base: Directory, name: string): Directory {
  const dir = new Directory(base, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const backupsDir = () => folder(Paths.document, 'backups');

/** documents/backups as a file:// URI, for the iOS backup exclusion at launch (D44.2; Android: with-backup-rules.js). */
export const backupsFolderUri = (): string => new Directory(Paths.document, 'backups').uri;

/** Writes a backup into documents/backups and returns the file. Same-minute backups get a counter. */
export function saveBackupFile(json: string, now = Date.now()): File {
  const dir = backupsDir();
  let file = new File(dir, backupFileName(now));
  for (let n = 2; file.exists; n++) file = new File(dir, backupFileName(now).replace(/\.json$/, `-${n}.json`));
  file.write(json);
  return file;
}

export type SavedBackup = { name: string; uri: string; size: number };

/** Backups made on this phone, newest first. */
export function listBackupFiles(): SavedBackup[] {
  try {
    return backupsDir()
      .list()
      .filter((e): e is File => e instanceof File && e.name.endsWith('.json'))
      .map((f) => ({ name: f.name, uri: f.uri, size: f.size ?? 0 }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export function readTextFile(uri: string): Promise<string> {
  return new File(uri).text();
}

export async function shareFile(uri: string, mimeType: string, uti: string, title: string): Promise<void> {
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: title });
}

/** Writes the CSV into the cache and opens the share sheet. */
export async function shareCsv(csv: string, title: string, now = Date.now()): Promise<void> {
  const file = new File(folder(Paths.cache, 'export'), csvFileName(now));
  file.write(csv);
  await shareFile(file.uri, 'text/csv', 'public.comma-separated-values-text', title);
}
