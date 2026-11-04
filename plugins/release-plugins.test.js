// P8 (SPEC §3/§10, A18, D20): the release-hygiene plugins on small inputs, and which variant gets what.
const withNoInternet = require('./with-no-internet');
const withDevClientLinking = require('./with-dev-client-linking');
const withoutDevClientResidue = require('./without-dev-client-residue');
const withoutPushEntitlement = require('./without-push-entitlement');

function loadConfig(variant) {
  let cfg;
  jest.isolateModules(() => {
    const before = process.env.APP_VARIANT;
    process.env.APP_VARIANT = variant;
    try {
      cfg = require('../app.config.ts').default({ config: {} });
    } finally {
      if (before === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = before;
    }
  });
  return cfg;
}
const options = (cfg, file) => cfg.plugins.find((p) => Array.isArray(p) && p[0] === file)?.[1];

function runManifestMod(plugin, opts, manifest) {
  const cfg = plugin({ name: 'x', slug: 'x' }, opts);
  return cfg.mods.android.manifest({ modResults: manifest, modRequest: { platform: 'android' }, modRawConfig: {} });
}

test('no-INTERNET: release variants remove INTERNET with a merge marker; development puts it back', async () => {
  const release = options(loadConfig('preview'), './plugins/with-no-internet.js');
  const dev = options(loadConfig('development'), './plugins/with-no-internet.js');
  expect(release.release).toBe(true);
  expect(dev.release).toBe(false);
  const manifest = () => ({
    manifest: {
      $: {},
      'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }, { $: { 'android:name': 'android.permission.VIBRATE' } }],
      application: [{ $: {} }],
    },
  });
  const r = await runManifestMod(withNoInternet, release, manifest());
  const perms = r.modResults.manifest['uses-permission'].map((p) => p.$);
  expect(perms).toContainEqual({ 'android:name': 'android.permission.INTERNET', 'tools:node': 'remove' });
  expect(perms.filter((p) => p['android:name'] === 'android.permission.INTERNET')).toHaveLength(1);
  expect(perms).toContainEqual({ 'android:name': 'android.permission.VIBRATE' });
  const d = await runManifestMod(withNoInternet, dev, manifest());
  expect(d.modResults.manifest['uses-permission'].map((p) => p.$)).toContainEqual({ 'android:name': 'android.permission.INTERNET' });
});

test('release blockedPermissions carry the library extras of D20 and never a permission the app needs', () => {
  const blocked = loadConfig('production').android.blockedPermissions;
  for (const p of ['POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'MODIFY_AUDIO_SETTINGS', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW', 'ACCESS_NETWORK_STATE']) {
    expect(blocked).toContain(`android.permission.${p}`);
  }
  for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'WAKE_LOCK', 'VIBRATE']) {
    expect(blocked).not.toContain(`android.permission.${p}`);
  }
});

test('the development client is configured for development only and unlinked from release Podfiles', () => {
  const dev = loadConfig('development');
  const preview = loadConfig('preview');
  expect(dev.plugins).toContainEqual(['expo-dev-client', { launchMode: 'most-recent' }]);
  expect(preview.plugins).not.toContainEqual(['expo-dev-client', { launchMode: 'most-recent' }]);
  expect(preview.plugins).not.toContain('./plugins/with-dev-menu-defaults.js');
  expect(options(preview, './plugins/with-dev-client-linking.js')).toEqual({ release: true });
  expect(options(dev, './plugins/with-dev-client-linking.js')).toEqual({ release: false });
  const podfile = "target 'App' do\n  use_expo_modules!\nend\n";
  const out = withDevClientLinking.podfile(podfile, true);
  expect(out).toContain("use_expo_modules!(exclude: ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'])");
  expect(withDevClientLinking.podfile(out, false)).toBe(podfile);
});

test('residue plugin: release Info.plist loses the dev-client keys and foreign schemes, keeps its own', async () => {
  const cfg = withoutDevClientResidue({ name: 'x', slug: 'x' }, { keep: 'plainintervals-preview', release: true });
  const plist = {
    EXDevMenuShowsAtLaunch: false,
    NSLocalNetworkUsageDescription: 'Expo Dev Launcher uses the local network',
    NSBonjourServices: ['_expo._tcp'],
    UIBackgroundModes: ['audio'],
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['plainintervals-preview', 'plainintervals-dev'] }, { CFBundleURLSchemes: ['exp+interval-timer'] }],
  };
  const r = await cfg.mods.ios.infoPlist({ modResults: plist, modRequest: { platform: 'ios' }, modRawConfig: {} });
  expect(r.modResults).toEqual({ UIBackgroundModes: ['audio'], CFBundleURLTypes: [{ CFBundleURLSchemes: ['plainintervals-preview'] }] });
});

test('push entitlement removed, App Groups kept', async () => {
  const cfg = withoutPushEntitlement({ name: 'x', slug: 'x' });
  const r = await cfg.mods.ios.entitlements({
    modResults: { 'aps-environment': 'development', 'com.apple.security.application-groups': ['group.x'] },
    modRequest: { platform: 'ios' },
    modRawConfig: {},
  });
  expect(r.modResults).toEqual({ 'com.apple.security.application-groups': ['group.x'] });
});

test('widget extension: Release gets -O, no debug dylib, iPhone only; Debug untouched; registered before expo-widgets', () => {
  const { applyReleaseSettings } = require('./with-widget-release-settings');
  const debug = { name: 'Debug', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"', TARGETED_DEVICE_FAMILY: '"1,2"' } };
  const release = { name: 'Release', buildSettings: { SWIFT_OPTIMIZATION_LEVEL: '"-Onone"', TARGETED_DEVICE_FAMILY: '"1,2"' } };
  const appRelease = { name: 'Release', buildSettings: { PRODUCT_NAME: 'App' } };
  const project = {
    pbxTargetByName: (n) => (n === 'ExpoWidgetsTarget' ? { buildConfigurationList: 'L1' } : null),
    pbxXCConfigurationList: () => ({ L1: { buildConfigurations: [{ value: 'D' }, { value: 'R' }] } }),
    pbxXCBuildConfigurationSection: () => ({ D: debug, R: release, A: appRelease }),
  };
  expect(applyReleaseSettings(project, 'ExpoWidgetsTarget')).toBe(1);
  expect(release.buildSettings).toEqual({ SWIFT_OPTIMIZATION_LEVEL: '"-O"', ENABLE_DEBUG_DYLIB: 'NO', TARGETED_DEVICE_FAMILY: '1' });
  expect(debug.buildSettings.SWIFT_OPTIMIZATION_LEVEL).toBe('"-Onone"');
  expect(appRelease.buildSettings).toEqual({ PRODUCT_NAME: 'App' });
  expect(applyReleaseSettings(project, 'Missing')).toBe(0);
  const plugins = loadConfig('preview').plugins;
  const mine = plugins.indexOf('./plugins/with-widget-release-settings.js');
  const widgets = plugins.findIndex((p) => Array.isArray(p) && p[0] === 'expo-widgets');
  expect(mine).toBeGreaterThan(-1);
  expect(mine).toBeLessThan(widgets);
});

test('F1 (review 2026-10-26): no expo-notifications, so no Firebase / Play services / install referrer in the Android build', () => {
  const pkg = require('../package.json');
  // expo-notifications linked firebase-messaging (+ installations, datatransport, gms) and, through expo-application,
  // the Play install referrer; the app never sent a notification. The APK dex scan in V1_LOG is the binary-level check.
  for (const dep of ['expo-notifications', 'expo-application', '@react-native-firebase/app', '@react-native-firebase/messaging']) {
    expect(pkg.dependencies).not.toHaveProperty([dep]);
  }
  const lock = require('../package-lock.json');
  expect(Object.keys(lock.packages).filter((k) => /node_modules\/(expo-notifications|expo-application|badgin)$/.test(k))).toEqual([]);
  for (const variant of ['development', 'preview', 'production']) {
    expect(loadConfig(variant).plugins.flat()).not.toContain('expo-notifications');
  }
});

test('release iOS config declares no non-exempt encryption', () => {
  expect(loadConfig('preview').ios.config).toEqual({ usesNonExemptEncryption: false });
});
