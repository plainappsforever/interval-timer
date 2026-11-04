// Development-only: seeds 500 timers for the A9 list/search check. Not linked from the UI; open with the deep link
// `plainintervals-dev://debug/seed`. Does nothing in preview/production builds.
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import VoiceRender from '../../../modules/voice-render/src/VoiceRenderModule';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { seedManyTimers } from '@/db/dev-seed';
import { useSQLiteContext } from '@/db/provider';
import { countTimers } from '@/db/timers';
import { useTheme } from '@/hooks/use-theme';
import { LANGUAGES } from '@/i18n';
import { VOICE_LOCALE } from '@/lib/voice';

export default function DebugSeedScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [status, setStatus] = useState('');
  const development = Constants.expoConfig?.extra?.appVariant === 'development';

  // A12: which of the 15 voice languages this phone/simulator/emulator can speak offline (reported, not promised)
  async function voiceTable() {
    if (!VoiceRender) return setStatus('voice-render module missing');
    const rows: string[] = [];
    for (const lang of LANGUAGES) {
      const locale = VOICE_LOCALE[lang];
      const all = await VoiceRender.voices(locale.split('-')[0]);
      const exact = all.filter((v) => v.language.replace('_', '-').toLowerCase() === locale.toLowerCase()).length;
      rows.push(`${lang}:${exact}/${all.length}`);
    }
    const line = `voices exact/any ${rows.join(' ')}`;
    console.log(`[A12] ${line}`);
    setStatus(line);
  }

  async function seed() {
    const t0 = performance.now();
    await seedManyTimers(db, 500);
    setStatus(`seeded 500 in ${Math.round(performance.now() - t0)} ms; ${await countTimers(db)} timers`);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Debug: seed' }} />
      <ScrollView testID="debug-seed-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {development ? <Button testID="seed-500" label="Seed 500 timers" onPress={seed} /> : <ThemedText>Development builds only.</ThemedText>}
        {development ? <Button testID="voice-table" variant="secondary" label="Voice table (A12)" onPress={voiceTable} /> : null}
        {status ? <ThemedText testID="seed-status">{status}</ThemedText> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
});
