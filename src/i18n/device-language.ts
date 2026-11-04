// The device's preferred languages via expo-localization (native module; not importable in plain Node engine scripts,
// so it lives apart from index.ts).
import { getLocales } from 'expo-localization';

import { applyLanguagePreferenceWith, type LanguagePreference } from './apply';

/** The phone's language list, most preferred first (iOS `Locale.preferredLanguages`); Intl as the fallback. */
export function deviceLanguageTags(): string[] {
  try {
    const tags = getLocales()
      .map((l) => l.languageTag)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tags.length > 0) return tags;
  } catch {
    // no native module (Node) - fall through
  }
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

export function applyLanguagePreference(preference: LanguagePreference) {
  applyLanguagePreferenceWith(preference, deviceLanguageTags());
}
