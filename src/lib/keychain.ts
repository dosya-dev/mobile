import * as SecureStore from "expo-secure-store";

/**
 * The keychain for entries the app reads or writes while the phone is LOCKED.
 *
 * `expo-secure-store` stores everything as `WHEN_UNLOCKED` unless told
 * otherwise, and iOS refuses to read a `WHEN_UNLOCKED` item while the device is
 * locked ("User interaction is not allowed", errSecInteractionNotAllowed). A
 * backup runs precisely then: the phone sits locked on a charger while the
 * background session finishes a long upload, the job-finished event wakes the
 * JS side, and the first keychain read on that path throws. The tokens had the
 * same bug and were fixed with `AFTER_FIRST_UNLOCK`; this is the same fix for
 * everything else the backup path touches - settings, the last-run stamp, the
 * watermarks, the persisted block, the widget stats, the workspace choice.
 *
 * Why a separate keychain SERVICE and not just the accessibility option: the
 * native module updates an existing item with `SecItemUpdate` carrying only the
 * new value, so an entry created as `WHEN_UNLOCKED` keeps that class for ever
 * no matter what later writes ask for. Only a fresh `SecItemAdd` sets it. A
 * service of our own is a namespace where every entry is created fresh, with
 * the class we want; the old entry stays under the default service ("app"),
 * where `getItem` finds it once, copies it across, and then deletes it. Copy
 * before delete, so a kill in between loses nothing.
 *
 * Android has no lock class for these entries and honours `keychainService` as
 * a plain key prefix, so the same migration runs there, harmlessly.
 *
 * Not for the tokens (`auth/tokenStore.ts` has its own single-entry history)
 * and not for foreground-only preferences, which are fine where they are.
 */
const SERVICE = "dosya.locked";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  keychainService: SERVICE,
};

// The entry as builds before this wrapper stored it: default service, default
// (WHEN_UNLOCKED) accessibility. Read for migration, deleted after it.
const LEGACY_OPTIONS: SecureStore.SecureStoreOptions = {};

export async function getItem(key: string): Promise<string | null> {
  const current = await SecureStore.getItemAsync(key, OPTIONS);
  if (current !== null) return current;

  // Nothing under our service: either never written, or written by an older
  // build. This read throws while the phone is locked, exactly as every read
  // did before - but only until the first read that happens unlocked, which
  // moves the entry.
  const legacy = await SecureStore.getItemAsync(key, LEGACY_OPTIONS);
  if (legacy === null) return null;
  try {
    await SecureStore.setItemAsync(key, legacy, OPTIONS);
    await SecureStore.deleteItemAsync(key, LEGACY_OPTIONS);
  } catch {
    /* the value is in hand either way; the move is retried by the next read */
  }
  return legacy;
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

/** Removes the entry under both services, so no legacy copy resurfaces. */
export async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS);
  await SecureStore.deleteItemAsync(key, LEGACY_OPTIONS);
}
