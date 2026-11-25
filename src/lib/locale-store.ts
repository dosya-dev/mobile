import { isLocale, type Locale } from "@/i18n/locales";
import { getItem, setItem } from "@/lib/keychain";

/**
 * The device-local home of the language choice. Not synced to the account.
 *
 * It lives in the locked-readable keychain (src/lib/keychain.ts) and not in
 * AsyncStorage on purpose: the background backup task reads it while the phone
 * is locked, so its notifications come out in the chosen language.
 */
export const LOCALE_STORAGE_KEY = "dosya.locale";

/** "device" follows the phone's language; otherwise one shipped language. */
export type LocalePreference = "device" | Locale;

/** How long a keychain read may take before the app starts on the device language. */
export const LOCALE_READ_TIMEOUT_MS = 1500;

/**
 * The stored choice. Anything missing, unknown (a language that is no longer
 * shipped, a stray value), unreadable, or not answered within 1.5 s is
 * "device": the boot gate must never hang on a locked or slow keychain.
 */
export async function readLocalePreference(): Promise<LocalePreference> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      getItem(LOCALE_STORAGE_KEY),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCALE_READ_TIMEOUT_MS);
      }),
    ]);
    return raw === "device" || isLocale(raw) ? raw : "device";
  } catch {
    return "device";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Remembers the choice. A failed write only means it lasts until the app closes. */
export async function writeLocalePreference(preference: LocalePreference): Promise<void> {
  try {
    await setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    /* keychain unavailable: the choice applies for this run only */
  }
}
