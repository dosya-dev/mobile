import * as SecureStore from "expo-secure-store";

/**
 * The pair, as ONE entry. It used to be two (`dosya.access` + `dosya.refresh`),
 * which meant a save was two independent writes: a process killed between them
 * - routine for an app backgrounded mid-backup - left disk holding the new
 * access token beside the OLD refresh token. That mix reads back as a valid
 * session, but its refresh token is a generation behind, and the server's
 * prev-token grace is only one generation deep, so the next rotation past it
 * earns a 401 and the app signs the user out.
 */
const TOKENS_KEY = "dosya.tokens";

// The pre-single-key layout. Read (and migrated) for installs that predate it,
// and still cleared on sign-out so nothing survives to be resurrected.
const LEGACY_ACCESS_KEY = "dosya.access";
const LEGACY_REFRESH_KEY = "dosya.refresh";

// Last known profile, kept beside the tokens so a start with no connectivity
// can come up signed in with a name to show instead of a blank account card.
const USER_KEY = "dosya.user";

/**
 * iOS keychain items default to `WHEN_UNLOCKED`, which makes them unreadable
 * while the device is locked - which is exactly when a background backup runs.
 * A read that comes back empty there is indistinguishable from having no
 * session at all, and the app treated it as a sign-out. `AFTER_FIRST_UNLOCK`
 * keeps the entry readable from the device's first unlock after boot onward,
 * which is the accessibility class background work actually needs.
 *
 * No effect on Android, which has no equivalent lock state for these entries.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export interface Tokens {
  access: string;
  refresh: string;
}

/** One write, so the stored pair is always internally consistent. */
export async function saveTokens(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify({ access: t.access, refresh: t.refresh }), OPTIONS);
}

export async function loadTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Tokens>;
      if (parsed.access && parsed.refresh) return { access: parsed.access, refresh: parsed.refresh };
    } catch {
      /* corrupt entry - fall through to the legacy pair, then to null */
    }
  }

  const access = await SecureStore.getItemAsync(LEGACY_ACCESS_KEY);
  const refresh = await SecureStore.getItemAsync(LEGACY_REFRESH_KEY);
  if (!access || !refresh) return null;

  // Upgrade in place. Best-effort: a failed migration must still hand back the
  // session it just read, or updating the app would sign the user out.
  const tokens: Tokens = { access, refresh };
  try {
    await saveTokens(tokens);
    await SecureStore.deleteItemAsync(LEGACY_ACCESS_KEY);
    await SecureStore.deleteItemAsync(LEGACY_REFRESH_KEY);
  } catch {
    /* keep using the legacy entries until a later save succeeds */
  }
  return tokens;
}

export async function saveUser(user: unknown): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), OPTIONS);
}

export async function loadUser<T>(): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // corrupt entry - the profile refetches on the next request
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKENS_KEY);
  await SecureStore.deleteItemAsync(LEGACY_ACCESS_KEY);
  await SecureStore.deleteItemAsync(LEGACY_REFRESH_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}
