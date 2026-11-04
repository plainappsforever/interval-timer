// interval-timer P8 (copied from pdf-scanner P10b S3, eye-app's plugin): the app sends no notifications and uses no push, but the generated iOS
// entitlements carried `aps-environment` (expo-notifications is a template dependency and its plugin adds the key). The key would add the Push capability to
// the App ID at the first device build and invite a review question. Removed here; listed early in app.config.ts so
// it runs after the other entitlement mods (mods of one type run last-registered-first).
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
