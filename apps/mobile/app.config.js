// Dynamic Expo config layered over app.json. APP_VARIANT (set per EAS build profile) picks the
// store identity: development and preview builds keep the existing "<id>.dev" identifiers so they
// install next to nothing else; production uses the clean identifiers that the store listings
// will reserve. Change the production identifiers here BEFORE the first store build; they cannot
// be changed after the apps are created in the stores.
const IDENTIFIERS = {
  development: 'com.gameverse.app.dev',
  preview: 'com.gameverse.app.dev',
  production: 'com.gameverse.app',
};
const NAMES = {
  development: 'GameVerse (dev)',
  preview: 'GameVerse (preview)',
  production: 'GameVerse',
};

module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT ?? 'development';
  const id = IDENTIFIERS[variant];
  if (!id) throw new Error(`Unknown APP_VARIANT "${variant}"`);
  return {
    ...config,
    name: NAMES[variant],
    ios: { ...config.ios, bundleIdentifier: id },
    android: { ...config.android, package: id },
  };
};
