module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest-setup.ts"],
  // The gate's 2-core runner runs this suite in one process; screens that take
  // 2-3 s locally went past the 5 s default there. A hang still fails.
  testTimeout: 20_000,
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|native-base|react-native-svg|lucide-react-native|nativewind|react-native-css-interop|@dosya-dev/shared))",
  ],
  // global.css is Tailwind source, not JS - Metro/nativewind handle it at
  // bundle time via Metro's CSS support. Jest can't parse raw CSS, so stub
  // it out for any module (e.g. app/_layout.tsx) that imports it directly.
  moduleNameMapper: {
    "\\.css$": "<rootDir>/__mocks__/styleMock.js",
    // The vendored e2ee bundles, exactly what ships. The first run transforms
    // ~3 MB of ESM through babel (about 50 s); jest caches it afterwards.
    "^@dosya-dev/e2ee-core$": "<rootDir>/vendor/e2ee-core/index.js",
    "^@dosya-dev/e2ee-client$": "<rootDir>/vendor/e2ee-client/index.js",
    "^@dosya-dev/personas-engine$": "<rootDir>/vendor/personas-engine/index.js",
    // lucide-react-native's "react-native" export condition points at an .mjs
    // bundle. Metro reads it fine; jest resolves the same condition but will
    // not transform .mjs, so it hits `export` as a syntax error. Point jest at
    // the package's own CJS build instead - same icons, same version, and it
    // changes nothing about what ships.
    "^lucide-react-native$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js",
  },
  // Several modules ship a __mocks__/index.ts; jest-haste-map warns about the
  // duplicate name. Keep only the vault-chunker one in the haste map: a
  // jest.mock("<module dir>") still finds the others' mocks next to their module.
  modulePathIgnorePatterns: [
    "<rootDir>/modules/dosya-face-reader/__mocks__/",
    "<rootDir>/modules/dosya-personas-background/__mocks__/",
    "<rootDir>/modules/dosya-document-scanner/__mocks__/",
  ],
  collectCoverage: false,
  coverageReporters: ["text-summary", "lcov"],
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "src/**/*.{ts,tsx}",
    "!**/*.test.{ts,tsx}",
    "!**/__mocks__/**",
    "!**/node_modules/**",
  ],
};
