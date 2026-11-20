// Settings (SPEC §7 screen 6, U9, U10, D16, D27, D40): language, voice cues (the phone's voices for the language,
// preview, "no voice" note), beep set (preview), volume, countdown from 3/5/10, halfway cue for new intervals,
// vibration, keep the screen on, respect the silent switch (iOS), Lock Screen activity (iOS, opt-in), appearance,
// backup / restore / restore templates, "What keeps running when locked" and privacy. Every value is saved at once.
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Stack, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import VoiceRender, { type VoiceInfo } from '../../modules/voice-render/src/VoiceRenderModule';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { PRIVACY_URL } from '@/constants/app';
import { Radius, Spacing } from '@/constants/theme';
import { exportBackup, restoreBackup, type RestoreSummary } from '@/db/backup';
import { useSQLiteContext } from '@/db/provider';
import { DEFAULT_SETTINGS, readSettings, setSetting, type BeepSet, type CountdownFrom, type Settings, type ThemePreference } from '@/db/settings';
import { restoreTemplates } from '@/db/templates';
import { parseBackup, type ParsedBackup, type RestoreMode } from '@/engine/backup';
import { LANGUAGE_NAMES, LANGUAGE_PREFERENCES, type LanguagePreference } from '@/i18n';
import { applyLanguagePreference } from '@/i18n/device-language';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { previewBeep } from '@/lib/audio';
import { listBackupFiles, readTextFile, saveBackupFile, shareFile, type SavedBackup } from '@/lib/files';
import { liveActivityAvailable } from '@/lib/live-activity';
import { applyThemePreference } from '@/lib/theme-preference';
import { VOICE_LOCALE } from '@/lib/voice';
import { speechSilence } from '@/lib/silent-audio';

const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];
const BEEP_SETS: BeepSet[] = ['classic', 'soft', 'bright'];
const VOLUMES = [0.25, 0.5, 0.75, 1];
const COUNTDOWNS: CountdownFrom[] = [3, 5, 10];
/** Voices listed per language (some phones carry dozens of novelty voices). */
const MAX_VOICES = 8;

type Pending = { backup: ParsedBackup; source: string };

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const t = useT();
  const router = useRouter();
  const language = useLanguage();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [backups, setBackups] = useState<SavedBackup[]>(() => listBackupFiles());
  const [lastBackup, setLastBackup] = useState<SavedBackup | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState('');
  const [liveAvailable] = useState(() => liveActivityAvailable());

  useEffect(() => {
    readSettings(db).then(setS);
  }, [db]);

  // the phone's offline voices for the UI language (any region of it), the exact locale first
  useEffect(() => {
    let cancelled = false;
    const locale = VOICE_LOCALE[language];
    const primary = locale.split('-')[0];
    (VoiceRender ? VoiceRender.voices(primary) : Promise.resolve([] as VoiceInfo[]))
      .then((list) => {
        if (cancelled) return;
        const exact = (v: VoiceInfo) => (v.language.replace('_', '-').toLowerCase() === locale.toLowerCase() ? 0 : 1);
        setVoices([...list].sort((a, b) => exact(a) - exact(b) || a.name.localeCompare(b.name)).slice(0, MAX_VOICES));
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const save = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setS((prev) => ({ ...prev, [key]: value }));
      setSetting(db, key, value).catch(() => {});
    },
    [db]
  );

  function chooseLanguage(pref: LanguagePreference) {
    setLanguageOpen(false);
    save('language', pref);
    // a chosen voice belongs to the old language
    save('voiceId', null);
    applyLanguagePreference(pref);
  }

  function chooseTheme(value: ThemePreference) {
    save('theme', value);
    applyThemePreference(value);
  }

  function previewVoice() {
    Speech.stop();
    Speech.speak(`${t('cue.getReady')}. 3, 2, 1. ${t('cue.work')}`, {
      language: VOICE_LOCALE[language],
      ...speechSilence(),
      ...(s.voiceId ? { voice: s.voiceId } : {}),
    });
  }

  async function makeBackup() {
    try {
      const file = saveBackupFile(await exportBackup(db));
      const saved = { name: file.name, uri: file.uri, size: file.size ?? 0 };
      setLastBackup(saved);
      setBackups(listBackupFiles());
      setStatus(t('settings.backupSaved', { name: saved.name }));
    } catch {
      setStatus(t('settings.backupFailed'));
    }
  }

  async function openBackup(uri: string, source: string) {
    try {
      const parsed = parseBackup(await readTextFile(uri));
      if (!parsed.ok) {
        setStatus(parsed.reason === 'version' ? t('import.version') : t('settings.restoreInvalid'));
        return;
      }
      setStatus('');
      setPending({ backup: parsed.backup, source });
    } catch {
      setStatus(t('settings.restoreInvalid'));
    }
  }

  async function pickBackup() {
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets[0]) return;
    await openBackup(picked.assets[0].uri, picked.assets[0].name);
  }

  async function restore(mode: RestoreMode) {
    if (!pending) return;
    const backup = pending.backup;
    setPending(null);
    try {
      const r: RestoreSummary = await restoreBackup(db, backup, mode);
      const next = await readSettings(db);
      setS(next);
      applyThemePreference(next.theme);
      applyLanguagePreference(next.language);
      setStatus(t('settings.restored', { timers: r.timersCreated + r.timersReplaced + r.timersKeptIdentical, sessions: r.sessionsAdded }));
    } catch {
      setStatus(t('settings.restoreFailed'));
    }
  }

  async function addTemplates() {
    const n = await restoreTemplates(db, t);
    setStatus(t('settings.templatesAdded', { n }));
  }

  const languageLabel = (pref: LanguagePreference) => (pref === 'system' ? t('settings.language.system') : LANGUAGE_NAMES[pref]);
  const ios = Platform.OS === 'ios';

  return (
    <>
      <Stack.Screen options={{ title: t('settings.title') }} />
      <ScrollView
        testID="settings-screen"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic">
        <Section title={t('settings.language')}>
          <Pressable
            testID="settings-language"
            accessibilityRole="button"
            accessibilityLabel={`${t('settings.language')}: ${languageLabel(s.language)}`}
            onPress={() => setLanguageOpen((o) => !o)}
            style={[styles.rowLine, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText testID="settings-language-value" type="smallBold" style={styles.flex}>
              {languageLabel(s.language)}
            </ThemedText>
            <ThemedText themeColor="textSecondary">{languageOpen ? '▲' : '▼'}</ThemedText>
          </Pressable>
          {languageOpen
            ? LANGUAGE_PREFERENCES.map((pref) => (
                <Choice key={pref} testID={`language-${pref}`} label={languageLabel(pref)} selected={pref === s.language} onPress={() => chooseLanguage(pref)} />
              ))
            : null}
        </Section>

        <Section title={t('settings.cues')}>
          <SwitchRow testID="set-voice" label={t('settings.voice')} value={s.voiceEnabled} onChange={(v) => save('voiceEnabled', v)} />
          {s.voiceEnabled ? (
            voices && voices.length === 0 ? (
              <ThemedText testID="settings-no-voice" type="small" themeColor="textSecondary">
                {t('settings.noVoice', { language: LANGUAGE_NAMES[language] })}
              </ThemedText>
            ) : (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('settings.voiceHint', { language: LANGUAGE_NAMES[language] })}
                </ThemedText>
                <Choice testID="voice-default" label={t('settings.voiceDefault')} selected={s.voiceId === null} onPress={() => save('voiceId', null)} />
                {(voices ?? []).map((v, i) => (
                  <Choice key={v.id} testID={`voice-${i}`} label={`${v.name} (${v.language})`} selected={s.voiceId === v.id} onPress={() => save('voiceId', v.id)} />
                ))}
                <Button testID="voice-preview" variant="secondary" label={t('editor.previewVoice')} onPress={previewVoice} />
              </>
            )
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {t('settings.beepSet')}
          </ThemedText>
          <Segmented
            options={BEEP_SETS.map((b) => ({ key: b, testID: `beep-${b}`, label: t(`settings.beep.${b}`) }))}
            selected={s.beepSet}
            onSelect={(b) => {
              save('beepSet', b);
              previewBeep(b, s.volume);
            }}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {t('settings.volume')}
          </ThemedText>
          <Segmented
            options={VOLUMES.map((v) => ({ key: v, testID: `volume-${Math.round(v * 100)}`, label: `${Math.round(v * 100)} %` }))}
            selected={s.volume}
            onSelect={(v) => {
              save('volume', v);
              previewBeep(s.beepSet, v);
            }}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {t('settings.countdownFrom')}
          </ThemedText>
          <Segmented options={COUNTDOWNS.map((c) => ({ key: c, testID: `countdown-${c}`, label: String(c) }))} selected={s.countdownFrom} onSelect={(c) => save('countdownFrom', c)} />
          <SwitchRow testID="set-halfway" label={t('settings.halfwayDefault')} value={s.halfwayDefault} onChange={(v) => save('halfwayDefault', v)} />
          <SwitchRow testID="set-haptics" label={t('settings.vibration')} value={s.haptics} onChange={(v) => save('haptics', v)} />
          {ios ? (
            <SwitchRow
              testID="set-respect-silent"
              label={t('settings.respectSilent')}
              hint={t('settings.respectSilentHint')}
              value={s.respectSilent}
              onChange={(v) => save('respectSilent', v)}
            />
          ) : null}
        </Section>

        <Section title={t('settings.screen')}>
          <SwitchRow testID="set-keep-awake" label={t('settings.keepScreenOn')} value={s.keepScreenOn} onChange={(v) => save('keepScreenOn', v)} />
          {liveAvailable ? (
            <SwitchRow
              testID="set-live-activity"
              label={t('settings.liveActivity')}
              hint={t('settings.liveActivityHint')}
              value={s.liveActivity}
              onChange={(v) => save('liveActivity', v)}
            />
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {t('settings.theme')}
          </ThemedText>
          <Segmented options={THEME_OPTIONS.map((o) => ({ key: o, testID: `theme-${o}`, label: t(`settings.theme.${o}`) }))} selected={s.theme} onSelect={chooseTheme} />
        </Section>

        <Section title={t('settings.data')}>
          {status ? (
            <ThemedText testID="settings-status" type="smallBold" themeColor="tintText">
              {status}
            </ThemedText>
          ) : null}
          <Button testID="settings-backup" label={t('settings.backup')} onPress={makeBackup} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.backupHint')}
          </ThemedText>
          {lastBackup ? (
            <Button
              testID="settings-backup-share"
              variant="secondary"
              label={t('settings.backupShare')}
              onPress={() => shareFile(lastBackup.uri, 'application/json', 'public.json', lastBackup.name).catch(() => {})}
            />
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {t('settings.restore')}
          </ThemedText>
          {backups.slice(0, 5).map((b, i) => (
            <Choice key={b.uri} testID={`backup-file-${i}`} label={b.name} selected={false} onPress={() => openBackup(b.uri, b.name)} />
          ))}
          <Button testID="settings-restore-file" variant="secondary" label={t('settings.restoreFile')} onPress={() => pickBackup().catch(() => {})} />
          {pending ? (
            <View testID="restore-preview" style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">
                {t('settings.restorePreview', { timers: pending.backup.timers.length, sessions: pending.backup.sessions.length, name: pending.source })}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('settings.restoreModes')}
              </ThemedText>
              <Button testID="restore-replace" label={t('settings.restoreReplace')} onPress={() => restore('replace')} />
              <Button testID="restore-keep-both" variant="secondary" label={t('settings.restoreKeepBoth')} onPress={() => restore('keepBoth')} />
              <Button testID="restore-cancel" variant="secondary" label={t('common.cancel')} onPress={() => setPending(null)} />
            </View>
          ) : null}
          <Button testID="settings-restore-templates" variant="secondary" label={t('settings.restoreTemplates')} onPress={addTemplates} />
        </Section>

        <Section title={t('settings.lockedTitle')}>
          <ThemedText testID="settings-locked-help" type="small">
            {ios ? t('settings.lockedIos') : t('settings.lockedAndroid')}
          </ThemedText>
        </Section>

        <Section title={t('settings.privacyTitle')}>
          <ThemedText testID="settings-privacy" type="small">
            {t('settings.privacy')}
          </ThemedText>
          {/* Apple 5.1.1(i) / Play: the policy is reachable in the app. Opens the phone's browser; the app has no network code. */}
          <Pressable
            testID="settings-privacy-link"
            accessibilityRole="link"
            onPress={() => Linking.openURL(PRIVACY_URL).catch(() => Alert.alert(t('settings.privacyOnline'), PRIVACY_URL))}>
            <ThemedText type="link">{t('settings.privacyOnline')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {PRIVACY_URL}
            </ThemedText>
          </Pressable>
          <Pressable testID="settings-licenses" accessibilityRole="link" onPress={() => router.push('/licenses')}>
            <ThemedText type="link">{t('licenses.open')}</ThemedText>
          </Pressable>
        </Section>

        <ThemedText type="small" themeColor="textSecondary" style={styles.section}>
          {t('settings.version', { version: String(Constants.expoConfig?.version), variant: String(Constants.expoConfig?.extra?.appVariant) })}
        </ThemedText>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionBox}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
    </View>
  );
}

function SwitchRow({ testID, label, hint, value, onChange }: { testID: string; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <ThemedText type="small">{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

function Choice({ testID, label, selected, onPress }: { testID: string; label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement }]}>
      <ThemedText type={selected ? 'smallBold' : 'small'} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Segmented<K extends string | number>({ options, selected, onSelect }: { options: { key: K; testID: string; label: string }[]; selected: K; onSelect: (k: K) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((o) => {
        const on = o.key === selected;
        return (
          <Pressable
            key={String(o.key)}
            testID={o.testID}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(o.key)}
            style={[styles.segment, on && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type={on ? 'smallBold' : 'small'}>{o.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  sectionBox: { gap: Spacing.two },
  section: { marginTop: Spacing.two },
  label: { marginTop: Spacing.one },
  flex: { flex: 1 },
  rowLine: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.card, padding: Spacing.three },
  option: { borderRadius: Radius.control, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  segmented: { flexDirection: 'row', borderRadius: Radius.control, padding: Spacing.one, gap: Spacing.one },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.inner },
});
