// Import (SPEC §7 screen 7, U8, D19): opened by a share link (`<scheme>://t?d=…`, route `t`), or from the home screen
// to paste a link / file text or pick a `.json` file → preview → Save as new timer. The share codec enforces every
// limit and never throws (A11); nothing here touches the network.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { createTimer } from '@/db/timers';
import { formatDuration } from '@/engine/format';
import { decodeTimerLink, decodeTimerText, describeTimer, type DecodeResult } from '@/engine/share-codec';
import { plannedSeconds } from '@/engine/validation';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { otherActiveRun } from '@/lib/active-run';

export default function ImportScreen() {
  const { d } = useLocalSearchParams<{ d?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const [text, setText] = useState('');
  const [read, setResult] = useState<DecodeResult | null>(null);
  const [busy, setBusy] = useState(false);
  // SPEC §9 two sessions (D41): a share link that arrives mid-workout opens this screen over the running one; saving
  // must lead back to the workout, never replace it.
  const [running] = useState(() => otherActiveRun()?.timerName ?? null);
  const fromLink = useMemo(() => (typeof d === 'string' && d.length > 0 ? decodeTimerLink(`link://t?d=${d}`) : null), [d]);
  // what the user read or picked here wins over the link the screen was opened with
  const result = read ?? fromLink;

  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    try {
      setResult(decodeTimerText(await new File(picked.assets[0].uri).text()));
    } catch {
      setResult({ ok: false, reason: 'format' });
    }
  }

  async function save() {
    if (!result?.ok) return;
    setBusy(true);
    try {
      await createTimer(db, result.def);
      if (running && router.canGoBack()) router.back();
      else router.dismissTo('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('import.title') }} />
      <ScrollView
        testID="import-screen"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        {running ? (
          <View testID="import-running" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{t('import.running', { name: running })}</ThemedText>
            <Button testID="import-back-to-run" variant="secondary" label={t('import.backToRun')} onPress={() => router.back()} />
          </View>
        ) : null}
        {result?.ok ? (
          <View testID="import-preview" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText testID="import-preview-name" type="subtitle">
              {result.def.name}
            </ThemedText>
            <ThemedText testID="import-preview-total" type="smallBold">
              {t('editor.total', {
                time: formatDuration(plannedSeconds(result.def)),
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {describeTimer(result.def, formatDuration, plannedSeconds(result.def))}
            </ThemedText>
            <Button testID="import-save" label={t('import.save')} disabled={busy} onPress={save} />
          </View>
        ) : null}
        {result && !result.ok ? (
          <ThemedText testID="import-error" style={{ color: theme.danger }}>
            {result.reason === 'version' ? t('import.version') : t('import.invalid')}
          </ThemedText>
        ) : null}
        <TextInput
          testID="import-text"
          accessibilityLabel={t('import.paste')}
          placeholder={t('import.paste')}
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        />
        <Button
          testID="import-read"
          variant="secondary"
          label={t('import.read')}
          disabled={text.trim() === ''}
          onPress={() => setResult(decodeTimerText(text))}
        />
        <Button testID="import-file" variant="secondary" label={t('import.file')} onPress={pickFile} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
    minHeight: 80,
    fontSize: 14,
    textAlignVertical: 'top',
  },
});
