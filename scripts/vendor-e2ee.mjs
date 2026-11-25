#!/usr/bin/env node
// Vendor the bundled e2ee package dists INTO apps/mobile so the app is
// self-contained, exactly as apps/web and apps/desktop do (see
// apps/web/scripts/vendor-e2ee.mjs for the full rationale). Each vendored
// directory also gets a minimal package.json so Metro
// (resolver.extraNodeModules), jest (moduleNameMapper) and tsc (paths) all
// resolve "@dosya-dev/e2ee-*" to the same index.js / index.d.ts.
//
// On-device Personas rides along: packages/personas-engine/dist ->
// vendor/personas-engine, the engine as one ESM bundle plus .d.ts. Its
// @dosya-dev/e2ee-core import stays EXTERNAL, so it resolves to
// vendor/e2ee-core above and shares the app's react-native-libsodium backend.
// The face reader is not vendored here: Hermes cannot run WebAssembly, so the
// phone reads faces in a hidden WebView that loads the web app's
// personas-reader.html (src/personas/device/ReaderHost.tsx).
//
// MONOREPO-ONLY: reads ../../packages/*/dist. Re-run whenever the packages
// change, then commit vendor/. src/vault/vendor.test.ts fails when the copy
// is stale and the monorepo sibling is present.
import { cpSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const packages = ["e2ee-core", "e2ee-client", "personas-engine"];

for (const name of packages) {
  const src = resolve(mobileRoot, "../../packages", name, "dist");
  if (!existsSync(resolve(src, "index.js"))) {
    console.error(`✖ missing ${src}/index.js - build the package first: (cd packages/${name} && npm run build)`);
    process.exit(1);
  }
  const dest = resolve(mobileRoot, "vendor", name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(
    resolve(dest, "package.json"),
    JSON.stringify({ name: `@dosya-dev/${name}`, private: true, main: "index.js", types: "index.d.ts" }, null, 2) + "\n",
  );
  console.log(`✓ vendored ${name} -> apps/mobile/vendor/${name}`);
}
