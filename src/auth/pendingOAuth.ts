import * as SecureStore from "expo-secure-store";
import type { PkcePair } from "./pkce";

/**
 * The in-flight sign-in's verifier and nonce, held from the moment the browser
 * opens until the code comes back.
 *
 * Kept in memory AND on disk, because the two delivery paths have different
 * lifetimes. `openAuthSessionAsync` resolves in the same JS context that
 * started the flow, so memory alone would do. But on Android the redirect is
 * frequently handed to MainActivity as an ordinary deep link instead (see
 * app/auth/callback.tsx), and if the OS relaunched the app to deliver it, the
 * module scope that held the verifier is gone - the exchange would then fail
 * for a sign-in that actually succeeded.
 *
 * Memory is consulted first so the common path costs no disk read; the disk
 * copy exists purely for the cold-start case.
 *
 * SecureStore rather than AsyncStorage: the verifier is a credential for the
 * duration of the handshake, and this file's neighbours already treat that
 * class of value as keychain material. `AFTER_FIRST_UNLOCK` matches tokenStore,
 * for the same reason - a locked device must not turn into a failed sign-in.
 */
const PENDING_KEY = "dosya.oauth.pending";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * How long a started flow stays redeemable. Comfortably longer than the
 * server's 120-second code TTL, so the code always expires first and this is
 * never the thing that explains a failure - it only stops an abandoned
 * verifier lingering on disk indefinitely.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingRecord {
  verifier: string;
  nonce: string;
  startedAt: number;
}

let inMemory: PendingRecord | null = null;

export async function savePendingOAuth(pair: PkcePair, now: number = Date.now()): Promise<void> {
  const record: PendingRecord = { verifier: pair.verifier, nonce: pair.nonce, startedAt: now };
  inMemory = record;
  try {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(record), OPTIONS);
  } catch {
    // Disk is a fallback for the cold-start path only. Losing it costs nothing
    // on the common path, and failing the sign-in over it would be worse.
  }
}

/** Read without consuming - the caller decides whether the reply is acceptable. */
export async function loadPendingOAuth(now: number = Date.now()): Promise<PendingRecord | null> {
  const record = inMemory ?? (await readDisk());
  if (!record) return null;
  if (now - record.startedAt > PENDING_TTL_MS) {
    await clearPendingOAuth();
    return null;
  }
  return record;
}

async function readDisk(): Promise<PendingRecord | null> {
  let raw: string | null = null;
  try {
    raw = await SecureStore.getItemAsync(PENDING_KEY, OPTIONS);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingRecord>;
    if (!parsed.verifier || !parsed.nonce || typeof parsed.startedAt !== "number") return null;
    return { verifier: parsed.verifier, nonce: parsed.nonce, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

export async function clearPendingOAuth(): Promise<void> {
  inMemory = null;
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    /* nothing to do - the TTL above bounds it anyway */
  }
}
