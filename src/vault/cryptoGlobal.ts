import { getRandomValues, randomUUID } from "expo-crypto";

/**
 * The `globalThis.crypto` the Vault's libraries expect, on a runtime that has
 * none (Hermes). Two halves, installed at different times on purpose:
 *
 * - `installRandomGlobals` runs at app boot (first import in index.js). It
 *   costs only expo-crypto, so the 3 MB e2ee bundle is never evaluated for a
 *   user who never opens the Vault. e2ee-client calls `crypto.randomUUID()`
 *   and the HPKE/VOPRF libraries call `crypto.getRandomValues`.
 * - `installSubtleGlobal` runs when the Vault runtime starts
 *   (src/vault/runtime.ts) with e2ee-core's `createMinimalSubtle()`, the four
 *   WebCrypto operations HPKE's HKDF needs. A real `subtle` (Node, browsers,
 *   Electron) is never replaced.
 *
 * `target` exists for tests; production always polyfills `globalThis`.
 */
type CryptoSlot = { getRandomValues?: unknown; randomUUID?: unknown; subtle?: unknown };

function slot(target: typeof globalThis): CryptoSlot {
  const g = target as unknown as { crypto?: CryptoSlot };
  if (!g.crypto) g.crypto = {};
  return g.crypto;
}

export function installRandomGlobals(target: typeof globalThis = globalThis): void {
  const c = slot(target);
  if (typeof c.getRandomValues !== "function") {
    c.getRandomValues = <T extends ArrayBufferView>(array: T): T => getRandomValues(array as unknown as Uint8Array) as unknown as T;
  }
  if (typeof c.randomUUID !== "function") {
    c.randomUUID = () => randomUUID();
  }
}

export function installSubtleGlobal(subtle: unknown, target: typeof globalThis = globalThis): void {
  const c = slot(target);
  if (!c.subtle) c.subtle = subtle;
}

installRandomGlobals();
