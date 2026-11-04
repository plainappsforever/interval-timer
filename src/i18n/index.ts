// UI languages (D23, print-cost D90 pattern): one file per language with exactly en.ts's keys. Screens call `useT()`
// (src/hooks/use-t.ts); engines receive a translator function so they stay free of module state.
import { ar } from './ar';
import { de } from './de';
import { en, type MessageKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { hi } from './hi';
import { id } from './id';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { ptBR } from './pt-BR';
import { ru } from './ru';
import { tr } from './tr';
import { vi } from './vi';
import { zhCN } from './zh-CN';

export type { MessageKey };
export type Language = 'en' | 'de' | 'es' | 'pt-BR' | 'fr' | 'it' | 'tr' | 'ru' | 'id' | 'hi' | 'ja' | 'zh-CN' | 'ko' | 'vi' | 'ar';
/** What the user picked in Settings: a language, or follow the device. */
export type LanguagePreference = 'system' | Language;
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

export const LANGUAGES: readonly Language[] = ['en', 'de', 'es', 'pt-BR', 'fr', 'it', 'tr', 'ru', 'id', 'hi', 'ja', 'zh-CN', 'ko', 'vi', 'ar'];
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', ...LANGUAGES];
export const DEFAULT_LANGUAGE: Language = 'en';

export const messages: Record<Language, Record<MessageKey, string>> = {
  en,
  de,
  es,
  'pt-BR': ptBR,
  fr,
  it,
  tr,
  ru,
  id,
  hi,
  ja,
  'zh-CN': zhCN,
  ko,
  vi,
  ar,
};

/** Each language's own name, the same in every UI language. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  it: 'Italiano',
  tr: 'Türkçe',
  ru: 'Русский',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  ja: '日本語',
  'zh-CN': '简体中文',
  ko: '한국어',
  vi: 'Tiếng Việt',
  ar: 'العربية',
};

/**
 * The supported language a BCP-47 tag means: 'de', 'de-DE' and 'de_AT' are German; every Portuguese is pt-BR; Chinese is
 * zh-CN only in Simplified script (zh, zh-Hans*, zh-CN, zh-SG); Traditional is not offered (undefined → next tag or
 * English); the old code 'in' is Indonesian.
 */
export function languageOfTag(tag: string): Language | undefined {
  const [primary = '', ...rest] = tag.replace(/_/g, '-').toLowerCase().split('-');
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'in') return 'id';
  if (primary === 'zh') {
    const traditional = rest.includes('hant') || (!rest.includes('hans') && rest.some((r) => r === 'tw' || r === 'hk' || r === 'mo'));
    return traditional ? undefined : 'zh-CN';
  }
  return LANGUAGES.find((l) => l === primary);
}

/** The preference if set, else the first of the device's preferred languages the app speaks, else English. */
export function resolveLanguage(preference: LanguagePreference, deviceTags: string | readonly string[] | undefined): Language {
  if (preference !== 'system') return preference;
  const tags = typeof deviceTags === 'string' ? [deviceTags] : (deviceTags ?? []);
  for (const tag of tags) {
    const language = languageOfTag(tag);
    if (language) return language;
  }
  return DEFAULT_LANGUAGE;
}

/** Right-to-left UI languages: filled-in values are wrapped in Unicode isolates so "Round 3 of 8" digits stay in place. */
const RTL_LANGUAGES: readonly Language[] = ['ar'];
const isolate = (value: string) => `⁨${value}⁩`;

export function translate(language: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const text = messages[language][key];
  if (!params) return text;
  const wrap = RTL_LANGUAGES.includes(language);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? (wrap ? isolate(String(params[name])) : String(params[name])) : whole));
}

/** Voice cue texts must never carry the bidi isolates: the synthesizer would read them or stumble. */
export function translatePlain(language: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const text = messages[language][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const translators: Partial<Record<Language, Translator>> = {};

/** One translator per language: stable for a language, a different function per language (React Compiler, CLAUDE.md). */
export function makeT(language: Language): Translator {
  return (translators[language] ??= (key, params) => translate(language, key, params));
}

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  listeners.forEach((l) => l());
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key in the current language (outside React only; components use `useT()`). */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(current, key, params);
}
