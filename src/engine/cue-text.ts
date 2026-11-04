// Voice texts and clip ids for cues (SPEC §5.1, D15). Texts come from the i18n keys in the cue language; the clip id
// is a stable hash of (language, voiceId, text) so pre-rendered clips are cached and shared between timers. Pure.
import { translatePlain, type Language } from '@/i18n';

import type { CueKind } from './schedule-types';

/** The spoken text of a cue, or null when the cue has no voice part (open-interval ticks). */
export function cueText(kind: CueKind, language: Language, ctx: { label?: string; n?: number; total?: number }): string | null {
  switch (kind) {
    case 'start':
      return ctx.label ?? '';
    case 'round':
      return translatePlain(language, 'cue.round', { n: ctx.n ?? 0, total: ctx.total ?? 0 });
    case 'halfway':
      return translatePlain(language, 'cue.halfway');
    case 'countdown': {
      const n = ctx.n ?? 0;
      return n >= 1 && n <= 10 ? translatePlain(language, `cue.number.${n}` as `cue.number.${1}`) : String(n);
    }
    case 'end':
      return translatePlain(language, 'cue.done');
    case 'openTick':
      return null;
  }
}

/** FNV-1a 32-bit hash as 8 hex digits: a stable, dependency-free clip id. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Clip id of a rendered voice text: `v-<hash>`; the same text in the same voice always maps to the same clip. */
export function voiceClipId(language: Language, voiceId: string | null, text: string): string {
  return `v-${fnv1a(`${language}|${voiceId ?? ''}|${text}`)}`;
}

/** Beep clip per cue kind (the three generated beep sets share these names; the set is chosen at play time). */
export const BEEP_CLIP: Record<CueKind, string> = {
  start: 'beep-start',
  round: 'beep-start',
  halfway: 'beep-halfway',
  countdown: 'beep-tick',
  end: 'beep-end',
  openTick: 'beep-tick',
};
