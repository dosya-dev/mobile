// Learn more: https://docs.expo.dev/guides/customizing-metro/
// getSentryExpoConfig is Expo's getDefaultConfig plus the Sentry serializer
// hook that stamps each bundle with the debug id its uploaded source map
// carries (src/telemetry/sentry.ts). Everything else about the config is
// unchanged from the plain Expo default.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

const config = getSentryExpoConfig(__dirname);

// Keep colocated *.test.tsx / *.spec.tsx files out of the app bundle so
// expo-router's file-based routing (which globs every .tsx under app/) doesn't
// treat them as routes. Jest is unaffected - it uses its own config.
const existing = config.resolver.blockList;
const existingList = Array.isArray(existing) ? existing : existing ? [existing] : [];
config.resolver.blockList = [...existingList, /\.(test|spec)\.[jt]sx?$/];

// Vault: the e2ee packages are vendored (scripts/vendor-e2ee.mjs) and resolved
// by package name from the vendor directories; see metro.vault-resolver.js
// for the `crypto` builtin the bundle references but never uses.
const path = require("path");
const { resolveVaultRequest } = require("./metro.vault-resolver");
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@dosya-dev/e2ee-core": path.resolve(__dirname, "vendor/e2ee-core"),
  "@dosya-dev/e2ee-client": path.resolve(__dirname, "vendor/e2ee-client"),
  // On-device Personas (vendored by the same script); it imports e2ee-core,
  // which resolves to the vendored core above.
  "@dosya-dev/personas-engine": path.resolve(__dirname, "vendor/personas-engine"),
};
config.resolver.resolveRequest = resolveVaultRequest(config.resolver.resolveRequest);

module.exports = withNativeWind(config, { input: "./global.css" });
