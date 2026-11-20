// History (SPEC §7 screen 5, A10, D34): totals (today, this week, this month, all), streak, most used timers, recent
// weeks/months under the engine's bucket keys, then every session by day (planned vs actual, ended early, skipped).
// Tap a session for its details (note, delete); CSV export through the share sheet (A11).
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { PatternRing } from '@/components/pattern-ring';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { listSessions, type Session } from '@/db/sessions';
import { toCsv } from '@/engine/csv';
import { formatDuration } from '@/engine/format';
import { summary, type Totals } from '@/engine/stats';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { shareCsv } from '@/lib/files';
import { daySections, recentBuckets } from '@/lib/history-view';

type Unit = 'week' | 'month';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [nowWall, setNowWall] = useState(0);
  const [unit, setUnit] = useState<Unit>('week');

  useFocusEffect(
    useCallback(() => {
      listSessions(db).then((list) => {
        setNowWall(Date.now());
        setSessions(list);
      });
    }, [db])
  );

  const list = sessions ?? [];
  const sum = summary(list, nowWall);
  const sections = daySections(list);
  const recent = recentBuckets(list, unit);
  const totalLine = (x: Totals) => t('history.totalLine', { time: formatDuration(x.actualS), n: x.sessions });

  const header = (
    <View style={styles.header}>
      {list.length > 0 ? (
      <View testID="history-stats" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <Stat testID="stat-today" label={t('history.today')} value={totalLine(sum.today)} />
        <Stat testID="stat-week" label={t('history.thisWeek')} value={totalLine(sum.thisWeek)} />
        <Stat testID="stat-month" label={t('history.thisMonth')} value={totalLine(sum.thisMonth)} />
        <Stat testID="stat-all" label={t('history.all')} value={totalLine(sum.all)} />
        <Stat testID="stat-streak" label={t('history.streak')} value={String(sum.streak)} />
        <Stat testID="stat-longest" label={t('history.longest')} value={String(sum.longestStreak)} />
      </View>
      ) : null}
      {sum.mostUsed.length > 0 ? (
        <View testID="history-most-used" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{t('history.mostUsed')}</ThemedText>
          {sum.mostUsed.slice(0, 3).map((u) => (
            <Stat key={`${u.timerId ?? 'x'}-${u.timerName}`} label={u.timerName} value={t('history.usage', { n: u.sessions, time: formatDuration(u.actualS) })} />
          ))}
        </View>
      ) : null}
      {recent.length > 0 ? (
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.segmented}>
            {(['week', 'month'] as const).map((u) => (
              <Pressable
                key={u}
                testID={`history-unit-${u}`}
                accessibilityRole="button"
                accessibilityState={{ selected: unit === u }}
                onPress={() => setUnit(u)}
                style={[styles.segment, unit === u && { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type={unit === u ? 'smallBold' : 'small'}>{u === 'week' ? t('history.weeks') : t('history.months')}</ThemedText>
              </Pressable>
            ))}
          </View>
          {recent.map((b) => (
            <Stat key={b.key} testID={`bucket-${b.key}`} label={b.key} value={totalLine(b.totals)} />
          ))}
        </View>
      ) : null}
      {list.length > 0 ? (
        <Pressable
          testID="history-export"
          accessibilityRole="button"
          onPress={() => shareCsv(toCsv(list), t('history.export')).catch(() => {})}
          style={[styles.exportButton, { borderColor: theme.tint }]}>
          <ThemedText type="smallBold" themeColor="tintText">
            {t('history.export')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: t('history.title') }} />
      <SectionList
        testID="history-screen"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        sections={sections}
        stickySectionHeadersEnabled={false}
        keyExtractor={(s) => String(s.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={
          sessions ? (
            <View style={styles.emptyBox}>
              <PatternRing arcs={[]} size={180} thickness={20} />
              <ThemedText testID="history-empty" themeColor="textSecondary" style={styles.empty}>
                {t('history.empty')}
              </ThemedText>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <ThemedText testID={`day-${section.key}`} type="smallBold" themeColor="textSecondary" style={styles.dayHeader}>
            {`${new Date(section.startMs).toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatDuration(section.totals.actualS)}`}
          </ThemedText>
        )}
        renderItem={({ item }) => {
          const time = new Date(item.startedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
          const amount = item.plannedS === null ? formatDuration(item.actualS) : t('history.ofPlanned', { actual: formatDuration(item.actualS), planned: formatDuration(item.plannedS) });
          const result = item.completed ? t('done.completed') : t('done.endedEarly');
          const skipped = item.skippedIntervals > 0 ? ` · ${t('history.skipped', { n: item.skippedIntervals })}` : '';
          return (
            <Pressable
              testID={`session-${item.id}`}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/history/[id]', params: { id: String(item.id) } })}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
              <View style={styles.rowTop}>
                <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>
                  {item.timerName}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {time}
                </ThemedText>
              </View>
              <ThemedText testID={`session-${item.id}-line`} type="small" themeColor="textSecondary">
                {`${amount} · ${result}${skipped}`}
              </ThemedText>
            </Pressable>
          );
        }}
      />
    </>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.flex} numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText testID={testID} type="smallBold">
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.three, marginBottom: Spacing.two },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  stat: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  segmented: { flexDirection: 'row', gap: Spacing.one },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.inner },
  exportButton: { borderWidth: 1, borderRadius: Radius.control, alignItems: 'center', paddingVertical: Spacing.two },
  emptyBox: { alignItems: 'center', gap: Spacing.four, marginTop: Spacing.five },
  empty: { textAlign: 'center' },
  dayHeader: { marginTop: Spacing.two, marginBottom: Spacing.one },
  row: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.one, marginBottom: Spacing.two },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
