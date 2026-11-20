// Done (SPEC §7 screen 4, D24, A10): the history row is already written when this opens (RunSession.finish); planned
// vs actual, completed or ended early, skipped intervals, pauses, "resumed after an interruption", and a note.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { getSession, updateSessionNote, type Session } from '@/db/sessions';
import { formatDuration } from '@/engine/format';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { maybeAskForRating } from '@/lib/rating';
import { armStart } from '@/lib/start-intent';

const NOTE_MAX = 500;

export default function DoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    getSession(db, Number(id)).then((s) => {
      setSession(s);
      setNote(s?.note ?? '');
      // After a workout that ran to its end, once enough of them are behind the user (src/lib/rating.ts decides).
      if (s?.completed) maybeAskForRating(db);
    });
  }, [db, id]);

  async function saveNote() {
    if (session && note !== session.note) {
      await updateSessionNote(db, session.id, note);
      setSession({ ...session, note });
    }
  }

  async function close() {
    await saveNote();
    router.dismissTo('/');
  }

  async function again() {
    await saveNote();
    if (!session?.timerId) return;
    armStart(session.timerId);
    router.replace({ pathname: '/run/[id]', params: { id: String(session.timerId) } });
  }

  const row = (testID: string, label: string, value: string) => (
    <View style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText testID={testID} type="smallBold">
        {value}
      </ThemedText>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: t('done.title'), headerBackVisible: false, gestureEnabled: false }} />
      <ScrollView testID="done-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {session ? (
          <>
            <ThemedText type="subtitle">{session.timerName}</ThemedText>
            <ThemedText testID="done-result" type="smallBold" style={{ color: session.completed ? theme.tint : theme.danger }}>
              {session.completed ? t('done.completed') : t('done.endedEarly')}
            </ThemedText>
            {row('done-planned', t('done.planned'), session.plannedS === null ? '—' : formatDuration(session.plannedS))}
            {row('done-actual', t('done.actual'), formatDuration(session.actualS))}
            {row('done-skipped', t('done.skipped'), String(session.skippedIntervals))}
            {row('done-pauses', t('done.pauses'), String(session.pauses))}
            {session.interrupted ? (
              <ThemedText testID="done-interrupted" type="small" themeColor="textSecondary">
                {t('done.interrupted')}
              </ThemedText>
            ) : null}
            <ThemedText testID="done-saved" type="small" themeColor="textSecondary">
              {t('done.saved')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('done.note')}
            </ThemedText>
            <TextInput
              testID="done-note"
              accessibilityLabel={t('done.note')}
              placeholder={t('done.notePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              value={note}
              onChangeText={(text) => setNote(text.slice(0, NOTE_MAX))}
              onBlur={saveNote}
              multiline
              style={[styles.note, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <Button testID="done-close" label={t('done.close')} onPress={close} />
            {session.timerId ? <Button testID="done-again" variant="secondary" label={t('done.again')} onPress={again} /> : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  note: { borderWidth: 1, borderRadius: Radius.control, padding: Spacing.two, minHeight: 80, fontSize: 16, textAlignVertical: 'top' },
});
