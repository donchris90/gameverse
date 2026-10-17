// Expo config plugin: declares the microphone foreground-service type on notifee's service.
// Android 14 refuses to start a foreground service that does not declare its type in the manifest.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withVoiceForegroundService(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const application = manifest.application?.[0];
    if (!application) return mod;
    application.service = application.service ?? [];
    const name = 'app.notifee.core.ForegroundService';
    const existing = application.service.find((service) => service.$['android:name'] === name);
    const attributes = {
      'android:name': name,
      'android:foregroundServiceType': 'microphone',
      'tools:replace': 'android:foregroundServiceType',
    };
    if (existing) Object.assign(existing.$, attributes);
    else application.service.push({ $: attributes });
    return mod;
  });
};
