import { useSyncExternalStore } from "react";
import { getItem } from "@/lib/keychain";

/**
 * What the workspace menu is allowed to know about the Vault.
 *
 * The menu row renders on the Files root, which is the first screen of the
 * app, and `@/vault/store` drags the 3 MB e2ee bundle in behind it. So the row
 * reads its two facts from HERE instead, and this module imports nothing
 * heavier than the keychain:
 *
 *  - locked or not: a plain boolean the store pushes in when it locks or
 *    unlocks. Before the store has ever loaded the answer is `true`, which is
 *    not a guess - the session lives in the engine's closure, so a Vault
 *    nobody has opened in this process IS locked.
 *  - how many Spaces: read straight from the keychain list the store
 *    persists, which is only ids and names (no key material, spec 8).
 */
export const VAULT_SPACES_KEY_PREFIX = "dosya.vault.workspaces.";

let locked = true;
const listeners = new Set<() => void>();

/** Called by the Vault store on every lock, unlock and purge. */
export function setVaultLocked(next: boolean): void {
  if (locked === next) return;
  locked = next;
  for (const listener of listeners) listener();
}

export function isVaultLocked(): boolean {
  return locked;
}

export function useVaultLocked(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => locked,
    () => locked,
  );
}

/**
 * What the rest of the app may know about a Vault transfer: how many, how
 * many broke, and how far along in bytes. No name, no Space, no id.
 *
 * The plus button's ring reports every transfer in the app, and its sheet is
 * reachable from the Files tab - outside the lock. A Vault file's NAME is
 * exactly what the Vault exists to hide, so it never crosses: this shape
 * carries numbers only, and the sheet can therefore say "2 files in your
 * Vault, 41%" and nothing more. The names live in the Vault's own screens,
 * behind the unlock, where they belong.
 *
 * Because the name is never passed, no later change to a row can leak one.
 * That is the point of drawing the boundary here rather than at render time.
 */
export type VaultActivity = {
  /** Live transfers, a broken one included - it still has something to say. */
  count: number;
  failed: number;
  /**
   * The same transfers split by direction, because the one line the sheet gets
   * has to say which way the bytes are going: encrypting on the way up reads
   * as a lie over a download. A direction is not a name.
   */
  uploads: number;
  downloads: number;
  /** Bytes moved and expected, so the ring can weight the Vault like anything else. */
  written: number;
  total: number;
};

export const NO_VAULT_ACTIVITY: VaultActivity = {
  count: 0,
  failed: 0,
  uploads: 0,
  downloads: 0,
  written: 0,
  total: 0,
};

let activity: VaultActivity = NO_VAULT_ACTIVITY;
const activityListeners = new Set<() => void>();

/** Called by the Vault store whenever its transfer list changes. */
export function setVaultActivity(next: VaultActivity): void {
  if (
    next.count === activity.count &&
    next.failed === activity.failed &&
    next.uploads === activity.uploads &&
    next.downloads === activity.downloads &&
    next.written === activity.written &&
    next.total === activity.total
  ) {
    return;
  }
  activity = next;
  for (const listener of activityListeners) listener();
}

export function getVaultActivity(): VaultActivity {
  return activity;
}

export function useVaultActivity(): VaultActivity {
  return useSyncExternalStore(
    (onChange) => {
      activityListeners.add(onChange);
      return () => {
        activityListeners.delete(onChange);
      };
    },
    () => activity,
    () => activity,
  );
}

/**
 * How many Spaces this account has on this phone, straight from the persisted
 * list. A missing, unreadable or foreign-shaped value reads as none, exactly
 * as the store's own hydrate does - the menu shows the plain subtitle then.
 */
export async function countKnownSpaces(accountId: string): Promise<number> {
  try {
    const raw = await getItem(VAULT_SPACES_KEY_PREFIX + accountId);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
