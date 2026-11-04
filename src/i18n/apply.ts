import { resolveLanguage, setLanguage, type LanguagePreference } from './index';

export type { LanguagePreference };

/** Sets the UI language from the preference and the device's language tags (pure of expo-localization: testable). */
export function applyLanguagePreferenceWith(preference: LanguagePreference, deviceTags: readonly string[]) {
  setLanguage(resolveLanguage(preference, deviceTags));
}
