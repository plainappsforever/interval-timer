// Timers (home, SPEC §7 screen 1, U1/U6, A5/A8): a big Start on the last-used timer (two taps from cold start), the
// saved timers and the templates, + New, Import, search above 10 timers, long-press for edit/duplicate/share/delete
// (with undo). On focus it checks the recovery record (A8): a run that was cut off is offered as "Resume at m:ss";
// one that ended while the app was away is saved to history and shown on the Done screen.
import { Link, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { BackHandler, Platform, Pressable, SectionList, StyleSheet, TextInput, View, type PressableProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PatternRing } from '@/components/pattern-ring';
import { PatternStrip } from '@/components/pattern-strip';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { addSession } from '@/db/sessions';
import { getSetting, setSetting } from '@/db/settings';
import { deleteTimer, duplicateTimer, listTimers } from '@/db/timers';
import type { Db } from '@/db/types';
import { formatDuration, formatElapsedMs } from '@/engine/format';
import type { Timer } from '@/engine/model';
import { evaluateRecovery, parseRecovery, recoveredTimeline, sessionOf, type RecoveryRecord } from '@/engine/recovery';
import { clampName, plannedSeconds } from '@/engine/validation';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { otherActiveRun } from '@/lib/active-run';
import { patternOf, patternSummary, ringArcs } from '@/lib/pattern';
import { endLiveActivities } from '@/lib/live-activity';
import { shareTimer } from '@/lib/share';
import { armStart } from '@/lib/start-intent';

const UNDO_MS = 5000;

/** "8 rounds · 20 s / 10 s" under the poster ring; a timer with several blocks says so instead of the lengths. */
function summaryLine(timer: Timer, t: ReturnType<typeof useT>): string {
  const s = patternSummary(timer);
  const rounds = s.rounds === 1 ? t('home.roundsOne') : t('home.rounds', { n: s.rounds });
  if (s.blocks > 1) return `${t('home.blocks', { n: s.blocks })} · ${rounds}`;
  const len = (n: number) => (n < 60 ? `${n} s` : formatDuration(n));
  return `${rounds} · ${s.lengths.map(len).join(' / ')}`;
}

/** Outline pill (D24 sheet: "New timer" and "Import" under the poster); forwards its props so `Link asChild` works. */
function OutlinePill({ label, style: _ignored, ...rest }: PressableProps & { label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={[styles.pill, { borderColor: theme.tintText }]}>
      <ThemedText style={[styles.pillLabel, { color: theme.tintText }]}>{label}</ThemedText>
    </Pressable>
  );
}

/** Saves a recovered run that is over (or that the user ends) as a history row and clears the record. */
async function settleRecovery(db: Db, record: RecoveryRecord, elapsedMs: number, completed: boolean): Promise<number> {
  const row = sessionOf(
    record.def,
    {
      pauses: record.pauses,
      skipped: record.skipped,
      addedMs: record.addedMs,
      timeline: recoveredTimeline(record),
    },
    elapsedMs,
    completed,
    record.startedAtWall,
    Date.now(),
    true
  );
  let id: number;
  try {
    id = await addSession(db, { ...row, timerId: record.timerId });
  } catch {
    id = await addSession(db, { ...row, timerId: null });
  }
  await setSetting(db, 'recovery', null);
  return id;
}

let recoveryCheck: Promise<unknown> | null = null;

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const language = useLanguage();
  const [timers, setTimers] = useState<Timer[]>([]);
  const [query, setQuery] = useState('');
  // A9: typing stays responsive; the 500-row filter renders with the deferred value
  const deferredQuery = useDeferredValue(query);
  const [offer, setOffer] = useState<RecoveryRecord | null>(null);
  /** Wall clock of the last offer refresh (render stays pure). */
  const [nowWall, setNowWall] = useState(0);
  const [actionsFor, setActionsFor] = useState<Timer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Timer | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** A9 (dev builds): when the last load or search started, logged once the list has drawn (REVIEW N4). */
  const a9Mark = useRef<{ kind: 'load' | 'search'; t0: number; queryMs: number } | null>(null);
  const reload = useCallback(async () => {
    const t0 = performance.now();
    const list = await listTimers(db);
    if (__DEV__) a9Mark.current = { kind: 'load', t0, queryMs: performance.now() - t0 };
    setTimers(list);
  }, [db]);
  useEffect(() => {
    const mark = a9Mark.current;
    if (!__DEV__ || !mark) return;
    a9Mark.current = null;
    requestAnimationFrame(() => {
      const ms = Math.round(performance.now() - mark.t0);
      if (mark.kind === 'load') console.log(`[A9] list load timers=${timers.length} query=${Math.round(mark.queryMs)}ms drawn=${ms}ms`);
      else console.log(`[A9] search "${deferredQuery}" timers=${timers.length} drawn=${ms}ms`);
    });
  }, [timers, deferredQuery]);
  const onSearch = (text: string) => {
    if (__DEV__) a9Mark.current = { kind: 'search', t0: performance.now(), queryMs: 0 };
    setQuery(text);
  };

  const checkRecovery = useCallback(async () => {
    if (recoveryCheck) return;
    const work = (async () => {
      const record = parseRecovery(await getSetting(db, 'recovery'));
      if (!record) {
        setOffer(null);
        return;
      }
      const outcome = evaluateRecovery(record, Date.now());
      if (outcome.status === 'discard') {
        await setSetting(db, 'recovery', null);
        setOffer(null);
      } else if (outcome.status === 'finished') {
        setOffer(null);
        const id = await settleRecovery(db, record, outcome.elapsedMs, outcome.completed);
        router.push({ pathname: '/done/[id]', params: { id: String(id) } });
      } else {
        setNowWall(Date.now());
        setOffer(record);
      }
    })();
    recoveryCheck = work;
    try {
      await work;
    } finally {
      recoveryCheck = null;
    }
  }, [db, router]);

  useFocusEffect(
    useCallback(() => {
      reload();
      checkRecovery();
      // a Live Activity left by a workout that was killed (D40); nothing runs while Home is in front
      if (!otherActiveRun()) endLiveActivities().catch(() => {});
    }, [reload, checkRecovery])
  );

  // the offer's "Resume at m:ss" moves on while a running record waits
  useEffect(() => {
    if (!offer || offer.status !== 'running') return;
    const h = setInterval(() => setNowWall(Date.now()), 1000);
    return () => clearInterval(h);
  }, [offer]);

  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    },
    []
  );

  const offerOutcome = offer ? evaluateRecovery(offer, nowWall) : null;
  const offerTime = offerOutcome && offerOutcome.status !== 'discard' ? formatElapsedMs(offerOutcome.elapsedMs) : '';

  function resume() {
    if (!offer) return;
    const timerId = offer.timerId;
    setOffer(null);
    armStart(timerId);
    router.push({
      pathname: '/run/[id]',
      params: { id: String(timerId), recover: '1' },
    });
  }

  async function endRecovered() {
    if (!offer || !offerOutcome || offerOutcome.status === 'discard') return;
    const record = offer;
    setOffer(null);
    const completed = offerOutcome.status === 'finished' && offerOutcome.completed;
    await settleRecovery(db, record, offerOutcome.elapsedMs, completed);
  }

  function start(timer: Timer) {
    armStart(timer.id);
    router.push({ pathname: '/run/[id]', params: { id: String(timer.id) } });
  }

  // The long-press sheet is an in-screen overlay (D39.5 / review F6): Android Back closes it, as the Modal's did.
  useEffect(() => {
    if (!actionsFor) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActionsFor(null);
      return true;
    });
    return () => sub.remove();
  }, [actionsFor]);

  /** The sheet's actions, also offered on the row itself to screen readers (accessibilityActions). */
  function rowAction(timer: Timer, action: string) {
    if (action === 'duplicate') duplicate(timer);
    else if (action === 'share') share(timer);
    else if (action === 'delete') scheduleDelete(timer);
  }

  async function duplicate(timer: Timer) {
    setActionsFor(null);
    await duplicateTimer(db, timer.id, clampName(t('home.copyName', { name: timer.name })));
    reload();
  }

  async function share(timer: Timer) {
    setActionsFor(null);
    await shareTimer(timer).catch(() => {});
  }

  function scheduleDelete(timer: Timer) {
    setActionsFor(null);
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    // a previous pending delete is carried out now
    if (pendingDelete) deleteTimer(db, pendingDelete.id).catch(() => {});
    setPendingDelete(timer);
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      deleteTimer(db, timer.id)
        .catch(() => {})
        .finally(() => {
          setPendingDelete(null);
          reload();
        });
    }, UNDO_MS);
  }

  function undoDelete() {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    deleteTimerRef.current = null;
    setPendingDelete(null);
  }

  const visible = timers.filter((x) => x.id !== pendingDelete?.id);
  const q = deferredQuery.trim().toLocaleLowerCase();
  const filtered = q ? visible.filter((x) => x.name.toLocaleLowerCase().includes(q)) : visible;
  const mine = filtered.filter((x) => x.kind === 'custom');
  const templates = filtered.filter((x) => x.kind === 'template');
  const sections = [
    ...(mine.length ? [{ key: 'mine', title: t('home.mine'), data: mine }] : []),
    ...(templates.length ? [{ key: 'templates', title: t('home.templates'), data: templates }] : []),
  ];
  const last = [...visible].filter((x) => x.lastUsedAt !== null).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0] ?? visible[0] ?? null;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('home.title'),
          headerTitleAlign: 'center',
          headerLeft: () => (
            <Link href="/history" asChild>
              <Pressable testID="open-history" accessibilityLabel={t('history.title')} hitSlop={8} style={styles.headerLink}>
                {Platform.OS === 'ios' ? <SymbolView name="clock.arrow.circlepath" size={17} tintColor={theme.tintText} /> : null}
                <ThemedText themeColor="tintText">{t('history.title')}</ThemedText>
              </Pressable>
            </Link>
          ),
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable testID="open-settings" accessibilityLabel={t('settings.title')} hitSlop={8} style={styles.headerLink}>
                {Platform.OS === 'ios' ? (
                  <SymbolView name="gearshape" size={20} tintColor={theme.tintText} />
                ) : (
                  <ThemedText themeColor="tintText">{t('settings.title')}</ThemedText>
                )}
              </Pressable>
            </Link>
          ),
        }}
      />
      <SectionList
        testID="home-screen"
        // TalkBack: the list is hidden while the action sheet is open (iOS: the sheet's accessibilityViewIsModal)
        importantForAccessibility={actionsFor ? 'no-hide-descendants' : 'auto'}
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        sections={sections}
        stickySectionHeadersEnabled={false}
        keyExtractor={(item) => String(item.id)}
        // A9 (500+ timers): draw what is on screen plus two screens around it, not the default 21 screens
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        ListHeaderComponent={
          <View style={styles.header}>
            {offer && offerOutcome?.status === 'resume' ? (
              <Card testID="recovery-offer" style={[styles.offer, { borderColor: theme.tint }]}>
                <ThemedText testID="recovery-text" type="smallBold">
                  {t('recovery.offer', {
                    name: offer.timerName,
                    time: offerTime,
                  })}
                </ThemedText>
                <Button testID="recovery-resume" label={t('recovery.resume', { time: offerTime })} onPress={resume} />
                <Button testID="recovery-end" variant="secondary" label={t('recovery.end')} onPress={endRecovered} />
              </Card>
            ) : null}
            {last ? (
              <Pressable
                testID="poster"
                accessibilityRole="button"
                // "Edit, <name>", not "<name>, ...": the Maestro flows address the list rows by that pattern (home-actions, editor)
                accessibilityLabel={`${t('home.edit')}, ${last.name}`}
                accessibilityHint={summaryLine(last, t)}
                onPress={() => router.push({ pathname: '/timer/[id]', params: { id: String(last.id) } })}
                style={styles.poster}>
                <ThemedText style={styles.posterName} numberOfLines={1}>
                  {last.name}
                </ThemedText>
                <PatternRing arcs={ringArcs(last)}>
                  <ThemedText numeric style={styles.posterTotal} numberOfLines={1} adjustsFontSizeToFit>
                    {formatDuration(plannedSeconds(last))}
                  </ThemedText>
                  <ThemedText numeric style={styles.posterSummary} numberOfLines={2} adjustsFontSizeToFit themeColor="textSecondary">
                    {summaryLine(last, t)}
                  </ThemedText>
                </PatternRing>
              </Pressable>
            ) : (
              <View testID="home-empty" style={styles.poster}>
                <PatternRing arcs={[]} />
                <ThemedText themeColor="textSecondary" style={styles.emptyPoster}>
                  {t('home.empty')}
                </ThemedText>
              </View>
            )}
            <View style={styles.rowButtons}>
              <OutlinePill testID="new-timer" label={t('home.new')} onPress={() => router.push('/timer/new')} />
              <OutlinePill testID="open-import" label={t('home.import')} onPress={() => router.push('/import')} />
            </View>
            {timers.length > 0 ? (
              <TextInput
                testID="home-search"
                accessibilityLabel={t('home.search')}
                maxFontSizeMultiplier={1.3}
                placeholder={t('home.search')}
                placeholderTextColor={theme.textSecondary}
                value={query}
                onChangeText={onSearch}
                autoCorrect={false}
                style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, fontFamily: BrandFonts.body }]}
              />
            ) : null}
            {visible.length > 0 && !q && mine.length === 0 ? (
              <ThemedText testID="mine-empty" themeColor="textSecondary" type="small" style={styles.mineEmpty}>
                {t('home.empty')}
              </ThemedText>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <ThemedText testID={`section-${section.key}`} type="smallBold" themeColor="textSecondary" style={styles.sectionHeader}>
            {section.title}
          </ThemedText>
        )}
        ListEmptyComponent={
          q ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {t('home.noMatch')}
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => {
          const subtitle = item.lastUsedAt
            ? `${formatDuration(plannedSeconds(item))} · ${t('home.lastUsed', { date: new Date(item.lastUsedAt).toLocaleDateString(language) })}`
            : formatDuration(plannedSeconds(item));
          return (
            <Card style={styles.row}>
              <View style={styles.rowTop}>
                <Pressable
                  testID={`timer-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${subtitle}`}
                  accessibilityHint={t('home.edit')}
                  // Screen readers reach Duplicate / Share / Delete from the row too (actions rotor / TalkBack menu).
                  accessibilityActions={[
                    { name: 'duplicate', label: t('home.duplicate') },
                    { name: 'share', label: t('home.share') },
                    { name: 'delete', label: t('common.delete') },
                  ]}
                  onAccessibilityAction={(e) => rowAction(item, e.nativeEvent.actionName)}
                  onPress={() =>
                    router.push({
                      pathname: '/timer/[id]',
                      params: { id: String(item.id) },
                    })
                  }
                  onLongPress={() => setActionsFor(item)}
                  style={styles.rowMain}>
                  <ThemedText style={styles.tileName} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  <ThemedText numeric type="small" themeColor="textSecondary" style={styles.tileSub}>
                    {subtitle}
                  </ThemedText>
                </Pressable>
                <Pressable
                  testID={`start-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.startNamed', { name: item.name })}
                  hitSlop={8}
                  onPress={() => start(item)}
                  style={[styles.play, { backgroundColor: theme.tint }]}>
                  <ThemedText style={{ color: theme.onTint, fontWeight: '800' }}>{t('home.start')}</ThemedText>
                </Pressable>
              </View>
              <PatternStrip pieces={patternOf(item)} />
            </Card>
          );
        }}
      />
      {last && !offer ? (
        <View style={[styles.bar, { backgroundColor: theme.background, borderTopColor: theme.border, paddingBottom: Spacing.two + insets.bottom }]}>
          <Pressable
            testID="start-last"
            accessibilityRole="button"
            accessibilityLabel={t('home.startNamed', { name: last.name })}
            onPress={() => start(last)}
            style={({ pressed }) => [styles.barButton, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
            <ThemedText style={[styles.barLabel, { color: theme.onTint }]} numberOfLines={1}>
              {t('home.startNamed', { name: last.name })}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      {pendingDelete ? (
        <View testID="undo-bar" style={[styles.undoBar, { backgroundColor: theme.text, bottom: BAR_HEIGHT + insets.bottom + Spacing.three }]}>
          <ThemedText style={{ color: theme.background, flex: 1 }}>{t('home.deleted', { name: pendingDelete.name })}</ThemedText>
          <Pressable testID="undo-delete" accessibilityRole="button" onPress={undoDelete} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              {t('home.undo')}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      {/* An in-screen overlay, not a RN Modal (D39.5, review F6): a Modal shown a second time on iOS was missing from the
          accessibility tree (P6 run-controls flow). Same pattern as the running screen's End dialog. */}
      {actionsFor ? (
        <View testID="timer-actions-overlay" style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: theme.scrim }]} accessibilityViewIsModal>
          <Pressable
            testID="action-backdrop"
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => setActionsFor(null)}
          />
          <View testID="timer-actions" style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: Spacing.four + insets.bottom }]}>
            <ThemedText type="smallBold" accessibilityRole="header">
              {actionsFor.name}
            </ThemedText>
            <Button
              testID="action-edit"
              variant="secondary"
              label={t('home.edit')}
              accessibilityLabel={`${t('home.edit')}, ${actionsFor.name}`}
              onPress={() => {
                const x = actionsFor;
                setActionsFor(null);
                router.push({
                  pathname: '/timer/[id]',
                  params: { id: String(x.id) },
                });
              }}
            />
            <Button
              testID="action-duplicate"
              variant="secondary"
              label={t('home.duplicate')}
              accessibilityLabel={`${t('home.duplicate')}, ${actionsFor.name}`}
              onPress={() => duplicate(actionsFor)}
            />
            <Button
              testID="action-share"
              variant="secondary"
              label={t('home.share')}
              accessibilityLabel={`${t('home.share')}, ${actionsFor.name}`}
              onPress={() => share(actionsFor)}
            />
            <Button
              testID="action-delete"
              variant="secondary"
              label={t('common.delete')}
              accessibilityLabel={`${t('common.delete')}, ${actionsFor.name}`}
              onPress={() => scheduleDelete(actionsFor)}
            />
            <Button testID="action-cancel" label={t('common.cancel')} onPress={() => setActionsFor(null)} />
          </View>
        </View>
      ) : null}
    </>
  );
}

const BAR_HEIGHT = 56 + Spacing.two * 2;

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  header: { gap: Spacing.three, marginBottom: Spacing.two },
  headerLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  offer: {
    borderWidth: 2,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  poster: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  posterName: { fontSize: 28, lineHeight: 34, fontWeight: '900', textAlign: 'center' },
  // R2a: the numerals sit inside a 240 pt ring (inner width 188 pt); 64 pt black "04:10" measured about 220 pt and hit the bars.
  posterTotal: { fontSize: 48, lineHeight: 54, fontWeight: '900', maxWidth: 150, textAlign: 'center' },
  posterSummary: { fontSize: 13, lineHeight: 17, fontWeight: '600', textAlign: 'center', maxWidth: 150 },
  emptyPoster: { textAlign: 'center', fontSize: 15, lineHeight: 21, paddingHorizontal: Spacing.three },
  mineEmpty: { textAlign: 'center' },
  rowButtons: { flexDirection: 'row', gap: Spacing.two },
  pill: { flex: 1, minHeight: 48, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  pillLabel: { fontSize: 16, fontWeight: '800' },
  search: {
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 44,
  },
  sectionHeader: { marginTop: Spacing.two, marginBottom: Spacing.one },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  row: { marginBottom: Spacing.two, overflow: 'hidden' },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, padding: Spacing.three, gap: Spacing.one },
  tileName: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  tileSub: { fontSize: 13, lineHeight: 18 },
  play: {
    marginRight: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  // In the column below the list (not laid over it), so the first screen never hides a heading behind the bar.
  bar: {
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barButton: { height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  barLabel: { fontSize: 19, lineHeight: 24, fontWeight: '800' },
  undoBar: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    borderRadius: Radius.control,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: Spacing.four,
    gap: Spacing.two,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
  },
});
