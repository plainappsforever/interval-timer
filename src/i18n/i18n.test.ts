import { applyLanguagePreferenceWith } from './apply';
import { de } from './de';
import { en } from './en';
import { getLanguage, LANGUAGE_NAMES, LANGUAGES, languageOfTag, makeT, messages, resolveLanguage, setLanguage, subscribeLanguage, translate, translatePlain } from './index';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('i18n (D23)', () => {
  afterEach(() => setLanguage('en'));

  it('all 15 languages define exactly the English keys, no empty text, the same placeholders', () => {
    expect(LANGUAGES).toHaveLength(15);
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const language of LANGUAGES) {
      const texts = messages[language];
      expect(Object.keys(texts).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect([language, key, texts[key].trim() === '']).toEqual([language, key, false]);
        expect([language, key, placeholders(texts[key])]).toEqual([language, key, placeholders(en[key])]);
      }
      expect(LANGUAGE_NAMES[language]).not.toBe('');
    }
  });

  it('returns a different translator function per language (React Compiler memoises on identity)', () => {
    const enT = makeT('en');
    const deT = makeT('de');
    expect(deT).not.toBe(enT);
    expect(makeT('en')).toBe(enT);
    expect(enT('cue.work')).toBe('Work');
    expect(deT('cue.work')).toBe('Belastung');
  });

  it('switching the language notifies subscribers once per change', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLanguage(() => seen.push(getLanguage()));
    setLanguage('de');
    setLanguage('de');
    setLanguage('ja');
    unsubscribe();
    setLanguage('en');
    expect(seen).toEqual(['de', 'ja']);
  });

  it('interpolates params; Arabic wraps values in bidi isolates, the plain variant (voice) never does', () => {
    expect(translate('de', 'cue.round', { n: 3, total: 8 })).toBe('Runde 3 von 8');
    expect(translate('ar', 'cue.round', { n: 3, total: 8 })).toBe('الجولة ⁨3⁩ من ⁨8⁩');
    expect(translatePlain('ar', 'cue.round', { n: 3, total: 8 })).toBe('الجولة 3 من 8');
    expect(translate('en', 'cue.round', { n: 1 })).toBe('Round 1 of {total}');
  });

  it('maps device tags to languages and resolves the preference', () => {
    expect(languageOfTag('de-AT')).toBe('de');
    expect(languageOfTag('pt-PT')).toBe('pt-BR');
    expect(languageOfTag('zh-Hant-TW')).toBeUndefined();
    expect(languageOfTag('zh-Hans-CN')).toBe('zh-CN');
    expect(languageOfTag('zh')).toBe('zh-CN');
    expect(languageOfTag('in-ID')).toBe('id');
    expect(languageOfTag('xx')).toBeUndefined();
    expect(resolveLanguage('system', ['zh-TW', 'ko-KR'])).toBe('ko');
    expect(resolveLanguage('system', [])).toBe('en');
    expect(resolveLanguage('fr', ['ko-KR'])).toBe('fr');
    applyLanguagePreferenceWith('system', ['tr-TR']);
    expect(getLanguage()).toBe('tr');
  });
});
