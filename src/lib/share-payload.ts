// What "Share" sends (SPEC §5.5, U8, D19, REVIEW S6): the timer in words plus a link for normal timers; a `.json`
// file when the link would be too long for messengers (a maximal 20 × 30 timer is ~18 KB). Pure.
import type { TimerDef } from '@/engine/model';
import { encodeTimerFile, encodeTimerLink, SHARE_SCHEME, describeTimer } from '@/engine/share-codec';

/** Links longer than this go out as a file instead (many messengers cut or refuse very long URLs). */
export const LINK_MAX_CHARS = 2000;

export type SharePayload = { kind: 'link'; message: string; url: string } | { kind: 'file'; fileName: string; content: string; message: string };

/** `scheme`: this build's URL scheme, so a dev or preview build shares links that open the same variant. */
export function sharePayload(def: TimerDef, plannedS: number, format: (s: number) => string, scheme: string = SHARE_SCHEME): SharePayload {
  const words = describeTimer(def, format, plannedS);
  const url = encodeTimerLink(def).replace(`${SHARE_SCHEME}://`, `${scheme}://`);
  if (url.length <= LINK_MAX_CHARS) return { kind: 'link', message: `${words}\n${url}`, url };
  return { kind: 'file', fileName: `${fileStem(def.name)}.json`, content: encodeTimerFile(def), message: words };
}

function fileStem(name: string): string {
  const stem = name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(stem).slice(0, 40).join('') || 'timer';
}
