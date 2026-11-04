// Pre-rendered voice cues (D15, SPEC §6.2): before Start, every distinct voice text of the timer (all steps, also after
// open intervals — voiceClipsForTimer, REVIEW N1) is rendered once by modules/voice-render into
// Paths.cache/voice/<clipId>.<caf|wav> and reused by clip id (language + voice + text). A clip that cannot be rendered
// is simply missing: its cue beeps instead (runner-cues.ts) and live speech remains the foreground fallback.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import VoiceRender from '../../modules/voice-render/src/VoiceRenderModule';
import type { TimerDef } from '@/engine/model';
import { voiceClipsForTimer, type buildTimeline } from '@/engine/schedule';
import type { Language } from '@/i18n';

import type { VoiceClip } from './runner-cues';

/** The synthesizer locale per UI language (D23; the Settings voice table in P7 builds on this). */
export const VOICE_LOCALE: Record<Language, string> = {
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  'pt-BR': 'pt-BR',
  fr: 'fr-FR',
  it: 'it-IT',
  tr: 'tr-TR',
  ru: 'ru-RU',
  id: 'id-ID',
  hi: 'hi-IN',
  ja: 'ja-JP',
  'zh-CN': 'zh-CN',
  ko: 'ko-KR',
  vi: 'vi-VN',
  ar: 'ar-SA',
};

export type PrepareResult = {
  clips: Map<string, VoiceClip>;
  rendered: number;
  cached: number;
  failed: { text: string; reason: string }[];
  ms: number;
  /** false when the module is missing (Jest, web, a build without it): every cue beeps. */
  available: boolean;
};

type Index = Record<string, { file: string; durationMs: number }>;

const dir = () => new Directory(Paths.cache, 'voice');
const indexFile = () => new File(dir(), 'index.json');
/** Absolute path without the file:// scheme, as the native modules expect. */
export const pathOf = (f: File) => decodeURIComponent(f.uri.replace(/^file:\/\//, ''));

function readIndex(): Index {
  try {
    const f = indexFile();
    return f.exists ? (JSON.parse(f.textSync()) as Index) : {};
  } catch {
    return {};
  }
}

export async function prepareVoiceClips(def: TimerDef, options: Parameters<typeof buildTimeline>[1]): Promise<PrepareResult> {
  const t0 = Date.now();
  const res: PrepareResult = { clips: new Map(), rendered: 0, cached: 0, failed: [], ms: 0, available: VoiceRender !== null };
  if (!VoiceRender) return res;
  const d = dir();
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  const index = readIndex();
  const ext = Platform.OS === 'ios' ? 'caf' : 'wav';
  const locale = VOICE_LOCALE[options.language];
  for (const { clipId, text } of voiceClipsForTimer(def, options)) {
    const known = index[clipId];
    if (known && new File(d, known.file).exists) {
      res.clips.set(clipId, { path: pathOf(new File(d, known.file)), durationMs: known.durationMs });
      res.cached++;
      continue;
    }
    const file = new File(d, `${clipId}.${ext}`);
    // one render at a time (the native modules are not re-entrant)
    const r = await VoiceRender.render(text, locale, options.voiceId, pathOf(file));
    if (r.ok) {
      index[clipId] = { file: `${clipId}.${ext}`, durationMs: Math.round(r.durationMs) };
      res.clips.set(clipId, { path: r.path, durationMs: Math.round(r.durationMs) });
      res.rendered++;
    } else {
      res.failed.push({ text, reason: r.message ? `${r.reason}: ${r.message}` : r.reason });
    }
  }
  try {
    indexFile().write(JSON.stringify(index));
  } catch {
    // the cache index is an optimisation; the clips are re-rendered next time
  }
  res.ms = Date.now() - t0;
  return res;
}
