// Sign-out: remove the user's personas key (secure store, personas_key_v2_<userId> and the old personas_key_<userId>)
// and sealed snapshots (personas_cache rows) from this device. Kept apart from
// ports so the purge path loads the ports only when it runs.
import type { KeyStore, LocalCache } from "@dosya-dev/personas-engine";

const WIPE_TIMEOUT_MS = 3000;

/**
 * Best effort and never throws: storage that is missing, locked or slow must
 * not stop a sign-out. Gives up after three seconds.
 */
export async function wipePersonasDevice(
  userId: string | null,
  stores?: { keys: KeyStore; cache: LocalCache },
): Promise<void> {
  if (!userId) return;
  const work = (async () => {
    let s = stores;
    if (!s) {
      // Lazily: the ports pull in sqlite and the secure store.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ports = require("./ports") as typeof import("./ports");
      s = { keys: ports.secureKeyStore(), cache: ports.sqliteLocalCache() };
    }
    await Promise.allSettled([s.keys.clear(userId), s.cache.clear(userId)]);
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, WIPE_TIMEOUT_MS);
  });
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Turn off and delete" just succeeded in one workspace: if this device holds
 * no snapshot for any other workspace of the user, remove the cached key too
 * (the server key stays; the next turn-on asks for the Vault once). Never throws.
 */
export async function clearKeyIfLastWorkspace(
  userId: string | null,
  deps?: { hasSnapshots: (userId: string) => Promise<boolean>; keys: KeyStore },
): Promise<void> {
  if (!userId) return;
  try {
    let d = deps;
    if (!d) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ports = require("./ports") as typeof import("./ports");
      d = { hasSnapshots: (u) => ports.sqliteHasSnapshots(undefined, u), keys: ports.secureKeyStore() };
    }
    if (!(await d.hasSnapshots(userId))) await d.keys.clear(userId);
  } catch {
    // best effort
  }
}
