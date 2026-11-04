import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { defaultDatabaseDirectory, type SQLiteDatabase } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

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
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Portrait everywhere except the running screen (SPEC §3: landscape on the running screen). */}
      <Stack screenOptions={{ orientation: 'portrait' }}>
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
