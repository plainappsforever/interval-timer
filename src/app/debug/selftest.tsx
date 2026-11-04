// Development-only cue self-test (V1_PLAN P5, SPEC §13 O3): runs a fixture timer through the real cue path (Android:
// the native session runner; iOS: the JS scheduler + audio bed) with pre-rendered voice clips, and shows the timing
// log's min/mean/max (A3/A4, spikes S1/S2). Not linked from the UI; open `plainintervals-dev://debug/selftest`.
// The log is also written to <documents>/timing-log.json (iOS) and the runner logs every cue to logcat (Android).
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { block, DEFAULT_PREFS, interval, type TimerDef } from '@/engine/model';
import { apply, elapsedAt, idle, settle, view, type RunnerAction, type RunnerState } from '@/engine/runner';
import { buildTimeline } from '@/engine/schedule';
import { formatDuration } from '@/engine/format';
import { useTheme } from '@/hooks/use-theme';
import { createCueDriver, type CueDriver, type SyncReason } from '@/lib/cues';
import { summarize, TimingLog, type TimingEntry, type TimingSummary } from '@/lib/timing-log';
import { prepareVoiceClips, type PrepareResult } from '@/lib/voice';

/** 10 s prep + 12 × (40 s work with halfway and countdown + 20 s rest with countdown) = 12:10 (A3 needs ≥ 12 min). */
const LONG: TimerDef = {
  name: 'Self-test 12 min',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 40, 'work', { halfwayCue: true }), interval('Rest', 20, 'rest')], { rounds: 12 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 10 },
};
/** The smoke flow's 20-second timer: 3 s prep + 2 × (5 s work, 3 s rest) + an end cue. */
const SHORT: TimerDef = {
  name: 'Self-test short',
  color: '',
  notes: '',
  blocks: [block([interval('Work', 5, 'work'), interval('Rest', 3, 'rest')], { rounds: 2 })],
  prefs: { ...DEFAULT_PREFS, prepSeconds: 3 },
};
const OPTIONS = { countdownFrom: 3 as const, language: 'en' as const, voiceId: null };

const fmt = (s: TimingSummary | null) => (s ? `n=${s.n} min=${s.min} mean=${s.mean} max=${s.max} ms` : 'n=0');

export default function DebugSelfTestScreen() {
  const theme = useTheme();
  const development = Constants.expoConfig?.extra?.appVariant === 'development';
  const [voice, setVoice] = useState<PrepareResult | null>(null);
  const [snap, setSnap] = useState({ status: 'idle', engine: 'cues: -', all: 'n=0', bg: 'n=0', voiceCues: 'voice cues: 0, not playing: 0' });
  const state = useRef<RunnerState | null>(null);
  const driver = useRef<CueDriver | null>(null);
  const [log] = useState(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    let latest: readonly TimingEntry[] = [];
    return new TimingLog((entries) => {
      latest = entries;
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        try {
          new File(Paths.document, 'timing-log.json').write(JSON.stringify(latest));
        } catch {
          // debug output only
        }
      }, 1000);
    });
  });

  useEffect(() => {
    const h = setInterval(() => {
      const s = state.current;
      if (s && s.status === 'running') {
        const settled = settle(s, performance.now());
        if (settled.status === 'ended') {
          state.current = settled;
          driver.current?.sync(settled, 'end');
        }
      }
      const cur = state.current;
      const now = performance.now();
      const v = cur ? view(cur, now) : null;
      const entries = log.all();
      setSnap({
        status: cur && v ? `${v.status} ${v.location?.segment.label ?? ''} ${formatDuration(Math.round(elapsedAt(cur, now) / 1000))}` : 'idle',
        engine: driver.current ? (driver.current.native ? 'cues: native runner (logcat SessionRunner)' : 'cues: JS scheduler') : 'cues: -',
        all: fmt(summarize(entries)),
        bg: fmt(summarize(entries, (e) => e.mode !== 'active')),
        voiceCues: `voice cues: ${entries.filter((e) => e.played.includes('voice')).length}, not playing: ${entries.filter((e) => e.played === 'voice-not-playing').length}`,
      });
    }, 250);
    return () => {
      clearInterval(h);
      driver.current?.dispose();
    };
  }, [log]);

  function act(action: RunnerAction, reason: SyncReason) {
    const s = state.current;
    if (!s) return;
    const next = apply(s, action, performance.now());
    if (next === s) return;
    state.current = next;
    driver.current?.sync(next, next.status === 'ended' ? 'end' : reason);
  }

  async function prepare(def: TimerDef) {
    const r = await prepareVoiceClips(def, OPTIONS);
    setVoice(r);
    console.log(`[selftest] voice ${Platform.OS}: rendered=${r.rendered} cached=${r.cached} failed=${r.failed.length} ms=${r.ms} available=${r.available}${r.failed.length ? ` first failure: ${r.failed[0].text} (${r.failed[0].reason})` : ''}`);
    return r;
  }

  async function run(def: TimerDef) {
    driver.current?.dispose();
    log.clear();
    const v = await prepare(def); // cached clips are reused; a timer's own texts ("Round 1 of 2") are rendered here
    driver.current = createCueDriver({
      title: def.name,
      beepSet: 'classic',
      volume: 1,
      sound: true,
      respectSilent: false,
      voice: v.clips,
      log,
      labels: { skip: 'Skip', end: 'End' },
      onAction: (e) => {
        console.log(`[selftest] runner action ${e.action} at ${e.elapsedMs}`);
        const s = state.current;
        if (!s) return;
        if (e.action === 'finished' || e.action === 'taskRemoved') {
          state.current = settle(s, performance.now());
          return;
        }
        if (e.action === 'pause' || e.action === 'resume') {
          // the runner already paused/resumed itself; only the engine state follows
          state.current = apply(s, e.action, performance.now());
          return;
        }
        act(e.action === 'skip' ? 'skip' : 'end', e.action === 'skip' ? 'jump' : 'end');
      },
    });
    const s = apply(idle(buildTimeline(def, OPTIONS)), 'start', performance.now());
    state.current = s;
    driver.current.sync(s, 'start');
    console.log(`[selftest] start ${def.name} native=${driver.current.native} total=${s.timeline.totalMs} cues=${s.timeline.cues.length}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Debug: cue self-test' }} />
      <ScrollView testID="debug-selftest-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        {!development ? (
          <ThemedText>Development builds only.</ThemedText>
        ) : (
          <>
            <Button testID="selftest-prepare" label="Render voice clips" onPress={() => prepare(LONG)} />
            <Button testID="selftest-start-long" label="Start 12-minute test" onPress={() => run(LONG)} />
            <Button testID="selftest-start-short" label="Start 20-second test" onPress={() => run(SHORT)} />
            <Button testID="selftest-toggle" label="Pause / Resume" onPress={() => act('toggle', state.current?.status === 'running' ? 'pause' : 'resume')} />
            <Button testID="selftest-skip" label="Skip" onPress={() => act('skip', 'jump')} />
            <Button testID="selftest-end" label="End" onPress={() => act('end', 'end')} />
            <ThemedText testID="selftest-status">{snap.status}</ThemedText>
            <ThemedText testID="selftest-voice">
              {voice ? `voice: available=${voice.available} rendered=${voice.rendered} cached=${voice.cached} failed=${voice.failed.length} in ${voice.ms} ms` : 'voice: not prepared'}
            </ThemedText>
            {voice?.failed.length ? <ThemedText>{`first failure: ${voice.failed[0].text}: ${voice.failed[0].reason}`}</ThemedText> : null}
            <ThemedText testID="selftest-engine">{snap.engine}</ThemedText>
            <ThemedText testID="selftest-summary">{`all: ${snap.all}`}</ThemedText>
            <ThemedText testID="selftest-summary-bg">{`background: ${snap.bg}`}</ThemedText>
            <ThemedText testID="selftest-voice-played">{snap.voiceCues}</ThemedText>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
});
