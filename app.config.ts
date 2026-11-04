import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
// Reverse-domain prefix of the bundle id / applicationId (owner, 2026-10-16: same scheme for every app; card-scanner D10).
// Never put a personal name into an identifier.
const ID_PREFIX = 'com.plainapps';
// PROVISIONAL product name (DECISIONS D11: the owner picks Plain Intervals / Roundset / Clearset before the first
// device build). Also in src/constants/app.ts (APP_NAME) for the UI; change both together.
const APP_NAME = 'Plain Intervals';
const APP_ID = 'plainintervals';
const VARIANTS = {
  development: { name: `${APP_NAME} Dev`, id: `${ID_PREFIX}.${APP_ID}.dev`, scheme: `${APP_ID}-dev` },
  preview: { name: `${APP_NAME} Preview`, id: `${ID_PREFIX}.${APP_ID}.preview`, scheme: `${APP_ID}-preview` },
  production: { name: APP_NAME, id: `${ID_PREFIX}.${APP_ID}`, scheme: APP_ID },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];
const others = Object.values(VARIANTS).filter((v) => v.id !== id);
const release = variant !== 'development';
// D40: iOS Live Activity (opt-in, D18/D27) through expo-widgets. The simulator build needs no team id (breathe D56);
// APPLE_TEAM_ID (optional, not a secret) becomes ios.appleTeamId for device builds. WIDGETS=0 builds without the
// extension: the Lock Screen switches disappear (src/lib/live-activity.ts liveActivityAvailable()).
const appleTeamId = process.env.APPLE_TEAM_ID || undefined;
const widgetsEnabled = process.env.WIDGETS !== '0';

// Release variants block Android permissions that library manifests merge in and nothing in the app uses
// (mood-journal D70, `aapt dump permissions` of its first preview APK; template D10). Development keeps them (INTERNET is
// needed for Metro). Each line says who adds the permission and why it is not needed. Pinned by
// plugins/permissions.test.js (F4: the release list is exactly the four of D20).
// Fix round 2026-10-26 (F1, D44): expo-notifications is gone, and with it Firebase push (c2dm) and ShortcutBadger's
// launcher-badge permissions; their lines went with it.
const RELEASE_BLOCKED = [
  // P8, A18 / D20 (the release list is exactly FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK, VIBRATE):
  // were expo-notifications' own two; since F1 no linked manifest declares them. Kept as a belt (blocking an unrequested
  // permission costs nothing): the app posts no notification of its own, the runner's media notification is exempt from
  // POST_NOTIFICATIONS (breathe D39), and nothing starts at boot.
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // expo-audio: only for earpiece routing (setMode / setSpeakerphoneOn, which Android skips without it); cues use the
  // media stream (SPEC §10).
  'android.permission.MODIFY_AUDIO_SETTINGS',
  // expo-file-system (max SDK 32): backups live in the app's own documents; files leave through the share sheet and come
  // back through the system picker, neither needs storage access (SPEC §10 "no storage").
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // Found in the first preview APK (aapt, P8): Expo's prebuild template declares SYSTEM_ALERT_WINDOW (dev overlays);
  // expo-image (Glide) and media3-exoplayer (expo-audio) merge ACCESS_NETWORK_STATE. Nothing here draws over other apps
  // or loads from the network; Glide falls back to no connectivity monitor and media3 catches the SecurityException.
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_NETWORK_STATE',
];

// Review F7 (P9): iOS localization ids of the app's UI languages (src/i18n/index.ts LANGUAGES, zh-CN → zh-Hans), 14 of
// 15: WITHOUT Arabic. Declaring `ar` was built and looked at on the simulator (V1_LOG P9): on an Arabic iPhone UIKit then
// mirrors the native navigation bar (History/Settings swap sides, back on the right) while the React Native content
// stays left-to-right as built and tested (V1_LOG P7) - a mixed layout. Without `ar` an Arabic iPhone gets the app's
// Arabic text in the left-to-right layout as before (pdf-scanner did the same). Add `ar` together with a real RTL pass.
const IOS_LOCALIZATIONS = ['en', 'de', 'es', 'pt-BR', 'fr', 'it', 'tr', 'ru', 'id', 'hi', 'ja', 'zh-Hans', 'ko', 'vi'];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'interval-timer',
  version: '1.0.0',
  // SPEC §3: the running screen turns to landscape; every other screen locks itself to portrait (src/app/_layout.tsx).
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    ...(appleTeamId ? { appleTeamId } : {}),
    icon: './assets/expo.icon',
    // P8: no encryption beyond the system's (ITSAppUsesNonExemptEncryption = false; export-compliance answer in RELEASE_KIT).
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Review F7 (P9): the UI languages of src/i18n, so the App Store and the system sheets (share, document picker) know
      // the app speaks them. Pinned by plugins/localizations.test.js.
      CFBundleLocalizations: IOS_LOCALIZATIONS,
    },
  },
  android: {
    package: id,
    adaptiveIcon: {
      backgroundColor: '#B43308',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // D12 (template, ported in D44.2): no Android Auto Backup / device transfer of the database or the app's own backup
    // files (plugins/with-backup-rules.js has the rule files). The user's shared backup file is how data moves. Every
    // variant, so the dev build backs up what the release does.
    allowBackup: false,
    ...(release ? { blockedPermissions: [...RELEASE_BLOCKED] } : {}),
  },
  plugins: [
    // P8 (pdf-scanner/print-cost pattern): only this variant's URL scheme; release variants also lose the
    // development-client residue (EXDevMenu keys, local-network text, Bonjour, exp+ scheme). FIRST, so its mods run after
    // the others'.
    ['./plugins/without-dev-client-residue.js', { keep: scheme, release }],
    // P8: no push entitlement (no notifications, no push). Since F1 nothing adds aps-environment any more (it was
    // expo-notifications' plugin); kept as a belt so a future library cannot bring the Push capability in silently.
    './plugins/without-push-entitlement.js',
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#B43308', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended. Development only (P8):
    // release variants do not link the development client at all (with-dev-client-linking.js, print-cost D83), and a
    // variant switch re-creates the native folder (D10), so nothing of it is left behind.
    ...(release ? [] : [['expo-dev-client', { launchMode: 'most-recent' }] as [string, object], './plugins/with-dev-menu-defaults.js']),
    ['./plugins/with-dev-client-linking.js', { release }],
    // P8, A18: no INTERNET in preview/production (dev builds need it for Metro); a development prebuild takes the
    // release-only remove markers out again.
    ['./plugins/with-no-internet.js', { release, alsoUnblock: release ? [] : [...RELEASE_BLOCKED] }],
    // D12 / D44.2: the SQLite folder and documents/backups are excluded from cloud backup and device transfer (API 24–30
    // and 31+ rule files).
    './plugins/with-backup-rules.js',
    // P9: Android release builds use the owner's upload key from a properties file OUTSIDE the repo
    // (~/Developer/.keys/interval-timer-release.properties) when it exists; otherwise the debug key with a warning.
    './plugins/with-release-signing.js',
    // D10: only THIS variant's URL schemes (Expo also registers the bundle id as a scheme), App Group and bundle-id prefix
    // survive a `prebuild --no-clean` after another variant; camera declared optional for Play. Keep it before any plugin
    // that adds an extension target (expo-widgets).
    [
      './plugins/with-variant-manifest.js',
      {
        ownId: id,
        otherIds: others.map((v) => v.id),
        otherSchemes: others.flatMap((v) => [v.scheme, v.id]),
        otherGroups: others.map((v) => `group.${v.id}`),
        optionalFeatures: ['android.hardware.camera'],
      },
    ],
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md D9.
    ['expo-build-properties', { android: { minSdkVersion: 26 }, ios: { enableSceneSupport: true } }],
    // D14/D16: the audio background mode keeps cues (and JS timers) running while the iPhone is locked; expo-audio's
    // microphone permission and RECORD_AUDIO are for a recording feature this app never has (D20, zero prompts).
    [
      'expo-audio',
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundRecording: false, enableBackgroundPlayback: true },
    ],
    // D40: the workout Live Activity (no home-screen widget in v1, no push updates). Android never links expo-widgets
    // (package.json expo.autolinking.android.exclude). After with-variant-manifest.js (see its comment).
    // P8: the extension's Release configuration gets release settings (-O, no debug dylib); BEFORE expo-widgets (see file).
    ...(widgetsEnabled ? ['./plugins/with-widget-release-settings.js', ['expo-widgets', { enableAndroid: false, widgets: [] }] as [string, object]] : []),
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
    widgetsEnabled,
  },
});
