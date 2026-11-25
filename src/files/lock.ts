import { getAccessToken } from "@/auth/authStore";
import { fileRawUrl } from "./fileUrl";

/**
 * The three lock modes, and what each one actually permits. This mirrors the
 * web lock modal (apps/web/src/components/lock-modal.tsx), which is where the
 * product meaning is set:
 *
 *   none       preview yes   download yes
 *   view_only  preview YES   download no
 *   full_lock  both, but only after a password unlock hands back a token
 *
 * Mobile used to collapse these to `lock_mode !== "none"` and gate all three
 * the same way, which left a view-only file showing a permanent "Locked"
 * panel with no way past it - strictly worse than full_lock, which at least
 * offered an Unlock button. Every lock decision goes through this module now
 * so the three modes cannot drift apart again.
 */
export interface LockedFile {
  id: string;
  lock_mode: string;
  current_version: number;
}

/**
 * Whether the file is KNOWN to be restricted - the question the lock badge asks.
 *
 * Deliberately not `lock_mode !== "none"`. Some list endpoints historically did
 * not select the column, so the client substitutes "unknown" rather than
 * guessing "none" (guessing unrestricted is how view-only bytes reached a disk
 * cache). But an unknown mode must not paint a padlock on every row either, so
 * the two questions fail in opposite directions on purpose:
 *
 *   may I persist these bytes?   unknown -> NO   (cachePolicy.mayPersistBytes)
 *   should I show a padlock?     unknown -> no   (here)
 *
 * Both stay quiet and safe when the server did not say.
 */
export function isKnownLocked(file: Pick<LockedFile, "lock_mode">): boolean {
  return file.lock_mode === "view_only" || file.lock_mode === "full_lock";
}

export function isViewOnly(file: Pick<LockedFile, "lock_mode">): boolean {
  return file.lock_mode === "view_only";
}

export function isFullLock(file: Pick<LockedFile, "lock_mode">): boolean {
  return file.lock_mode === "full_lock";
}

/**
 * Whether the file is still behind its password gate. ONLY full_lock can be
 * in this state - view_only has no password and no unlock affordance, because
 * there is nothing to unlock to: it is readable already, and it is never
 * downloadable.
 */
export function needsUnlock(file: Pick<LockedFile, "lock_mode">, unlockToken: string | null | undefined): boolean {
  return isFullLock(file) && !unlockToken;
}

/**
 * Whether to offer download / share / export at all. The server refuses a
 * view-only download regardless (download-url returns 403), so showing the
 * button would only produce an error the user can do nothing about.
 */
export function canDownload(file: Pick<LockedFile, "lock_mode">): boolean {
  return !isViewOnly(file);
}

/**
 * Where a preview surface should read its bytes from.
 *
 * view_only cannot use a presigned URL at all: `/api/files/:id/download-url`
 * rejects it outright before it ever presigns. `/api/files/:id/raw` gates only
 * full_lock and streams view-only bytes happily - it is what web previews
 * through - but it is an authenticated API route rather than a presigned one,
 * so the caller must carry the bearer header. Returning the headers alongside
 * the uri keeps that coupling in one place; every consumer (Image, expo-video,
 * fetch, WebView) accepts a headers field.
 *
 * Returns null for a file still behind its password gate, and for the normal
 * case where the caller should presign instead.
 */
export function viewOnlySource(
  file: Pick<LockedFile, "id" | "lock_mode" | "current_version">,
): { uri: string; headers: Record<string, string> } | null {
  if (!isViewOnly(file)) return null;
  const token = getAccessToken();
  return {
    uri: fileRawUrl(file.id, file.current_version),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}
