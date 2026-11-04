// Timer editor (SPEC §7 screen 2, flows U2/U3, A15). `id` = a timer id or "new". Names are clamped to 40 code points
// while typing (D31, never TextInput maxLength) and trimmed on save (REVIEW S7); limits are checked with the engine's
// validateTimer and shown inline; the total is plannedSeconds (equal to buildTimeline().totalMs, editor-ops.test).
// Reorder is by Move up / Move down buttons (L11 row: no drag in v1).
import * as Speech from 'expo-speech';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { readSettings } from '@/db/settings';
import { createTimer, getTimer, updateTimer } from '@/db/timers';
import { formatDuration } from '@/engine/format';
import { block as makeBlock, type BlockDef, type CueMode, type IntervalDef, type IntervalType, type TimerDef } from '@/engine/model';
import { COLOR_NAMES, COLORS, colorOf, textOn } from '@/engine/palette';
import { clampName, LIMITS, plannedSeconds, validateTimer, type ValidationIssue } from '@/engine/validation';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { parseDurationInput } from '@/lib/duration-input';
import { cleanForSave, cycle, duplicateAt, hasOpenInterval, move, newTimerDef, nextInterval, removeAt, setAt } from '@/lib/editor-ops';
import { armStart } from '@/lib/start-intent';
import { VOICE_LOCALE } from '@/lib/voice';

const TYPES: readonly IntervalType[] = ['work', 'rest', 'prep', 'cooldown', 'open'];
const MODES: readonly CueMode[] = ['both', 'voice', 'beep', 'none'];
const INTERVAL_COLORS: readonly string[] = ['', ...COLOR_NAMES.map((n) => COLORS[n])];

export default function TimerEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const [def, setDef] = useState<TimerDef | null>(null);
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [halfwayDefault, setHalfwayDefault] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const settings = await readSettings(db);
      if (!active) return;
      setHalfwayDefault(settings.halfwayDefault);
      setVoiceId(settings.voiceId);
      if (isNew) {
        setDef(newTimerDef(t('editor.defaultName'), { work: t('interval.work'), rest: t('interval.rest') }, settings.halfwayDefault));
        return;
      }
      const timer = await getTimer(db, Number(id));
      if (!active) return;
      if (!timer) setMissing(true);
      else
        setDef({
          name: timer.name,
          color: timer.color,
          notes: timer.notes,
          blocks: timer.blocks,
          prefs: timer.prefs,
        });
    })();
    return () => {
      active = false;
    };
    // the translator only seeds a new timer's names once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, id, isNew]);

  const issues = useMemo(() => (def ? validateTimer(def) : []), [def]);
  const issueAt = (path: string) => issues.find((i) => i.path === path);
  const message = (i: ValidationIssue | undefined) => (i ? t(i.key, i.params) : null);

  if (missing) {
    return (
      <View testID="editor-screen" style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText>{t('run.notFound')}</ThemedText>
      </View>
    );
  }
  if (!def) return <View testID="editor-loading" style={{ flex: 1, backgroundColor: theme.background }} />;

  const update = (fn: (d: TimerDef) => TimerDef) => setDef((d) => (d ? fn(d) : d));
  const setBlock = (b: number, fn: (x: BlockDef) => BlockDef) => update((d) => ({ ...d, blocks: setAt(d.blocks, b, fn(d.blocks[b])) }));
  const setIv = (b: number, i: number, fn: (x: IntervalDef) => IntervalDef) =>
    setBlock(b, (x) => ({
      ...x,
      intervals: setAt(x.intervals, i, fn(x.intervals[i])),
    }));
  const toggleExpanded = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  async function save(): Promise<number | null> {
    if (!def) return null;
    setTried(true);
    const clean = cleanForSave(def);
    if (validateTimer(clean).length > 0) return null;
    setBusy(true);
    try {
      if (isNew) return await createTimer(db, clean);
      await updateTimer(db, Number(id), clean);
      return Number(id);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    const saved = await save();
    if (saved !== null) router.back();
  }

  async function onStart() {
    const saved = await save();
    if (saved === null) return;
    armStart(saved);
    router.replace({ pathname: '/run/[id]', params: { id: String(saved) } });
  }

  function previewVoice() {
    const first = def?.blocks[0]?.intervals[0];
    const text = [t('cue.getReady'), first?.name, t('cue.number.3'), t('cue.number.2'), t('cue.number.1')].filter(Boolean).join('. ');
    Speech.stop();
    Speech.speak(text, {
      language: VOICE_LOCALE[language],
      ...(voiceId ? { voice: voiceId } : {}),
    });
  }

  const totalS = plannedSeconds(def);
  const open = hasOpenInterval(def);
  const totalText = open ? t('editor.totalOpen', { time: formatDuration(totalS) }) : t('editor.total', { time: formatDuration(totalS) });
  const totalIssue = issueAt('total');
  const onOff = (v: boolean) => (v ? t('editor.on') : t('editor.off'));

  return (
    <>
      <Stack.Screen options={{ title: isNew ? t('editor.new') : t('editor.title') }} />
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <ScrollView testID="editor-screen" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            {t('editor.name')}
          </ThemedText>
          <TextInput
            testID="editor-name"
            accessibilityLabel={t('editor.name')}
            value={def.name}
            onChangeText={(text) => update((d) => ({ ...d, name: clampName(text) }))}
            style={[
              styles.input,
              styles.nameInput,
              {
                color: theme.text,
                borderColor: tried && issueAt('name') ? theme.danger : theme.backgroundSelected,
              },
            ]}
          />
          {tried && issueAt('name') ? <IssueText text={message(issueAt('name'))} /> : null}

          <ThemedText type="small" themeColor="textSecondary">
            {t('editor.color')}
          </ThemedText>
          <View style={styles.swatches}>
            {COLOR_NAMES.map((n) => {
              const selected = def.color === COLORS[n];
              return (
                <Pressable
                  key={n}
                  testID={`editor-color-${n}`}
                  accessibilityRole="button"
                  accessibilityLabel={n}
                  accessibilityState={{ selected }}
                  onPress={() => update((d) => ({ ...d, color: selected ? '' : COLORS[n] }))}
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: COLORS[n],
                      borderColor: selected ? theme.text : 'transparent',
                    },
                  ]}
                />
              );
            })}
          </View>

          {open && Platform.OS === 'ios' ? (
            <ThemedText testID="editor-open-note" type="small" themeColor="textSecondary">
              {t('editor.openNoteIos')}
            </ThemedText>
          ) : null}

          {def.blocks.map((b, bi) => (
            <View key={bi} testID={`block-${bi}`} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{t('editor.block', { n: bi + 1 })}</ThemedText>
              <TextInput
                testID={`block-${bi}-name`}
                accessibilityLabel={t('editor.blockName')}
                placeholder={t('editor.blockName')}
                placeholderTextColor={theme.textSecondary}
                value={b.name}
                onChangeText={(text) => setBlock(bi, (x) => ({ ...x, name: clampName(text) }))}
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              {b.intervals.map((iv, ii) => {
                const key = `${bi}-${ii}`;
                const base = `iv-${key}`;
                const isOpen = expanded.has(key);
                const swatch = colorOf(iv.color, iv.type);
                const nameIssue = tried ? issueAt(`blocks[${bi}].intervals[${ii}].name`) : undefined;
                const secIssue = issueAt(`blocks[${bi}].intervals[${ii}].seconds`);
                return (
                  <View
                    key={ii}
                    testID={base}
                    style={[
                      styles.interval,
                      {
                        borderLeftColor: swatch,
                        backgroundColor: theme.background,
                      },
                    ]}>
                    <View style={styles.rowTight}>
                      <TextInput
                        testID={`${base}-name`}
                        accessibilityLabel={t('editor.intervalName')}
                        placeholder={t('editor.intervalName')}
                        placeholderTextColor={theme.textSecondary}
                        value={iv.name}
                        onChangeText={(text) =>
                          setIv(bi, ii, (x) => ({
                            ...x,
                            name: clampName(text),
                          }))
                        }
                        style={[
                          styles.input,
                          styles.flex,
                          {
                            color: theme.text,
                            borderColor: nameIssue ? theme.danger : theme.backgroundSelected,
                          },
                        ]}
                      />
                      <Chip
                        testID={`${base}-type`}
                        label={t(`type.${iv.type}`)}
                        onPress={() =>
                          setIv(bi, ii, (x) => ({
                            ...x,
                            type: cycle(TYPES, x.type),
                          }))
                        }
                      />
                    </View>
                    {nameIssue ? <IssueText text={message(nameIssue)} /> : null}
                    <Stepper
                      testID={`${base}-len`}
                      label={t('editor.length')}
                      value={iv.seconds}
                      min={LIMITS.secondsMin}
                      max={LIMITS.secondsMax}
                      step={5}
                      format={formatDuration}
                      parse={parseDurationInput}
                      invalid={!!secIssue}
                      onChange={(n) => setIv(bi, ii, (x) => ({ ...x, seconds: n }))}
                    />
                    <Pressable testID={`${base}-more`} accessibilityRole="button" onPress={() => toggleExpanded(key)} hitSlop={6}>
                      <ThemedText type="small" themeColor="tint">
                        {isOpen ? t('editor.less') : t('editor.more')}
                      </ThemedText>
                    </Pressable>
                    {isOpen ? (
                      <View style={styles.more}>
                        <View style={styles.rowTight}>
                          <ThemedText type="small" style={styles.flex}>
                            {t('editor.color')}
                          </ThemedText>
                          <Pressable
                            testID={`${base}-color`}
                            accessibilityRole="button"
                            accessibilityLabel={iv.color ? iv.color : t('editor.colorDefault')}
                            onPress={() =>
                              setIv(bi, ii, (x) => ({
                                ...x,
                                color: cycle(INTERVAL_COLORS, x.color),
                              }))
                            }
                            style={[styles.colorBtn, { backgroundColor: swatch }]}>
                            <ThemedText type="small" style={{ color: textOn(swatch) }}>
                              {iv.color ? ' ' : t('editor.colorDefault')}
                            </ThemedText>
                          </Pressable>
                        </View>
                        <View style={styles.rowTight}>
                          <ThemedText type="small" style={styles.flex}>
                            {t('editor.cueStart')}
                          </ThemedText>
                          <Chip
                            testID={`${base}-cue`}
                            label={t(`cueMode.${iv.cueStart}`)}
                            onPress={() =>
                              setIv(bi, ii, (x) => ({
                                ...x,
                                cueStart: cycle(MODES, x.cueStart),
                              }))
                            }
                          />
                        </View>
                        <ToggleRow
                          testID={`${base}-halfway`}
                          label={t('editor.halfway')}
                          value={iv.halfwayCue}
                          onChange={(v) => setIv(bi, ii, (x) => ({ ...x, halfwayCue: v }))}
                        />
                        <ToggleRow
                          testID={`${base}-countdown`}
                          label={t('editor.countdown')}
                          value={iv.countdownCue}
                          onChange={(v) => setIv(bi, ii, (x) => ({ ...x, countdownCue: v }))}
                        />
                        {iv.type === 'open' ? (
                          <Stepper
                            testID={`${base}-tick`}
                            label={t('editor.openTick')}
                            value={iv.openTickS}
                            min={0}
                            max={LIMITS.openTickMax}
                            step={5}
                            parse={parseDurationInput}
                            onChange={(n) => setIv(bi, ii, (x) => ({ ...x, openTickS: n }))}
                          />
                        ) : null}
                        <View style={styles.actions}>
                          <Chip
                            testID={`${base}-dup`}
                            label={t('editor.duplicate')}
                            disabled={b.intervals.length >= LIMITS.intervalsPerBlockMax}
                            onPress={() =>
                              setBlock(bi, (x) => ({
                                ...x,
                                intervals: duplicateAt(x.intervals, ii),
                              }))
                            }
                          />
                          <Chip
                            testID={`${base}-up`}
                            label={t('editor.moveUp')}
                            disabled={ii === 0}
                            onPress={() =>
                              setBlock(bi, (x) => ({
                                ...x,
                                intervals: move(x.intervals, ii, -1),
                              }))
                            }
                          />
                          <Chip
                            testID={`${base}-down`}
                            label={t('editor.moveDown')}
                            disabled={ii === b.intervals.length - 1}
                            onPress={() =>
                              setBlock(bi, (x) => ({
                                ...x,
                                intervals: move(x.intervals, ii, 1),
                              }))
                            }
                          />
                          <Chip
                            testID={`${base}-remove`}
                            label={t('editor.remove')}
                            danger
                            onPress={() =>
                              setBlock(bi, (x) => ({
                                ...x,
                                intervals: removeAt(x.intervals, ii),
                              }))
                            }
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {issueAt(`blocks[${bi}].intervals`) ? <IssueText text={message(issueAt(`blocks[${bi}].intervals`))} /> : null}
              <Chip
                testID={`block-${bi}-add`}
                label={t('editor.addInterval')}
                disabled={b.intervals.length >= LIMITS.intervalsPerBlockMax}
                onPress={() =>
                  setBlock(bi, (x) => ({
                    ...x,
                    intervals: [...x.intervals, nextInterval(x, { work: t('interval.work'), rest: t('interval.rest') }, halfwayDefault)],
                  }))
                }
              />
              <Stepper
                testID={`block-${bi}-rounds`}
                label={t('editor.rounds')}
                value={b.rounds}
                min={LIMITS.roundsMin}
                max={LIMITS.roundsMax}
                step={1}
                onChange={(n) => setBlock(bi, (x) => ({ ...x, rounds: n }))}
              />
              {b.rounds > 1 ? (
                <Stepper
                  testID={`block-${bi}-rest`}
                  label={t('editor.restBetweenRounds')}
                  value={b.restBetweenRoundsS}
                  min={0}
                  max={LIMITS.restBetweenRoundsMax}
                  step={5}
                  format={formatDuration}
                  parse={parseDurationInput}
                  onChange={(n) => setBlock(bi, (x) => ({ ...x, restBetweenRoundsS: n }))}
                />
              ) : null}
              <View style={styles.actions}>
                <Chip
                  testID={`block-${bi}-dup`}
                  label={t('editor.duplicate')}
                  disabled={def.blocks.length >= LIMITS.blocksMax}
                  onPress={() => update((d) => ({ ...d, blocks: duplicateAt(d.blocks, bi) }))}
                />
                <Chip
                  testID={`block-${bi}-up`}
                  label={t('editor.moveUp')}
                  disabled={bi === 0}
                  onPress={() => update((d) => ({ ...d, blocks: move(d.blocks, bi, -1) }))}
                />
                <Chip
                  testID={`block-${bi}-down`}
                  label={t('editor.moveDown')}
                  disabled={bi === def.blocks.length - 1}
                  onPress={() => update((d) => ({ ...d, blocks: move(d.blocks, bi, 1) }))}
                />
                <Chip
                  testID={`block-${bi}-remove`}
                  label={t('editor.remove')}
                  danger
                  disabled={def.blocks.length <= 1}
                  onPress={() => update((d) => ({ ...d, blocks: removeAt(d.blocks, bi) }))}
                />
              </View>
            </View>
          ))}
          <Button
            testID="editor-add-block"
            variant="secondary"
            label={t('editor.addBlock')}
            disabled={def.blocks.length >= LIMITS.blocksMax}
            onPress={() =>
              update((d) => ({
                ...d,
                blocks: [...d.blocks, makeBlock([nextInterval(makeBlock([]), { work: t('interval.work'), rest: t('interval.rest') }, halfwayDefault)])],
              }))
            }
          />

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{t('editor.options')}</ThemedText>
            <Stepper
              testID="prefs-prep"
              label={t('editor.prep')}
              value={def.prefs.prepSeconds}
              min={0}
              max={LIMITS.prepMax}
              step={5}
              format={formatDuration}
              onChange={(n) => update((d) => ({ ...d, prefs: { ...d.prefs, prepSeconds: n } }))}
            />
            <Stepper
              testID="prefs-repeat"
              label={t('editor.repeat')}
              value={def.prefs.repeatWhole}
              min={LIMITS.repeatMin}
              max={LIMITS.repeatMax}
              step={1}
              format={(n) => `× ${n}`}
              onChange={(n) => update((d) => ({ ...d, prefs: { ...d.prefs, repeatWhole: n } }))}
            />
            <View style={styles.rowTight}>
              <ThemedText type="small" style={styles.flex}>
                {t('editor.endCue')}
              </ThemedText>
              <Chip
                testID="prefs-endcue"
                label={t(`cueMode.${def.prefs.endCue}`)}
                onPress={() =>
                  update((d) => ({
                    ...d,
                    prefs: { ...d.prefs, endCue: cycle(MODES, d.prefs.endCue) },
                  }))
                }
              />
            </View>
            <ToggleRow
              testID="prefs-vibrate"
              label={`${t('editor.vibrate')}: ${onOff(def.prefs.vibrate)}`}
              value={def.prefs.vibrate}
              onChange={(v) => update((d) => ({ ...d, prefs: { ...d.prefs, vibrate: v } }))}
            />
          </View>
          <Button testID="editor-preview-voice" variant="secondary" label={t('editor.previewVoice')} onPress={previewVoice} />
        </ScrollView>
        <View
          style={[
            styles.bar,
            {
              paddingBottom: Math.max(insets.bottom, Spacing.two),
              backgroundColor: theme.background,
              borderTopColor: theme.backgroundSelected,
            },
          ]}>
          {/* the live total stays in view while the blocks scroll (A15) */}
          <ThemedText testID="editor-total" type="smallBold">
            {totalText}
          </ThemedText>
          {totalIssue ? <IssueText text={message(totalIssue)} /> : null}
          {tried && issues.length > 0 ? (
            <ThemedText testID="editor-issues" type="small" style={{ color: theme.danger }}>
              {`${t('editor.fix')} ${message(issues[0])}`}
            </ThemedText>
          ) : null}
          <View style={styles.rowTight}>
            <Button testID="editor-save" variant="secondary" label={t('editor.save')} disabled={busy} onPress={onSave} style={styles.flex} />
            <Button testID="editor-start" label={t('editor.start')} disabled={busy} onPress={onStart} style={styles.flex} />
          </View>
        </View>
      </View>
    </>
  );
}

function IssueText({ text }: { text: string | null }) {
  const theme = useTheme();
  if (!text) return null;
  return (
    <ThemedText type="small" style={{ color: theme.danger }}>
      {text}
    </ThemedText>
  );
}

function Chip({ testID, label, onPress, disabled, danger }: { testID: string; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.backgroundSelected,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
      ]}>
      <ThemedText type="small" style={danger ? { color: theme.danger } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ToggleRow({ testID, label, value, onChange }: { testID: string; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.rowTight}>
      <ThemedText type="small" style={styles.flex}>
        {label}
      </ThemedText>
      <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    fontSize: 16,
  },
  nameInput: { fontSize: 18, fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  interval: {
    borderLeftWidth: 6,
    borderRadius: 8,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  rowTight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  more: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 16,
  },
  colorBtn: {
    minWidth: 96,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
