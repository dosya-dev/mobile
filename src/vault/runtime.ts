import { createMinimalSubtle, setCryptoBackend } from "@dosya-dev/e2ee-core";
import { installSubtleGlobal } from "./cryptoGlobal";
import { createMobileBackend } from "./backend";

/**
 * Everything the e2ee packages need before their first call on this phone:
 * the `crypto.subtle` shim for HPKE's HKDF and the native `CryptoBackend`.
 * Called by every Vault entry point (store, diagnostics) before touching the
 * engine; runs once per process. A failed attempt (say, the native module is
 * absent in Expo Go) is not cached - the next call tries again, so a
 * transient error cannot brick the Vault until restart.
 *
 * This module is the FIRST importer of the 3 MB e2ee bundle; keep it out of
 * anything that runs at boot.
 */
let inFlight: Promise<void> | null = null;
let lockStarted = false;

export function ensureVaultRuntime(): Promise<void> {
  if (!inFlight) {
    inFlight = (async () => {
      installSubtleGlobal(createMinimalSubtle());
      setCryptoBackend(await createMobileBackend());
      if (!lockStarted) {
        // Lazy, and only after the runtime is ready: store.ts's module-level
        // createVaultEngine() call imports this module back (the engine calls
        // ensureVaultRuntime on every operation), so a top-level import here
        // would be a cycle.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("./store") as typeof import("./store")).startVaultBackgroundLock();
        // Set only once the call above actually returned: if requiring the
        // store or starting the listener throws, the next successful
        // ensureVaultRuntime() must retry starting the lock, not skip it forever.
        lockStarted = true;
      }
    })().catch((err) => {
      inFlight = null;
      throw err;
    });
  }
  return inFlight;
}

export function __resetVaultRuntimeForTests(): void {
  inFlight = null;
}
