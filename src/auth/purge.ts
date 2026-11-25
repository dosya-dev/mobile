import { Image as ExpoImage } from "expo-image";
import { queryClient } from "@/lib/queryClient";
import { clearPersistedQueryCache } from "@/lib/queryPersist";
import { clearCachedFileBytes } from "@/files/fileCache";
import { clearOnboarding } from "@/onboarding/onboardingState";
import { stopAndClear } from "@/player/controller";
import { stopBackup } from "@/backup/orchestrator";
import { clearLedger } from "@/backup/ledger";
import { clearBackgroundUploads } from "@/backup/transport/backgroundTransport";
import { clearHistory } from "@/backup/history";
import { resetBackupSettings } from "@/backup/settings";
import { clearContactsBackupState } from "@/contacts/backupContacts";
import { resetBackupCompletionState } from "@/backup/completion";
import { clearBackupAlertReport } from "@/backup/alertReport";
import { clearWidgetLastStats, clearWidgetSnapshot } from "@/backup/statusBridge";
import { clearWatermarks } from "@/backup/watermark";
import { clearIncarHistory } from "@/incar/recents";
import { useUploadStore } from "@/upload/store";
import { clearPersistedUploads } from "@/upload/persist";
import { resetManualRunOverride } from "@/upload/pacing";
import { useUploadBlock } from "@/upload/uploadBlock";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { unlinkFilesProvider } from "@/filesProvider/link";
import { lastPersonasUser, teardownPersonas } from "@/personas/device/teardown";
import { wipePersonasDevice } from "@/personas/device/wipe";
import { resetReadSettings } from "@/personas/device/settings";
import { clearAppLock } from "./appLock";
import { currentSession, endSession } from "@/offline/session";
import { syncRegistration } from "@/offline/background";
import { closeOfflineDb } from "@/offline/db";
import { wipeAccount, wipeAllAccounts } from "@/offline/store";
import { useOfflineStore } from "@/offline/offlineStore";

/**
 * The offline half of a purge that has not finished yet, or null. The shell
 * waits on it before beginning the next account's offline session, so the
 * previous account's endSession never ends the session that replaced it.
 */
let offlinePurge: Promise<void> | null = null;

/**
 * How long one offline step may take before the purge moves on. endSession
 * fences the session and cancels every transfer synchronously, before its
 * first await, so a commit that is still running when the bound expires can
 * no longer write; what it waits for afterwards is only that commit. A stuck
 * database close or file delete must never hold back the rest of sign-out.
 */
let offlineStepMs = 10_000;
/** Test hook. */
export function __setOfflineStepBoundForTests(ms: number | null): void {
  offlineStepMs = ms ?? 10_000;
}

function bounded(work: unknown): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    Promise.resolve(work).then(() => undefined, () => undefined),
    new Promise<void>((r) => { timer = setTimeout(r, offlineStepMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

export function pendingOfflinePurge(): Promise<void> | null {
  return offlinePurge;
}

/**
 * Remove every trace of the signed-out account so the next sign-in starts
 * clean - cached workspaces/files, the active workspace, upload queue and
 * pause state, backup ledger/history/settings, contacts-backup state, the
 * in-car (CarPlay) Continue Listening / Recently Played history, this
 * account's onboarding progress, any in-progress audio playback, and every
 * file BYTE cached on disk (images, downloaded books, extracted artwork,
 * upload/backup staging), and the iOS Files app location with its downloaded
 * copies, and App lock (its PIN belongs to whoever set it, so the next
 * sign-in on this phone starts without one).
 *
 * Deliberately KEPT (device-level, not account data): "last sign-in method"
 * hint on the login screen, theme, and file-view presentation prefs. Auth tokens are cleared by authStore itself.
 *
 * `accountId` is the id of the account that just signed out - by the time
 * this runs, the auth store's `user` is already null, so callers must
 * capture the id before it clears (see app/_layout.tsx). It may be null
 * (e.g. a purge triggered without a known prior session); onboarding state
 * is simply left alone in that case, since there is no key to clear.
 *
 * Best-effort: a failing step must never block the rest of the purge (or the
 * sign-out) - each step is isolated.
 */
export async function purgeAccountData(accountId: string | null): Promise<void> {
  // Claimed before the first await (see pendingOfflinePurge): a sign-in that
  // renders across the awaits below must already see that it has to wait.
  let settleOffline!: () => void;
  const offlineDone = new Promise<void>((r) => { settleOffline = r; });
  const previousOffline = offlinePurge;
  const thisOffline: Promise<void> = (previousOffline ?? Promise.resolve()).then(() => offlineDone);
  offlinePurge = thisOffline;
  // Whose offline files go: the named account, or - when the caller could not
  // name one - the account whose session is running. If ANOTHER account's
  // session is already running (it began after this account left), that
  // session is not ours to end: only this account's directory goes.
  let offlineAccount: string | null = null;
  let offlineOurs = false;
  // FIRST, before any await: the in-memory query cache. It is the one thing
  // here that a live screen reads on its very next render, and everything
  // below is an await the incoming account's UI can render across - which is
  // how another user's storage allowance ended up above the account card in
  // Settings. It is synchronous and cheap, so it has no reason to wait its
  // turn in the list below (where it also still runs, see the note there).
  queryClient.clear();
  // Then, and not awaited before anything else is queued: the iOS Files
  // location, its session and every file iOS downloaded for it. Queued before
  // the first await so a quick re-sign-in cannot link ahead of it and then have
  // this remove the location it just registered. Scoped to this account, so an
  // account switch leaves the incoming account's link alone.
  const unlinked = unlinkFilesProvider(accountId);
  await stopAndClear().catch(() => {}); // a signed-out user must not keep streaming another account's files
  // Best-effort like every step below: a failed unlink must not stop the
  // purge, and must not leave the offline purge pending for ever (the next
  // account's offline session waits on it).
  await unlinked.catch(() => {});

  const steps: Array<() => void | Promise<unknown>> = [
    // Offline files FIRST (G3 in docs/superpowers/plans/2026-11-04-mobile-offline-files.md):
    // end the session - which fences every sync run, cancels its transfers and
    // waits out a commit already holding the lock - then stop the background
    // task, close the database and delete the account's whole offline root.
    // A download that lands after this publishes nothing and deletes its own
    // temp file; a fenced session never reopens the database.
    () => {
      const live = currentSession();
      offlineAccount = accountId ?? live?.accountId ?? null;
      offlineOurs = !live || live.accountId === offlineAccount;
    },
    () => (offlineOurs ? bounded(endSession()) : undefined),
    () => (offlineOurs ? bounded(syncRegistration(false)) : undefined),
    () => (offlineOurs ? bounded(closeOfflineDb()) : undefined),
    // No account to name and no session running (a cold start that never
    // began one): every account directory on disk is this device's leftover
    // offline data, and none of it belongs to a signed-in user.
    () => bounded(offlineAccount ? wipeAccount(offlineAccount) : wipeAllAccounts()),
    () => (offlineOurs ? useOfflineStore.getState().reset() : undefined),
    // "Download over mobile data" and the storage budget are the signed-out
    // user's choices; the next account starts from Wi-Fi only and no budget.
    () => bounded(useOfflineStore.getState().resetSettings()),
    () => settleOffline(),
    () => stopBackup(),
    // iOS keeps running the jobs it was handed even with no app: cancel them
    // and drop their staged copies. Early, because it needs the ledger (the
    // staged paths), the settings and the active workspace (which ledgers to
    // ask) - all of which later steps below wipe.
    () => clearBackgroundUploads(),
    // Not implied by stopBackup: this is account state, and a "back up over
    // mobile data this time" grant must never be inherited by the next
    // account signing in on this device.
    () => resetManualRunOverride(),
    () => useUploadStore.getState().clear(),
    () => clearPersistedUploads(), // the on-disk copy of that queue
    () => resetBackupCompletionState(),
    () => clearWidgetLastStats(),
    () => clearWidgetSnapshot(),
    () => clearWatermarks(),
    () => useUploadBlock.getState().setReason(null), // also deletes the persisted block
    () => clearBackupAlertReport(), // the 24h backup_failed report throttle is device-level; what it suppresses is not
    () => useWorkspaceStore.getState().reset(),
    // Personas: stop reading (the read loops, the reader WebView, the photo
    // listing) and forget every engine until the next account signs in; and
    // "Read on mobile data or battery" goes back to Wi-Fi and charging, so
    // the next account does not inherit it. Then the signed-out user's
    // personas key and sealed snapshots are removed from this device.
    () => teardownPersonas(),
    () => wipePersonasDevice(accountId ?? lastPersonasUser()),
    () => resetReadSettings(),
    // The Vault session, its Spaces list and every decrypted file. Required
    // lazily: the store pulls in the 3 MB e2ee bundle, which must not load at boot.
    // `accountId` may be null (see the doc comment above); the Vault still
    // gets locked either way, just with a harmless no-op keychain key.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => (require("@/vault/store") as typeof import("@/vault/store")).lockVaultForPurge(accountId ?? ""),
    () => resetBackupSettings(),
    () => clearContactsBackupState(),
    () => clearLedger(),
    () => clearHistory(),
    () => clearIncarHistory(), // CarPlay Continue Listening / Recently Played (incar.db)
    () => queryClient.clear(), // again: a screen may have refetched across the awaits above
    () => clearPersistedQueryCache(), // and its on-disk copy (offline cold start)
    // Image caches first, then the directory wipe. Glide keeps an in-memory
    // index of its own on-disk store, so deleting those files underneath it
    // leaves it serving entries that are no longer there.
    () => ExpoImage.clearMemoryCache(),
    () => ExpoImage.clearDiskCache(),
    () => clearCachedFileBytes(),
    () => (accountId ? clearOnboarding(accountId) : undefined),
    () => clearAppLock(),
  ];
  try {
    for (const step of steps) {
      try {
        await step();
      } catch {
        /* best-effort - keep purging */
      }
    }
  } finally {
    settleOffline();
    if (offlinePurge === thisOffline) offlinePurge = null;
  }
}
