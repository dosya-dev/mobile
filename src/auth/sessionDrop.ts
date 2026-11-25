import type { SessionDrop } from "./authStore";

/**
 * Whether a transition to signedOut should destroy this account's local data.
 *
 * Only when we KNOW the account is gone. Reaching signedOut does not prove it:
 * hydrate() also lands there when it could not read the token store at all - a
 * locked iOS keychain during a background launch - and in that case the 60-day
 * session is still on disk, untouched and live. Purging there clears the backup
 * ledger and resets backup settings for a session that comes straight back,
 * which is the "it logged me out and my backup started over" report.
 *
 * Unrecognised reasons deliberately return false: a reason added later has to
 * opt IN to destroying account data rather than inherit a purge nobody
 * considered. The cost of not purging is stale local state, which the
 * account-switch purge at sign-in then clears (see takeAccountSwitch); the cost
 * of purging wrongly is the user's backup progress.
 *
 * Lives apart from ./purge deliberately: that module pulls in the ledger,
 * SQLite, image caches and every account-scoped store, and this decision has to
 * stay importable by anything that needs it - including tests - without
 * dragging all of that in. The type import above is erased at compile time, so
 * this module has no runtime dependencies at all.
 */
export function shouldPurgeOnSignOut(drop: SessionDrop | null): boolean {
  if (!drop) return false;
  switch (drop.reason) {
    case "explicit-sign-out":
    case "server-rejected-refresh":
      return true;
    default:
      return false;
  }
}
