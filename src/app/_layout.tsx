import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { defaultDatabaseDirectory, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { BrandFonts, Colors } from '@/constants/theme';
import { migrate } from '@/db/migrations';
import { DatabaseProvider } from '@/db/provider';
import { readSettings } from '@/db/settings';
import { seedTemplatesOnce } from '@/db/templates';
import { getLanguage, makeT } from '@/i18n';
import { applyLanguagePreference } from '@/i18n/device-language';
import { excludeFromBackup, nativeBackupExclusion } from '@/lib/backup-exclusion';
import { backupsFolderUri } from '@/lib/files';
import { applyThemePreference } from '@/lib/theme-preference';

async function initDatabase(db: SQLiteDatabase) {
  // D12 / D44.2: iOS backups skip the database folder and the app's own backup files; re-applied every launch, never
  // blocks (the result is diagnostics material). Android: plugins/with-backup-rules.js.
  void excludeFromBackup(defaultDatabaseDirectory, nativeBackupExclusion);
  void excludeFromBackup(backupsFolderUri(), nativeBackupExclusion);
  await migrate(db);
  const settings = await readSettings(db);
  applyThemePreference(settings.theme);
  applyLanguagePreference(settings.language);
  await seedTemplatesOnce(db, makeT(getLanguage()));
}

// D24: header, back button and screen backgrounds follow the brand tokens instead of React Navigation's iOS blue.
function navigationTheme(dark: boolean): Theme {
  const base = dark ? DarkTheme : DefaultTheme;
  const c = Colors[dark ? 'dark' : 'light'];
  const font = (f: Theme['fonts']['regular']) => ({ ...f, fontFamily: BrandFonts.body });
  return {
    ...base,
    colors: { ...base.colors, primary: c.tintText, background: c.background, card: c.background, text: c.text, border: c.border },
    fonts: {
      regular: font(base.fonts.regular),
      medium: font(base.fonts.medium),
      bold: font(base.fonts.bold),
      heavy: font(base.fonts.heavy),
    },
  };
}
const NAV_THEMES = { light: navigationTheme(false), dark: navigationTheme(true) };

export default function RootLayout() {
  return (
    <DatabaseProvider onInit={initDatabase}>
      <Navigator />
    </DatabaseProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={NAV_THEMES[scheme === 'dark' ? 'dark' : 'light']}>
      {/* Explicit style: the clock must follow the app's own light/dark choice, not the phone's. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* Portrait everywhere except the running screen (SPEC §3: landscape on the running screen). */}
      <Stack screenOptions={{ orientation: 'portrait', headerTitleStyle: { fontFamily: BrandFonts.title } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="timer/[id]" />
        <Stack.Screen name="run/[id]" options={{ headerShown: false, gestureEnabled: false, orientation: 'all', animation: 'fade' }} />
        <Stack.Screen name="done/[id]" />
        <Stack.Screen name="import" />
        <Stack.Screen name="t" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="history/index" />
        <Stack.Screen name="history/[id]" />
      </Stack>
    </ThemeProvider>
  );
}
