// Regenerate .expo/types/router.d.ts (expo-router typed routes) without a dev server.
//
// Why this exists: this app colocates tests next to routes (app/foo.test.tsx).
// Metro excludes them from the bundle via resolver.blockList (metro.config.js),
// but expo's typegen scans the filesystem directly and does NOT honor that
// blockList - app/_layout.test.tsx wins the root-layout lookup, getRoutes
// returns a tree the generator can't group, and it silently writes an empty
// stub. Result: every internal route string fails `tsc --noEmit` with
// "not assignable to ExternalPathString".
//
// Run after adding/removing/renaming any file under app/:
//   node scripts/generate-route-types.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.env.EXPO_ROUTER_APP_ROOT = join(root, "app");

const ponyfill = require("expo-router/build/testing-library/require-context-ponyfill").default;
const { EXPO_ROUTER_CTX_IGNORE } = require("expo-router/_ctx-shared");
const { getTypedRoutesDeclarationFile } = require("expo-router/build/typed-routes/generate");

const ctx = ponyfill(process.env.EXPO_ROUTER_APP_ROOT, true, EXPO_ROUTER_CTX_IGNORE);

// Mirror metro.config.js resolver.blockList: colocated tests are not routes.
const TEST_RE = /\.(test|spec)\.[jt]sx?$/;
const keys = ctx.keys().filter((k) => !TEST_RE.test(k));
const filtered = (key) => ctx(key);
filtered.keys = () => keys;
filtered.resolve = (k) => ctx.resolve(k);
filtered.id = ctx.id;

const file = getTypedRoutesDeclarationFile(filtered, {});
if (!file.includes("Router.SingleRoutePart") && !file.includes("pathname:")) {
  console.error("Generated file looks like the empty stub - route grouping failed. Not writing.");
  process.exit(1);
}
const out = join(root, ".expo/types/router.d.ts");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, file);
console.log(`router.d.ts regenerated: ${file.length} bytes from ${keys.length} route files`);
