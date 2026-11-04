// Opens the system share sheet for a timer (U8): a message with the link, or the `.json` file for very large timers
// (share-payload.ts). Nothing leaves the phone unless the user picks a target in the sheet.
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { formatDuration } from '@/engine/format';
import type { TimerDef } from '@/engine/model';
import { plannedSeconds } from '@/engine/validation';

import { sharePayload } from './share-payload';

export async function shareTimer(def: TimerDef): Promise<void> {
  const scheme = Constants.expoConfig?.scheme;
  const p = sharePayload(def, plannedSeconds(def), formatDuration, typeof scheme === 'string' ? scheme : undefined);
  if (p.kind === 'link') {
    await Share.share({ message: p.message });
    return;
  }
  const dir = new Directory(Paths.cache, 'share');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, p.fileName);
  file.write(p.content);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: def.name });
}
