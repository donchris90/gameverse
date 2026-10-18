// Expo config plugin: stops Android's code shrinker (R8) from breaking WorkManager at start-up.
//
// Crash seen on a real phone (Infinix Smart 6, Android 11), before any screen was drawn:
//   Unable to get provider androidx.startup.InitializationProvider
//   Failed to create an instance of class androidx.work.impl.WorkDatabase.canonicalName
// @notifee/react-native (used for the voice foreground service) pulls in androidx.work, whose
// Room database class is looked up by name; R8 renamed or removed it in the release build.
//
// 1. Keep rules for WorkManager and Room databases, for every build.
// 2. Preview and development builds also switch the shrinker off (bigger APK, nothing obfuscated),
//    so a missing keep rule cannot crash an internal build. Production keeps the shrinker on.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');

const MARKER = '# gameverse: keep WorkManager (see plugins/with-work-manager-keep.js)';
const RULES = `
${MARKER}
-keep class androidx.work.** { *; }
-keep class androidx.work.impl.WorkDatabase { *; }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-keepclassmembers class * extends androidx.room.RoomDatabase { <init>(...); }
-keep class androidx.startup.InitializationProvider { *; }
-keep class * implements androidx.startup.Initializer { *; }
-dontwarn androidx.work.**
`;

function withKeepRules(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes(MARKER)) fs.writeFileSync(file, `${current}${RULES}`);
      return mod;
    },
  ]);
}

function setProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) existing.value = value;
  else properties.push({ type: 'property', key, value });
}

function withShrinkerOffForInternalBuilds(config) {
  return withGradleProperties(config, (mod) => {
    if ((process.env.APP_VARIANT ?? 'development') !== 'production') {
      setProperty(mod.modResults, 'android.enableMinifyInReleaseBuilds', 'false');
      setProperty(mod.modResults, 'android.enableShrinkResourcesInReleaseBuilds', 'false');
    }
    return mod;
  });
}

module.exports = function withWorkManagerKeep(config) {
  return withShrinkerOffForInternalBuilds(withKeepRules(config));
};
