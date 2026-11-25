import { requireOptionalNativeModule } from "expo-modules-core";
import { apiRequest, API_BASE_URL } from "@/api";

/**
 * Puts dosya.dev in the iOS Files app (targets/files-provider) and in the
 * Android system file picker (modules/dosya-files-provider/android). Both
 * native sides expose the same module, so nothing here checks the platform.
 *
 * The iOS extension is its own process, and the Android provider serves other
 * apps while this runtime may be down or refreshing; neither can share the
 * app's session: both would rotate the same refresh token, the server keeps
 * only one generation of grace, and whichever lost the race would sign the
 * user out. So the app mints the native side a LINKED session - a second
 * mobile session row, revoked with this one - and hands it over (App Group
 * keychain on iOS, Keystore-encrypted preferences on Android). JS never reads
 * that entry back; it only asks whose it is.
 *
 * Every entry point is best-effort. Files access is a convenience, and nothing
 * here may block sign-in, sign-out, or the purge that runs between accounts.
 */
export interface FilesProviderNative {
  isSupported(): boolean;
  storedUserId(): string | null;
  writeSession(json: string): void;
  clearSession(): void;
  registerDomain(): Promise<boolean>;
  removeDomain(): Promise<boolean>;
  signalChanges(): Promise<boolean>;
}

interface LinkedSessionBody {
  ok: true;
  access_token: string;
  refresh_token: string;
}

function nativeModule(override?: FilesProviderNative | null): FilesProviderNative | null {
  if (override !== undefined) return override;
  try {
    return requireOptionalNativeModule<FilesProviderNative>("DosyaFilesProvider");
  } catch {
    return null;
  }
}

// Link and unlink run strictly one after another. An account switch fires both
// at once - the purge of the old account and the link of the new one - and the
// purge's removeDomain landing after the link's registerDomain would leave the
// new account with no Files location until the next launch.
let queue: Promise<void> = Promise.resolve();
function serialized(op: () => Promise<void>): Promise<void> {
  const run = queue.then(op).catch((e) => {
    console.warn("[filesProvider]", e instanceof Error ? e.message : e);
  });
  queue = run;
  return run;
}

// A sign-in and the effect re-running on a profile refresh must not mint two
// linked sessions, the second of which revokes the first. A plain link joins
// whatever is pending for the account; a fresh re-mint joins only another
// fresh re-mint, since the pending plain link may be keeping a dead session.
let pendingLink: { userId: string; fresh: boolean; promise: Promise<void> } | null = null;

function link(userId: string, fresh: boolean, override?: FilesProviderNative | null): Promise<void> {
  if (pendingLink?.userId === userId && (!fresh || pendingLink.fresh)) return pendingLink.promise;
  const promise = serialized(async () => {
    const native = nativeModule(override);
    if (!native || !native.isSupported()) return;

    const stored = native.storedUserId();
    if (stored === userId && !fresh) {
      await native.registerDomain();
      await native.signalChanges();
      return;
    }

    // Another account's session (or its downloaded files) must never survive
    // into this one: drop the domain first, which also deletes its local copies.
    if (stored && stored !== userId) {
      native.clearSession();
      await native.removeDomain();
    }

    // Mint before overwriting: a failed mint leaves whatever was stored, which
    // is either nothing or this account's previous session.
    const res = await apiRequest<LinkedSessionBody>("/api/auth/mobile/linked-session", {
      method: "POST",
      body: { purpose: "files" },
    });
    native.writeSession(JSON.stringify({
      access: res.access_token,
      refresh: res.refresh_token,
      apiBaseUrl: API_BASE_URL,
      userId,
    }));
    await native.registerDomain();
  }).finally(() => {
    if (pendingLink?.promise === promise) pendingLink = null;
  });
  pendingLink = { userId, fresh, promise };
  return promise;
}

/**
 * Make sure the Files extension holds a session for `userId` and the location
 * is registered. Mints a new linked session only when none is stored or the
 * stored one belongs to another account. Runs on launch and on every return to
 * the foreground: the extension wipes its own entry once the server rejects
 * its refresh, and the next of these calls is what replaces it.
 */
export function linkFilesProvider(userId: string, override?: FilesProviderNative | null): Promise<void> {
  return link(userId, false, override);
}

/**
 * Fresh sign-in: mint a new linked session even if one is stored for this
 * account. The extension's session is a child of the app's session and the
 * server kills it with its parent, so a session stored across a forced
 * sign-out is dead, and a plain link would keep it and leave Files asking for
 * authentication until the user signed out by hand. The location and its
 * downloaded files are kept: they belong to this same account.
 */
export function relinkFilesProvider(userId: string, override?: FilesProviderNative | null): Promise<void> {
  return link(userId, true, override);
}

/**
 * Sign-out and account purge: forget the extension's session and remove the
 * location together with every file iOS downloaded for it. The server side of
 * the linked session is revoked by the app's own logout call.
 *
 * `accountId` is the account being purged. When the stored session already
 * belongs to someone else - the account that just signed in and linked first -
 * it is left alone. Null means "whoever it is".
 */
export function unlinkFilesProvider(accountId: string | null, override?: FilesProviderNative | null): Promise<void> {
  return serialized(async () => {
    const native = nativeModule(override);
    if (!native) return;
    const stored = native.storedUserId();
    if (accountId && stored && stored !== accountId) return;
    native.clearSession();
    await native.removeDomain();
  });
}

/** Nudge Files to pick up changes the app just made. */
export async function signalFilesProvider(override?: FilesProviderNative | null): Promise<void> {
  const native = nativeModule(override);
  if (!native || !native.isSupported()) return;
  try {
    await native.signalChanges();
  } catch {
    /* best-effort */
  }
}

/** Test hook. */
export function __resetFilesProviderLink(): void {
  queue = Promise.resolve();
  pendingLink = null;
}
