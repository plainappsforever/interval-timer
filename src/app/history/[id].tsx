// One history session (SPEC §7 screen 5): when, planned vs actual, completed or ended early, skipped intervals,
// pauses, "resumed after an interruption", the note (editable) and Delete (asks first, in-screen, D39.5).
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { deleteSession, getSession, updateSessionNote, type Session } from '@/db/sessions';
import { formatDuration } from '@/engine/format';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';

const NOTE_MAX = 500;

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    getSession(db, Number(id)).then((s) => {
      setSession(s);
      setNote(s?.note ?? '');
    });
  }, [db, id]);

  async function saveNote() {
    Keyboard.dismiss();
    if (session && note !== session.note) {
      await updateSessionNote(db, session.id, note);
      setSession({ ...session, note });
    }
  }

  async function remove() {
    if (!session) return;
    setConfirmDelete(false);
    await deleteSession(db, session.id);
    router.back();
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
      <Stack.Screen options={{ title: session?.timerName ?? '' }} />
      <ScrollView testID="session-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {session ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(session.startedAt).toLocaleString(language, { dateStyle: 'full', timeStyle: 'short' })}
            </ThemedText>
            <ThemedText testID="session-result" type="smallBold" style={{ color: session.completed ? theme.tint : theme.danger }}>
              {session.completed ? t('done.completed') : t('done.endedEarly')}
            </ThemedText>
            {row('session-planned', t('done.planned'), session.plannedS === null ? '—' : formatDuration(session.plannedS))}
            {row('session-actual', t('done.actual'), formatDuration(session.actualS))}
            {row('session-skipped', t('done.skipped'), String(session.skippedIntervals))}
            {row('session-pauses', t('done.pauses'), String(session.pauses))}
            {session.interrupted ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('done.interrupted')}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {t('done.note')}
            </ThemedText>
            <TextInput
              testID="session-note"
              accessibilityLabel={t('done.note')}
              placeholder={t('done.notePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              value={note}
              onChangeText={(text) => setNote(text.slice(0, NOTE_MAX))}
              onBlur={saveNote}
              multiline
              style={[styles.note, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <Button testID="session-save-note" variant="secondary" label={t('history.saveNote')} disabled={note === session.note} onPress={saveNote} />
            <Button testID="session-delete" variant="secondary" label={t('common.delete')} onPress={() => setConfirmDelete(true)} />
          </>
        ) : null}
      </ScrollView>
      {confirmDelete ? (
        <View style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: theme.scrim }]} accessibilityViewIsModal>
          <View testID="session-delete-dialog" style={[styles.dialog, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">{t('history.deleteTitle')}</ThemedText>
            <Button testID="session-delete-confirm" label={t('common.delete')} onPress={remove} />
            <Button testID="session-delete-cancel" variant="secondary" label={t('common.cancel')} onPress={() => setConfirmDelete(false)} />
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  note: { borderWidth: 1, borderRadius: Radius.control, padding: Spacing.two, minHeight: 80, fontSize: 16, textAlignVertical: 'top' },
  backdrop: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  dialog: { alignSelf: 'stretch', maxWidth: 420, borderRadius: Radius.card, padding: Spacing.four, gap: Spacing.three },
});
