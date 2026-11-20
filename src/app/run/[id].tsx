// Running screen (SPEC §7 screen 3, U1/U6, A5/A6/A8/A16/A17). The interval colour fills the screen; the remaining time
// is ≥ 96 pt (≥ 120 pt in landscape). All engine access goes through RunSession (apply/view, D33) and every cue through
// the CueDriver (D38). `?recover=1` continues the run in `settings.recovery` (the home screen's Resume offer, A8).
// Voice clips are prepared before Start (D15); a run starts by itself once they are ready (two taps from cold start).
// Review F11 (P9): only when the app's own UI asked for it (src/lib/start-intent.ts); a link asks "Start <name>?" first.
import { runColors } from '@/lib/run-colors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { SymbolView } from 'expo-symbols';

import { DialGlyph, type DialGlyphKind } from '@/components/dial-glyph';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { countdownFontSize } from '@/lib/countdown-size';
import { AppState, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { BrandFonts, Radius, Spacing } from '@/constants/theme';
import { useSQLiteContext } from '@/db/provider';
import { readSettings, setSetting } from '@/db/settings';
import { getTimer, touchTimer } from '@/db/timers';
import { formatDuration, formatElapsedMs, formatRemainingMs } from '@/engine/format';
import { evaluateRecovery, parseRecovery, restoreRunner } from '@/engine/recovery';
import { apply, idle, type RunnerAction, type RunnerState, type RunnerView } from '@/engine/runner';
import { buildTimeline, type Cue } from '@/engine/schedule';
import { statusLineKey } from '@/engine/status-line';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { clearActiveRun, otherActiveRun, setActiveRun } from '@/lib/active-run';
import { createCueDriver, type CueDriver, type CueOutput } from '@/lib/cues';
import { armStart, clearStartIntent, hasStartIntent } from '@/lib/start-intent';
import { cueHaptic } from '@/lib/haptics';
import { liveActivityAvailable, syncLiveActivity } from '@/lib/live-activity';
import { RunSession, type RunMeta } from '@/lib/run-session';
import { TimingLog } from '@/lib/timing-log';
import { prepareVoiceClips, VOICE_LOCALE } from '@/lib/voice';
import { speechSilence } from '@/lib/silent-audio';

const KEEP_AWAKE_TAG = 'run';
/** End asks first once more than this share of a known total is done (SPEC §7 screen 3). */
const CONFIRM_END_SHARE = 0.1;
/** Without a known total (open intervals): ask after this much time. */
const CONFIRM_END_OPEN_MS = 60_000;

type Phase = 'loading' | 'conflict' | 'link' | 'preparing' | 'ready' | 'missing';
/** What one frame shows; refreshed by the tick and after every action (render never reads the session ref). */
type Snap = { v: RunnerView; totalMs: number | null; outputs: CueOutput };

// Status bar clock follows the text colour chosen for the interval colour (white text -> light clock).
function fgIsLight(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(hex);
  if (!m) return true;
  return (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 > 128;
}

export default function RunScreen() {
  const { id, recover } = useLocalSearchParams<{
    id: string;
    recover?: string;
  }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const t = useT();
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const landscape = width > height;
  const [phase, setPhase] = useState<Phase>('loading');
  const [voiceNote, setVoiceNote] = useState(false);
  const [locked, setLocked] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [snap, setSnap] = useState<Snap | null>(null);
  const sessionRef = useRef<RunSession | null>(null);
  /** This screen's id in the two-sessions guard (D41). */
  const [token] = useState(() => `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  /** Another workout runs: its name while the End/Keep question shows. */
  const [conflictName, setConflictName] = useState('');
  /** Opened from a link (F11): the timer's name while "Start <name>?" shows, and whether that Start was tapped. */
  const [linkName, setLinkName] = useState('');
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  /** iOS Live Activity switch (D40): the saved setting, changed from this screen. */
  const [liveOn, setLiveOn] = useState(false);
  const liveRef = useRef(false);
  const [liveAvailable] = useState(() => liveActivityAvailable());
  const pausedLabel = t('run.paused');
  const refresh = useCallback(() => {
    const s = sessionRef.current;
    if (s) {
      const v = s.view();
      setSnap({
        v,
        totalMs: s.state.timeline.totalMs,
        outputs: s.outputs,
      });
      syncLiveActivity({ enabled: liveRef.current, timerName: s.meta.timerName, view: v, nowWall: Date.now(), pausedLabel }).catch(() => {});
    }
  }, [pausedLabel]);

  // Load the timer (or the recovery record), prepare voice clips, create the driver, start.
  useEffect(() => {
    let cancelled = false;
    let driver: CueDriver | null = null;
    let keptAwake = false;
    /** Ended by another screen's "End it and start" (D41): no Done screen from here. */
    let quietEnd = false;
    (async () => {
      const other = otherActiveRun(token);
      if (other && recover !== '1') {
        setConflictName(other.timerName);
        setPhase('conflict');
        return;
      }
      // F11: not started from the app's own UI → a link; it waits for a tap (a recovery link goes home, where the Resume
      // offer is)
      if (!linkConfirmed && !hasStartIntent(id)) {
        if (recover === '1') {
          if (!cancelled) router.replace('/');
          return;
        }
        const linked = await getTimer(db, Number(id));
        if (cancelled) return;
        if (!linked) {
          setPhase('missing');
          return;
        }
        setLinkName(linked.name);
        setPhase('link');
        return;
      }
      const settings = await readSettings(db);
      liveRef.current = settings.liveActivity;
      setLiveOn(settings.liveActivity);
      let meta: RunMeta;
      let initial: RunnerState;
      let options: Parameters<typeof buildTimeline>[1];
      if (recover === '1') {
        const record = parseRecovery(settings.recovery);
        const outcome = record ? evaluateRecovery(record, Date.now()) : null;
        if (!record || !outcome || outcome.status !== 'resume') {
          if (!cancelled) router.replace('/');
          return;
        }
        options = record.options;
        meta = {
          timerId: record.timerId,
          timerName: record.timerName,
          def: record.def,
          startedAtWall: record.startedAtWall,
          interrupted: true,
        };
        const restored = restoreRunner(record, outcome, performance.now());
        // the user tapped "Resume at m:ss" for a running record: it continues at once; a paused one waits
        initial = outcome.paused ? restored : apply(restored, 'resume', performance.now());
      } else {
        const timer = await getTimer(db, Number(id));
        if (!timer) {
          clearStartIntent();
          if (!cancelled) setPhase('missing');
          return;
        }
        const def = {
          name: timer.name,
          color: timer.color,
          notes: timer.notes,
          blocks: timer.blocks,
          prefs: timer.prefs,
        };
        options = {
          countdownFrom: settings.countdownFrom,
          language,
          voiceId: settings.voiceId,
          vibrate: def.prefs.vibrate && settings.haptics,
        };
        meta = {
          timerId: timer.id,
          timerName: timer.name,
          def,
          startedAtWall: Date.now(),
          interrupted: false,
        };
        initial = idle(buildTimeline(def, options));
        touchTimer(db, timer.id).catch(() => {});
      }
      if (cancelled) return;
      setPhase('preparing');
      const voice = settings.voiceEnabled ? await prepareVoiceClips(meta.def, options) : null;
      if (cancelled) return;
      const clips = voice?.clips ?? new Map();
      setVoiceNote(!!voice && (!voice.available || voice.failed.length > 0));
      const speechLanguage = VOICE_LOCALE[options.language];
      const speak = (cue: Cue) => {
        if (!settings.voiceEnabled || !cue.text || AppState.currentState !== 'active') return;
        Speech.speak(cue.text, {
          language: speechLanguage,
          ...speechSilence(),
          ...(options.voiceId ? { voice: options.voiceId } : {}),
        });
      };
      driver = createCueDriver({
        title: meta.def.name,
        beepSet: settings.beepSet,
        volume: settings.volume,
        sound: true,
        respectSilent: settings.respectSilent,
        voice: clips,
        log: new TimingLog(),
        labels: { skip: t('run.skip'), end: t('run.end') },
        onAction: (e) => sessionRef.current?.onRunnerAction(e),
        onCue: (cue, info) => {
          if (info.vibrate && cue.vibration) cueHaptic(cue.kind);
          if (info.sound && cue.voiceClipId && !info.voiceClip) speak(cue);
        },
      });
      const session = new RunSession(
        {
          db,
          driver,
          onFinished: (sessionId) => {
            if (quietEnd) return;
            router.replace({
              pathname: '/done/[id]',
              params: { id: String(sessionId) },
            });
          },
          // swiped away (Android): the record stays; show the Resume offer if this screen is ever seen again
          onDetached: () => router.replace('/'),
          onMissingVoice: speak,
          hasVoiceClip: (clipId) => clips.has(clipId),
        },
        meta,
        initial
      );
      sessionRef.current = session;
      setActiveRun({
        token,
        timerName: meta.timerName,
        end: () => {
          quietEnd = true;
          clearActiveRun(token);
          session.act('end');
          return session.whenFinished();
        },
      });
      if (settings.keepScreenOn) {
        keptAwake = true;
        activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      }
      clearStartIntent();
      session.begin();
      refresh();
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
      clearActiveRun(token);
      const session = sessionRef.current;
      // only a screen that ran a workout owns the activity (a conflict screen must not end the other run's one)
      if (session) syncLiveActivity({ enabled: false, timerName: '', view: null, nowWall: Date.now(), pausedLabel: '' }).catch(() => {});
      const d = driver;
      // let the end chime / "Done" finish before the players are released
      if (d) setTimeout(() => d.dispose(), session?.isFinished && session.state.endedBy === 'finished' ? 4000 : 0);
      Speech.stop();
      if (keptAwake) deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
    // one run per screen instance; the language and labels of its start apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, id, recover, linkConfirmed]);

  // The tick: settles the natural end and redraws (5 per second keeps the seconds digit exact).
  useEffect(() => {
    if (phase !== 'ready') return;
    const h = setInterval(() => {
      sessionRef.current?.tick();
      refresh();
    }, 200);
    const unsub = sessionRef.current?.subscribe(refresh);
    return () => {
      clearInterval(h);
      unsub?.();
    };
  }, [phase, refresh]);

  // Back (Android button, gesture) never drops a running workout: it asks to end it (D39).
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      const s = sessionRef.current;
      if (!s || s.isFinished || s.isDetached || phase !== 'ready') return;
      e.preventDefault();
      setConfirmEnd(true);
    });
  }, [navigation, phase]);

  if (phase === 'missing') {
    return (
      <View testID="run-screen" style={[styles.center, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <ThemedText>{t('run.notFound')}</ThemedText>
      </View>
    );
  }
  if (phase === 'conflict') {
    // SPEC §9: starting a timer while one runs asks End/Keep (D41).
    const keep = () => (router.canGoBack() ? router.back() : router.replace('/'));
    const endAndStart = async () => {
      // the other run is saved (ended early) without its Done screen; both screens leave and this timer starts fresh
      await otherActiveRun(token)?.end();
      router.dismissTo('/');
      armStart(id);
      router.push({ pathname: '/run/[id]', params: { id: String(id) } });
    };
    return (
      <View testID="run-conflict" style={[styles.center, { backgroundColor: theme.background, gap: Spacing.three }]}>
        <ThemedText testID="run-conflict-title" type="smallBold" style={{ textAlign: 'center' }}>
          {t('run.conflictTitle', { name: conflictName })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
          {t('run.conflictBody')}
        </ThemedText>
        <Button testID="run-conflict-keep" label={t('run.conflictKeep')} onPress={keep} style={styles.conflictButton} />
        <Button testID="run-conflict-end" variant="secondary" label={t('run.conflictEnd')} onPress={endAndStart} style={styles.conflictButton} />
      </View>
    );
  }
  if (phase === 'link') {
    // F11: a link opened this screen; one tap starts (a web page or another app cannot start a workout by itself)
    const cancel = () => (router.canGoBack() ? router.back() : router.replace('/'));
    return (
      <View testID="run-link" style={[styles.center, { backgroundColor: theme.background, gap: Spacing.three }]}>
        <ThemedText testID="run-link-name" type="smallBold" style={{ textAlign: 'center' }}>
          {linkName}
        </ThemedText>
        <Button testID="run-link-start" label={t('home.startNamed', { name: linkName })} onPress={() => setLinkConfirmed(true)} style={styles.conflictButton} />
        <Button testID="run-link-cancel" variant="secondary" label={t('common.cancel')} onPress={cancel} style={styles.conflictButton} />
      </View>
    );
  }
  if (phase !== 'ready' || !snap) {
    return (
      <View testID="run-preparing" style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textSecondary">{phase === 'preparing' ? t('run.preparing') : ''}</ThemedText>
      </View>
    );
  }

  const { v, totalMs: total, outputs } = snap;
  const seg = v.location?.segment ?? null;
  // The colour the user chose for the interval (or its type default, as in 1.0.0) fills the screen; text is white or black for
  // contrast. Only a screen without an interval colour uses the brand accent.
  const { bg, fg } = runColors(seg?.color, theme.tint, theme.onTint);
  const openSeg = !!seg && seg.endMs === null;
  const big = openSeg ? formatElapsedMs(v.location?.inSegmentMs ?? 0) : formatRemainingMs(v.location?.remainingMs ?? 0);
  const paused = v.status === 'paused';

  const act = (action: RunnerAction) => {
    sessionRef.current?.act(action);
    refresh();
  };
  const setOutput = (out: CueOutput) => {
    sessionRef.current?.setOutput(out);
    refresh();
  };
  // D40: opt-in; the choice is saved (Settings shows the same switch) and applies at once
  const toggleLive = () => {
    const next = !liveOn;
    liveRef.current = next;
    setLiveOn(next);
    setSetting(db, 'liveActivity', next).catch(() => {});
    refresh();
  };
  const onEnd = () => {
    const done = total ? v.elapsedMs / total > CONFIRM_END_SHARE : v.elapsedMs > CONFIRM_END_OPEN_MS;
    if (done) setConfirmEnd(true);
    else act('end');
  };

  // the numerals fill the width: start large, adjustsFontSizeToFit shrinks them to the line (ThemedText caps Dynamic Type)
  // small screens with large text sizes (SE class at accessibility sizes) need smaller numerals or the column overflows
  const timeSize = countdownFontSize({ platform: Platform.OS, width, height, fontScale, landscape });
  const display = (
    <View style={[styles.display, landscape && styles.displayLandscape]}>
      <ThemedText testID="run-status-line" type="small" style={[styles.status, { color: fg }]} maxFontSizeMultiplier={1}>
        {t(statusLineKey(Platform.OS === 'ios' ? 'ios' : 'android'))}
      </ThemedText>
      <ThemedText testID="run-path" type="smallBold" style={[styles.path, { color: fg }]}>
        {[seg?.pathLabel, seg?.repeatLabel].filter(Boolean).join(' · ')}
      </ThemedText>
      <ThemedText testID="run-label" style={[styles.label, { color: fg }]} numberOfLines={2} adjustsFontSizeToFit>
        {seg?.label ?? ''}
      </ThemedText>
      <ThemedText
        testID="run-remaining"
        accessibilityLabel={`${seg?.label ?? ''}, ${big}`}
        style={[styles.time, { color: fg, fontSize: timeSize, lineHeight: timeSize * 1.1 }]}
        numberOfLines={1}
        minimumFontScale={0.3}
        {...(Platform.OS === 'ios' ? { maxFontSizeMultiplier: 1 } : {})}
        adjustsFontSizeToFit={Platform.OS !== 'ios' || big.length > 5}>
        {big}
      </ThemedText>
      {paused ? (
        <ThemedText testID="run-paused" type="smallBold" style={{ color: fg }}>
          {t('run.paused')}
        </ThemedText>
      ) : null}
      <ThemedText testID="run-next-line" type="default" style={{ color: fg }}>
        {openSeg ? t('run.openNext') : v.nextLogical ? t('run.upNext', { name: v.nextLogical.label }) : t('run.lastOne')}
      </ThemedText>
      <View style={[styles.progress, { borderColor: fg }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: fg,
              width: `${Math.round((v.progress ?? 0) * 100)}%`,
            },
          ]}
        />
      </View>
      <ThemedText testID="run-elapsed" type="small" numeric style={{ color: fg }}>
        {total !== null ? `${formatElapsedMs(v.elapsedMs)} / ${formatDuration(total / 1000)}` : formatElapsedMs(v.elapsedMs)}
      </ThemedText>
    </View>
  );

  const controls = (
    <View style={[styles.controls, landscape && styles.controlsLandscape]}>
      <View style={styles.ctrlRow}>
        <Ctrl testID="run-back" label={t('run.back')} onPress={() => act('back')} fg={fg} locked={locked} />
        <Ctrl testID="run-toggle" label={paused ? t('run.resume') : t('run.pause')} onPress={() => act('toggle')} fg={fg} locked={locked} solid bg={bg} />
        {openSeg ? (
          <Ctrl testID="run-next" label={t('run.next')} onPress={() => act('next')} fg={fg} locked={locked} />
        ) : (
          <Ctrl testID="run-skip" label={t('run.skip')} onPress={() => act('skip')} fg={fg} locked={locked} />
        )}
        <Ctrl testID="run-add" label={t('run.addTime')} onPress={() => act('addTime')} fg={fg} locked={locked} disabled={openSeg} />
        <Ctrl testID="run-end" label={t('run.end')} onPress={onEnd} fg={fg} locked={locked} />
      </View>
      <View style={styles.ctrlRow}>
        <Dial
          testID={locked ? 'run-unlock' : 'run-lock'}
          label={locked ? t('run.unlock') : t('run.lock')}
          on={locked}
          symbol="lock"
          onPress={() => !locked && setLocked(true)}
          onLongPress={() => setLocked(false)}
          fg={fg}
          bg={bg}
        />
        <Dial
          testID="run-sound"
          label={t('run.sound')}
          on={outputs.sound}
          symbol="speaker.wave.2"
          onPress={() => setOutput({ ...outputs, sound: !outputs.sound })}
          fg={fg}
          bg={bg}
          locked={locked}
          toggle
        />
        <Dial
          testID="run-vibration"
          label={t('run.vibration')}
          on={outputs.vibrate}
          symbol="iphone.radiowaves.left.and.right"
          onPress={() => setOutput({ ...outputs, vibrate: !outputs.vibrate })}
          fg={fg}
          bg={bg}
          locked={locked}
          toggle
        />
        {liveAvailable ? (
          <Dial
            testID="run-live-activity"
            label={t('run.liveActivity')}
            on={liveOn}
            symbol="lock.rectangle"
            onPress={toggleLive}
            fg={fg}
            bg={bg}
            locked={locked}
            toggle
          />
        ) : null}
      </View>
      {locked ? (
        <ThemedText testID="run-locked-hint" type="small" style={{ color: fg, textAlign: 'center' }}>
          {t('run.unlockHint')}
        </ThemedText>
      ) : null}
      {voiceNote ? (
        <ThemedText testID="run-voice-note" type="small" style={[styles.status, { color: fg }]}>
          {t('run.voiceMissing')}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <View
      testID="run-screen"
      style={[
        styles.root,
        {
          backgroundColor: bg,
          paddingTop: insets.top + Spacing.two,
          paddingBottom: insets.bottom + Spacing.two,
          paddingLeft: insets.left + Spacing.three,
          paddingRight: insets.right + Spacing.three,
        },
        landscape && styles.rootLandscape,
      ]}>
      <StatusBar style={fgIsLight(fg) ? 'light' : 'dark'} />
      {display}
      {controls}
      {/* An in-screen overlay, not a RN Modal: a Modal shown a second time on iOS was missing from the accessibility
          tree (VoiceOver and Maestro could not reach its buttons; P6 run-controls flow). */}
      {confirmEnd ? (
        <View style={[StyleSheet.absoluteFill, styles.modalBackdrop, { backgroundColor: theme.scrim }]} accessibilityViewIsModal>
          <View testID="run-end-dialog" style={[styles.modal, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold">{t('run.endTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('run.endBody')}
            </ThemedText>
            <Button
              testID="run-end-confirm"
              label={t('run.end')}
              onPress={() => {
                setConfirmEnd(false);
                act('end');
              }}
            />
            <Button testID="run-end-cancel" variant="secondary" label={t('run.keepGoing')} onPress={() => setConfirmEnd(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Ctrl({
  testID,
  label,
  onPress,
  fg,
  bg,
  locked,
  disabled = false,
  solid = false,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  fg: string;
  bg?: string;
  locked: boolean;
  disabled?: boolean;
  solid?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || locked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ctrl,
        { borderColor: fg, backgroundColor: solid ? fg : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}>
      <ThemedText
        type="smallBold"
        style={{ color: solid && bg ? bg : fg, fontSize: 13 }}
        numberOfLines={1}
        minimumFontScale={0.6}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.15}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function glyphKind(symbol: string): DialGlyphKind {
  return symbol === 'lock' ? 'lock' : symbol === 'speaker.wave.2' ? 'sound' : symbol.startsWith('iphone') ? 'vibration' : 'live';
}

// Round 56 pt switch or lock with its name underneath; a filled circle means on.
function Dial({
  testID,
  label,
  on,
  symbol,
  onPress,
  onLongPress,
  fg,
  bg,
  locked = false,
  toggle = false,
}: {
  testID: string;
  label: string;
  on: boolean;
  symbol: ComponentProps<typeof SymbolView>['name'];
  onPress: () => void;
  onLongPress?: () => void;
  fg: string;
  bg: string;
  locked?: boolean;
  toggle?: boolean;
}) {
  const ink = on ? bg : fg;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityState={toggle ? { checked: on } : undefined}
      disabled={locked}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={800}
      style={styles.dial}>
      <View style={[styles.dialCircle, { borderColor: fg, backgroundColor: on ? fg : 'transparent' }]}>
        {Platform.OS === 'ios' ? (
          <SymbolView name={symbol} size={22} tintColor={ink} />
        ) : (
          <DialGlyph kind={glyphKind(symbol as string)} color={ink} off={toggle && !on} />
        )}
      </View>
      <ThemedText type="small" style={[styles.dialLabel, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  rootLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  display: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  displayLandscape: { flex: 3 },
  path: { textAlign: 'center' },
  label: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '900',
    textAlign: 'center',
  },
  time: {
    fontFamily: BrandFonts.numerals,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  progress: {
    alignSelf: 'stretch',
    height: 10,
    borderWidth: 1,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: { height: '100%' },
  controls: { gap: Spacing.three },
  controlsLandscape: { flex: 2 },
  ctrlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  ctrl: {
    width: 56,
    height: 56,
    borderWidth: 2,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  dial: { flex: 1, alignItems: 'center', gap: 4 },
  dialCircle: {
    width: 56,
    height: 56,
    borderWidth: 2,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialLabel: { fontSize: 12, lineHeight: 16, textAlign: 'center', alignSelf: 'stretch' },
  status: { textAlign: 'center', opacity: 0.85, fontSize: 12, lineHeight: 16 },
  conflictButton: { alignSelf: 'stretch' },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modal: {
    alignSelf: 'stretch',
    maxWidth: 420,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
