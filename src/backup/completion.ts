import { useUploadStore } from "@/upload/store";
import { t } from "@/lib/i18n";
import { getAsset, setStatus } from "./ledger";
import { recordFingerprint } from "./api";
import { queueDeleteAfterBackup } from "./cleanup";
import { useBackupRun } from "./runState";
import { isLivePhotoLedgerId, discardLivePhotoTemp } from "./livePhoto";
import { maybeWithdrawPolicyOverride } from "@/upload/pacing";
import { localDigits } from "@/lib/format-locale";

interface BackupUploadInfo {
  workspaceId: string;
  localId: string;
}

// uploadId -> mapping. Populated by the orchestrator before enqueue. Lives for
// the app process; cleared per-item as each upload settles. Same lifetime as
// the (non-persisted) upload store, so a live `bk_` item is always present here.
const registry = new Map<string, BackupUploadInfo>();
// Guards against the subscription re-entering an in-flight async handler while
// the store emits further changes (e.g. a late progress patch).
const processing = new Set<string>();
// Tracks the last terminal status ("done" | "error") we've already acted on for
// a given upload id, so repeated store emissions with the same terminal status
// don't re-run the handler. Cleared whenever the item moves to a non-terminal
// status (e.g. a user-initiated retry via the upload dock re-queues it), so a
// fresh settle (done/error) after the retry IS handled again.
const lastActed = new Map<string, "done" | "error">();
let unsubscribe: (() => void) | null = null;

export function registerBackupUpload(uploadId: string, workspaceId: string, localId: string): void {
  registry.set(uploadId, { workspaceId, localId });
}

// Which backup assets currently have a live (queued/uploading/done-but-not-yet
// -settled) item in the upload store, keyed by ledger local asset id via the
// registry mapping (no id parsing). Used by the orchestrator to avoid
// re-enqueuing an asset that's already mid-flight from a prior/overlapping
// runBackup (e.g. double-tap "Back up now", or a background run overlapping a
// foreground one) - otherwise the same file uploads twice.
export function backupLocalIdsInStore(): Set<string> {
  const active = new Set<string>();
  for (const it of useUploadStore.getState().items) {
    const info = registry.get(it.id);
    if (info && (it.status === "queued" || it.status === "uploading" || (it.status === "done" && !!it.fileId))) active.add(info.localId);
  }
  return active;
}

// True if any `bk_` (backup) upload is still queued/uploading in the upload
// store. Used to flip the live run-state card back to idle once every
// in-flight backup upload has settled (done or error) - a single item
// settling doesn't mean the whole run is done if others are still going.
function anyBackupUploadActive(): boolean {
  return useUploadStore.getState().items.some((i) => i.id.startsWith("bk_") && (i.status === "queued" || i.status === "uploading"));
}

/**
 * The run is over once its LAST upload settles - which is not when runBackup
 * resolves (that happens at the end of the scan, with the queue still
 * draining). Flips the live card back to idle and hands back any one-off
 * "over mobile data this time" permission the manual run was carrying; holding
 * it any longer than the run would let the next automatic run ignore Wi-Fi-only,
 * and withdrawing it any earlier re-armed the hold against the run's own queue.
 */
export function settleRunIfDrained(): void {
  if (anyBackupUploadActive()) return;
  // A momentarily empty queue is NOT the end of the run while the scan is
  // still enqueuing: the scanner works in batches and the queue drains between
  // them. The phase only becomes "uploading" once runBackup has finished
  // planning, so anything earlier is a gap, not an ending.
  //
  // Settling in those gaps called idle() - and idle() tears down the Android
  // dataSync foreground service. On a real run that fired about once a second:
  // the notification flickered, and every teardown left the upload without the
  // service that keeps it alive once the screen locks, which is the whole
  // reason the permission exists.
  //
  // The orchestrator calls this directly after it flips to "uploading", so a
  // queue that drained before the scan ended still settles.
  if (useBackupRun.getState().phase !== "uploading") return;
  // On the iOS background transport the uploads are the OS's, not the store's,
  // so an empty store says nothing about the run. The orchestrator records the
  // OS queue's size before it flips to "uploading"; while that is above zero
  // the run is live and startBackgroundUploadEvents ends it when the queue
  // drains. Without this the ring dropped out of "running" the instant the
  // scan ended and came back once the screen re-read the native queue.
  if (useBackupRun.getState().backgroundJobs > 0) return;
  useBackupRun.getState().idle();
  maybeWithdrawPolicyOverride();
}

interface DoneDetails {
  /** The staged file's own byte count, as enqueued. */
  localSize: number;
  /** What the server reports having stored; null when the response had no count. */
  serverSize: number | null;
  /** The uploaded file's uri - a Live Photo's extracted video is deleted from here. */
  uri: string;
}

/**
 * The server's byte count disagrees with the file we sent. A truncated
 * transfer that the server nevertheless accepted must not become "uploaded":
 * the ledger would never look at the asset again, delete-after-backup could
 * remove the only good copy, and the fingerprint would point every other
 * device at the short file.
 */
function sizeMismatch(d: DoneDetails): string | null {
  if (d.serverSize == null || d.localSize <= 0) return null;
  if (d.serverSize === d.localSize) return null;
  return t("backup.error.sizeMismatchLocalLocalSizeServerServerSize", { localSize: localDigits(d.localSize), serverSize: localDigits(d.serverSize) });
}

async function handleDone(uploadId: string, info: BackupUploadInfo, fileId: string, details: DoneDetails): Promise<void> {
  processing.add(uploadId); // synchronous - set before any await so we never double-enter
  const mismatch = sizeMismatch(details);
  if (mismatch) {
    // Same shape as handleError, deliberately outside the success path's
    // finally: the registry entry stays so a dock Retry still records, the
    // item is NOT folded into the settled (success) counters, and the store
    // row is flipped to error so the dock shows the failure and offers Retry.
    try {
      await setStatus(info.workspaceId, info.localId, "error", { lastError: mismatch, incAttempts: true });
    } finally {
      // Set before the patch: the patch re-enters the subscription synchronously
      // with status "error", and this is what makes that a no-op.
      lastActed.set(uploadId, "error");
      useUploadStore.getState().patch(uploadId, { status: "error", error: mismatch, fileId: undefined, uploadedBytes: undefined });
      processing.delete(uploadId);
      settleRunIfDrained();
    }
    return;
  }
  try {
    const row = await getAsset(info.workspaceId, info.localId);
    const fp = row?.fingerprint ?? null;
    // Upload is source of truth - flip the ledger FIRST. recordFingerprint is
    // best-effort: if the record POST throws, the row must still end up
    // "uploaded" (not stuck "pending", which would cause a duplicate
    // re-upload next runBackup) - the same-device guard (this ledger) already
    // prevents a local duplicate; we'd just miss the cross-device server-dedup
    // entry.
    await setStatus(info.workspaceId, info.localId, "uploaded", { remoteFileId: fileId });
    if (fp) {
      try {
        await recordFingerprint(info.workspaceId, fp, fileId);
      } catch {
        // server-dedup entry missed; same-device guard already holds
      }
    }
    // Queued, not deleted: the whole run is offered to the OS in one prompt
    // when runBackup finishes. See cleanup.flushDeleteAfterBackup.
    queueDeleteAfterBackup(info.localId);
    // The extracted motion half of a Live Photo is a temp copy of bytes the
    // library still holds; once it is on the server it is only cache.
    if (isLivePhotoLedgerId(info.localId)) await discardLivePhotoTemp(details.uri);
  } finally {
    // Fully settled success - never revisit this upload id again.
    registry.delete(uploadId);
    lastActed.delete(uploadId);
    processing.delete(uploadId);
    // Fold the finished item into the aggregate counters so the live array
    // stays bounded for the whole run (see store.settledBk).
    useUploadStore.getState().foldSettledBk();
    settleRunIfDrained();
  }
}

async function handleError(uploadId: string, info: BackupUploadInfo, error: string): Promise<void> {
  // NOTE: do NOT delete the registry entry here. The globally-mounted upload
  // dock (Phase 2c) lets the user Retry any errored item, including `bk_`
  // backup uploads - a retry re-arms the same upload id via the upload
  // controller and re-runs it through to "done". handleDone still needs this
  // registry entry to look up the workspace/local ids and record the
  // fingerprint. Deleting it here would let a retried upload silently finish
  // without ever being recorded (registry.get(id) undefined -> skipped),
  // leaving the ledger row stuck "error" forever and causing the next
  // runBackup to re-upload a duplicate. The `lastActed` transition guard
  // below is what prevents re-running this handler on repeat "error" emits.
  try {
    await setStatus(info.workspaceId, info.localId, "error", { lastError: error, incAttempts: true });
  } finally {
    // In a finally for the same reason handleDone's is: a rejected ledger write
    // (a locked database) must not leave the run card stuck "Backing up" and
    // the manual mobile-data permission held for the rest of the process.
    settleRunIfDrained();
  }
}

export function ensureBackupCompletionSubscribed(): void {
  if (unsubscribe) return;
  unsubscribe = useUploadStore.subscribe((state) => {
    for (const it of state.items) {
      const info = registry.get(it.id);
      if (!info || processing.has(it.id)) continue;
      if (it.status === "done" && it.fileId) {
        if (lastActed.get(it.id) === "done") continue;
        lastActed.set(it.id, "done");
        // Swallowed deliberately: this runs inside a store subscription, where
        // an unhandled rejection has nowhere to go. The ledger write is the
        // only thing that can throw, both handlers settle the run in a
        // `finally`, and the item's own row already shows the outcome.
        void handleDone(it.id, info, it.fileId, { localSize: it.size, serverSize: it.uploadedBytes ?? null, uri: it.uri }).catch(() => {});
      } else if (it.status === "error" || (it.status === "done" && !it.fileId)) {
        // A "done" item with no usable fileId can't be recorded - treat it as
        // an error so it retries on the next runBackup instead of silently
        // being dropped (never re-uploaded, never recorded).
        if (lastActed.get(it.id) === "error") continue;
        lastActed.set(it.id, "error");
        const message = it.status === "done" ? t("backup.error.uploadCompletedWithoutAFileId") : (it.error ?? t("common.error.uploadFailed"));
        void handleError(it.id, info, message).catch(() => {});
      } else {
        // Non-terminal status (queued/uploading) - e.g. a retry re-armed the
        // item. Clear the guard so the next done/error settle is handled.
        lastActed.delete(it.id);
      }
    }
  });
}

// Test-only: reset module state between tests.
export function __resetBackupCompletion(): void {
  registry.clear();
  processing.clear();
  lastActed.clear();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Forget uploads that were removed from the store without settling through the
 * subscription - e.g. runBackup dropping a previous run's done/error items at
 * run start. Without this their registry/lastActed entries would linger for
 * the whole app session.
 */
export function purgeBackupUploadRegistry(uploadIds: Iterable<string>): void {
  for (const id of uploadIds) {
    registry.delete(id);
    lastActed.delete(id);
  }
}

/** Account purge (sign-out): the upload store is cleared wholesale, so every
 * registry entry is orphaned - drop them all. */
export function resetBackupCompletionState(): void {
  registry.clear();
  lastActed.clear();
  processing.clear();
}
