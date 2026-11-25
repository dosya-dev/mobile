import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@dosya-dev/e2ee-core";
import * as client from "@dosya-dev/e2ee-client";

const mobileRoot = join(__dirname, "..", "..");
const monorepoDist = join(mobileRoot, "..", "..", "packages");
const hasMonorepo = existsSync(join(monorepoDist, "e2ee-core", "dist", "index.js"));

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("vendored e2ee bundles", () => {
  it("resolve by package name and expose the phase 1 API", () => {
    expect(typeof core.setCryptoBackend).toBe("function");
    expect(typeof core.runBackendSelfTest).toBe("function");
    expect(typeof core.createMinimalSubtle).toBe("function");
    expect(typeof core.encryptFileStreaming).toBe("function");
    expect(Array.isArray(core.CHUNKER_VECTORS)).toBe(true);
    expect(typeof client.uploadFileStreaming).toBe("function");
    expect(typeof client.downloadFileTo).toBe("function");
    expect((core as Record<string, unknown>).getSodium).toBeUndefined();
  });

  it("carry a package.json so Metro, jest and tsc resolve the directory the same way", () => {
    for (const name of ["e2ee-core", "e2ee-client", "personas-engine"]) {
      const pkg = JSON.parse(readFileSync(join(mobileRoot, "vendor", name, "package.json"), "utf8"));
      expect(pkg).toEqual({ name: `@dosya-dev/${name}`, private: true, main: "index.js", types: "index.d.ts" });
    }
  });

  // The bug this pins cost a whole device gate. e2ee-client used to be bundled
  // WITHOUT `--external:@dosya-dev/e2ee-core`, so it carried its own private
  // copy of the core - and of the core's default JS libsodium. The app called
  // `setCryptoBackend` on the core it imports directly, which left every
  // client call (setup, unlock, upload) running on the OTHER copy: the default
  // backend, which needs WebAssembly that Hermes does not have. On a phone the
  // first unlock burned minutes of CPU decoding an embedded wasm blob and then
  // never settled, while the diagnostics screen - which talks to the core
  // directly - reported the native backend and a healthy 350 ms Argon2.
  // One core instance means one backend registry.
  it("do not carry a second copy of the core: the client imports it", () => {
    const clientBundle = readFileSync(join(mobileRoot, "vendor", "e2ee-client", "index.js"), "utf8");
    expect(clientBundle).toMatch(/from\s*"@dosya-dev\/e2ee-core"/);
    // Symbols that only the core (and the JS libsodium it lazily loads) define.
    for (const inlined of ["crypto_pwhash", "libsodium-wrappers-sumo", "setCryptoBackend", "CHUNKER_VECTORS"]) {
      expect(clientBundle).not.toContain(inlined);
    }
  });

  // On-device Personas seals with the same core: the engine bundle must import
  // it, never carry its own copy (and its own backend registry).
  it("the Personas engine imports the core instead of carrying it", () => {
    const engineBundle = readFileSync(join(mobileRoot, "vendor", "personas-engine", "index.js"), "utf8");
    expect(engineBundle).toMatch(/from\s*"@dosya-dev\/e2ee-core"/);
    for (const inlined of ["crypto_pwhash", "libsodium-wrappers-sumo", "setCryptoBackend"]) {
      expect(engineBundle).not.toContain(inlined);
    }
  });

  // The static check above reads the bundle; this one proves the consequence.
  // `ensureVaultRuntime` installs the native backend through the core, so a
  // backend registered there MUST be the one a client call reaches. It runs
  // last because it leaves a sentinel backend installed for this file.
  it("share one backend registry: a backend set through the core is what the client calls", async () => {
    const seen: string[] = [];
    // Built from nothing, not spread from the real backend: reading the
    // current one would load the default and the registry rightly refuses a
    // swap after first use.
    core.setCryptoBackend({
      name: "sentinel",
      argon2Tiers: {
        interactive: { opslimit: 2, memlimit: 64 * 1024 * 1024 },
        moderate: { opslimit: 3, memlimit: 256 * 1024 * 1024 },
        sensitive: { opslimit: 4, memlimit: 1024 * 1024 * 1024 },
      },
      pwhash: async () => {
        seen.push("pwhash");
        throw new Error("sentinel backend reached");
      },
    } as unknown as Parameters<typeof core.setCryptoBackend>[0]);

    const api = {
      getUserKeys: async () => ({
        x25519Pub: "00",
        ed25519Pub: "00",
        wrappedPriv: "AA==",
        recoveryWrapped: "AA==",
        argonSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
        argonParams: JSON.stringify({ tier: "interactive" }),
      }),
    } as unknown as Parameters<typeof client.unlockWithRecoveryKey>[0];

    // The engine reports every unlock failure with one generic message, so the
    // sentinel's own error is swallowed by design; that it ran at all is the point.
    await expect(client.unlockWithRecoveryKey(api, "00".repeat(32))).rejects.toThrow("e2ee: unlock failed");
    expect(seen).toContain("pwhash");
  });

  (hasMonorepo ? it : it.skip)("are byte-identical to the monorepo dists (re-run scripts/vendor-e2ee.mjs when this fails)", () => {
    for (const name of ["e2ee-core", "e2ee-client", "personas-engine"]) {
      // personas-engine's dist is not committed, so a fresh checkout (CI) has
      // nothing to compare until the package is built.
      if (!existsSync(join(monorepoDist, name, "dist", "index.js"))) continue;
      expect(sha(join(mobileRoot, "vendor", name, "index.js"))).toBe(sha(join(monorepoDist, name, "dist", "index.js")));
      expect(sha(join(mobileRoot, "vendor", name, "index.d.ts"))).toBe(sha(join(monorepoDist, name, "dist", "index.d.ts")));
    }
  });
});
