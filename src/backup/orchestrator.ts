import { openLedger, upsertAsset, getAsset, getAssetsBulk, setStatus, setMpSession, markPairChecked, seedAssets, type LedgerRow } from "./ledger";
import { backgroundTransportAvailable, queueNextBatch, settleFinishedJobs, cancelQueuedJobs, releaseStagedLarge, queuedJobCount } from "./transport/backgroundTransport";
import { backgroundUploadNative } from "../../modules/dosya-background-upload";
import { scanAssets, resolveAsset, type ResolvedAsset, type ScannedAsset } from "./scanner";
import { getWatermark, advanceWatermark, WATERMARK_OVERLAP_S, FULL_RECONCILE_AFTER_S } from "./watermark";
import { computeFingerprint } from "./fingerprint";
import { checkFingerprints, recordFingerprint } from "./api";
import { queueDeleteAfterBackup, flushDeleteAfterBackup, clearDeleteQueue } from "./cleanup";
import { startBackupService, updateBackupService, stopBackupService } from "./foregroundService";
import { useBackupSettings } from "./settings";
import { ensureAlbumDefaults } from "./albumDefaults";
import { mimeForFilename } from "./mime";
import { resolvePairedVideo, livePhotoLedgerId } from "./livePhoto";
import { uploadResumable, type ResumableSession } from "@/upload/resumable";
import { resolveBackupFolder } from "./folders";
import { ensureBackupCompletionSubscribed, registerBackupUpload, backupLocalIdsInStore, purgeBackupUploadRegistry, settleRunIfDrained } from "./completion";
import { useBackupRun } from "./runState";
import { recordBackupRun } from "./history";
import { AppState, Platform } from "react-native";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useUploadStore } from "@/upload/store";
import { startUploads, isFatalUploadError } from "@/upload/controller";
import { useUploadBlock } from "@/upload/uploadBlock";
import { ApiError } from "@/api";
import { t } from "@/lib/i18n";
import { getBackupHold, resetManualRunOverride } from "@/upload/pacing";
import type { UploadItem } from "@/upload/types";
import { localDigits } from "@/lib/format-locale";
import { startPosterOnUpload } from "@/files/posterOnUpload";

export const MAX_SINGLE_SHOT = 50 * 1024 * 1024;
export const MAX_BACKUP_ATTEMPTS = 5;

// Stills backed up before Live Photo pairing existed have no paired-video row.
// Each run probes at most this many of them (a native call per still, and an
// extraction + upload for the ones that turn out to be Live Photos), so a big
// library is caught up over a series of runs instead of one very long one.
let LIVE_PHOTO_BACKFILL_PER_RUN = 25;

// Test hook.
export function __setLivePhotoBackfillLimit(n: number): void {
  LIVE_PHOTO_BACKFILL_PER_RUN = n;
}

// Backpressure: how many backup uploads may be live (queued + uploading) in
// the store at once. The scan WAITS at this ceiling before materializing and
// enqueueing more - so a 5,000-photo library never sits in memory as 5,000
// queue items, and iCloud originals download paced to upload speed instead
// of all up-front. Bounded queue = bounded RAM, disk churn, and heat.
let MAX_LIVE_QUEUE = 120;

// Test hook: shrink the ceiling so specs don't need hundreds of items.
export function __setMaxLiveQueue(n: number): void {
  MAX_LIVE_QUEUE = n;
}

// How long a run will sit waiting for Wi-Fi or a charger before it gives up and
// ends cleanly. Without a deadline, going offline or unplugging mid-run parked
// runBackup forever: on Android the foreground service stayed up, and a headless
// background run hung until the OS killed it. Ending the run costs nothing - the
// watermark is not advanced and the ledger rows stay pending, so the next run
// (hourly task, media event, or the user) picks up exactly where this stopped.
const DEFAULT_HOLD_DEADLINE_MS = 5 * 60_000;
let HOLD_DEADLINE_MS = DEFAULT_HOLD_DEADLINE_MS;

// Test hook: shrink (or, with null, restore) the hold deadline.
export function __setHoldDeadline(ms: number | null): void {
  HOLD_DEADLINE_MS = ms ?? DEFAULT_HOLD_DEADLINE_MS;
}

// Set when a hold outlasted the deadline. Read like `cancelRequested`: the scan
// and the large-file loop stop, and the watermark is left where it was.
let holdTimedOut = false;

// Set when the server answered `surface_disabled` - the mobile platform switch
// is off. Read like `holdTimedOut`: the scan and the large-file loop stop and
// the watermark stays put, so nothing is skipped. Deliberately NOT the upload
// block: that store is persisted, keeps the background task from even trying
// until someone taps retry by hand, and raises a "Backup paused" notification.
// Maintenance is the platform's state, not the user's, and the next scheduled
// run is supposed to pick straight back up once it is over - so this flag lives
// only for the duration of the run.
let haltedForMaintenance = false;

function unsettledBkCount(): number {
  return useUploadStore.getState().items.filter(
    (i) => i.id.startsWith("bk_") && (i.status === "queued" || i.status === "uploading"),
  ).length;
}

// Also parks the scan while a policy hold is in force (Wi-Fi dropped, charger
// unplugged): materializing here downloads iCloud originals, and doing that
// over mobile data is exactly what Wi-Fi-only exists to prevent. A manual Stop
// or a fatal block still ends the wait.
async function waitForQueueRoom(): Promise<void> {
  let heldSince: number | null = null;
  while (!cancelRequested && !holdTimedOut && !haltedForMaintenance && !useUploadBlock.getState().reason) {
    const hold = getBackupHold();
    const crowded = unsettledBkCount() >= MAX_LIVE_QUEUE;
    if (!hold && !crowded) return;
    if (hold) {
      const now = Date.now();
      heldSince ??= now;
      if (now - heldSince >= HOLD_DEADLINE_MS) {
        // The network or the charger is not coming back on this run's watch.
        holdTimedOut = true;
        return;
      }
    } else {
      // Backpressure alone never ends a run - the queue IS draining.
      heldSince = null;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export interface BackupSummary { scanned: number; enqueued: number; deduped: number; largeUploaded: number; largeFailed: number; unreadable: number; skippedLarge: number }

export interface RunOptions {
  /** Automatic trigger (background task / media listener): scan incrementally
   * from the watermark; a full reconcile runs when the last one is stale.
   * Manual runs always sweep the whole library. */
  auto?: boolean;
  /** iOS media-change events name exactly what was inserted - process just
   * those assets, no scanning at all. */
  targetedAssets?: ScannedAsset[];
  /** Wall-clock budget for staging; background callers pass theirs. */
  deadlineMs?: number;
}

let uploadSeq = 0;

let cancelRequested = false;

// Latched by a manual Stop: auto triggers (media-change listener, hourly
// background task) must NOT restart the engine the user just stopped - the
// run's own library events (iCloud downloads, delete-after-backup) would
// otherwise re-trigger it ~2s after the tap. Cleared by the next manual
// start; resets naturally on app relaunch. The autoBackup SETTING is
// untouched - this is a session-scoped "the user said stop".
let manualStopLatch = false;

export function isManuallyStopped(): boolean {
  return manualStopLatch;
}

export function clearManualStop(): void {
  manualStopLatch = false;
}

/**
 * Stop an in-progress backup NOW: drop all not-done backup uploads (queued AND
 * in-flight) so the run goes idle immediately, and set the cancel flag so the
 * scan / large-file loops bail out. A native upload already mid-flight may still
 * finish server-side (there is no cancel endpoint yet); its ledger row stays
 * "pending" and is re-checked + server-deduped by the next runBackup
 * ("Continue"). Trade-off: a file caught exactly mid-PUT could re-upload once.
 */
export function stopBackup(): void {
  manualStopLatch = true;
  cancelRequested = true;
  // Drop anything queued for delete-after-backup. The user stopped the run;
  // deleting originals it had already uploaded would be a nasty surprise, and
  // leaving them queued would let the NEXT run's flush delete them.
  clearDeleteQueue();
  // Jobs already handed to iOS keep running after the app is suspended, so
  // dropping the store items is not enough on the background transport: the
  // queued ones have to be cancelled natively too.
  // The run state only names a workspace once a run has started IN THIS
  // PROCESS. After a relaunch (the jobs outlived the app) Stop is the first
  // thing this process does, so fall back to the workspace the user is on -
  // otherwise the cancel is skipped and iOS keeps uploading.
  const ws = useBackupRun.getState().workspaceId ?? useWorkspaceStore.getState().activeId;
  // Fire and forget: stopBackup is synchronous, and a cancel that fails must
  // not surface as an unhandled rejection - the next run re-plans the rows.
  if (ws && backgroundTransportAvailable(ws)) void cancelQueuedJobs(ws).catch(() => {});
  // The user asked for idle: show it now rather than after the cancel round
  // trip. A job iOS was mid-way through still finishes, and its onJobFinished
  // event re-reads the real count.
  useBackupRun.getState().setBackgroundJobs(0);
  // Take the notification down with the run, or it outlives the engine.
  stopBackupService();
  useUploadStore.setState((s) => ({
    items: s.items.filter((i) => !(i.id.startsWith("bk_") && (i.status === "queued" || i.status === "uploading"))),
  }));
  // Those items are gone from the store, so the completion subscription will
  // never see a last settle - the usual moment a manual run's "over mobile data
  // this time" permission lapses. Hand it back here instead, or Wi-Fi-only
  // stays unenforced for the rest of the process.
  resetManualRunOverride();
  useBackupRun.getState().idle();
}

// True only while runBackup's own body is executing. The manual path backs up
// to each destination SEQUENTIALLY (await per workspace), so this never blocks
// the next destination - it only blocks a run starting on top of a live one.
let runInFlight = false;

/**
 * Nothing about the engine is reentrant: `cancelRequested`, the watermark and
 * the upload registry are module state shared by every caller. A second run
 * starting mid-backup also called startScan() and, finding nothing new to
 * enqueue, ended with idle() - which tore down the FIRST run's Android
 * dataSync foreground service. The media-change listener fires on every
 * library change, so a user taking photos during their own backup cycled the
 * service (and the upload's protection against the screen locking) every few
 * seconds.
 */
export async function runBackup(workspaceId: string, workspaceName?: string, opts: RunOptions = {}): Promise<BackupSummary> {
  if (runInFlight) return { scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0, unreadable: 0, skippedLarge: 0 };
  runInFlight = true;
  // Backed-up videos get their poster from the file on this phone. Installed
  // here as well as at launch: a background run is headless (no _layout).
  startPosterOnUpload();
  try {
    return await runBackupBody(workspaceId, workspaceName, opts);
  } finally {
    runInFlight = false;
  }
}

async function runBackupBody(workspaceId: string, workspaceName?: string, opts: RunOptions = {}): Promise<BackupSummary> {
  cancelRequested = false;
  holdTimedOut = false;
  haltedForMaintenance = false;
  // Drop backup items settled in a previous run: their bytes would otherwise
  // inflate this run's speed/ETA math (fresh batch clock, old uploadedBytes)
  // and stale error rows would pile up under the new run's live feed.
  const droppedIds: string[] = [];
  useUploadStore.setState((s) => ({
    items: s.items.filter((i) => {
      const settled = i.id.startsWith("bk_") && (i.status === "done" || i.status === "error");
      if (settled) droppedIds.push(i.id);
      return !settled;
    }),
  }));
  purgeBackupUploadRegistry(droppedIds); // their completion bookkeeping is orphaned too
  useUploadStore.getState().resetSettledBk(); // new run: folded baselines restart
  await openLedger();
  // Camera bucket ids need media permission and an album query, so platform
  // defaults cannot be resolved at hydrate time - they land here, once ever.
  await ensureAlbumDefaults();
  const filters = useBackupSettings.getState().settings.filters;
  // Android only: keeps the run alive once the screen locks. No-op elsewhere.
  startBackupService(t("backup.label.lookingForNewPhotos"));
  useBackupRun.getState().startScan(workspaceName ?? null, workspaceId);
  ensureBackupCompletionSubscribed();
  // iOS with the background transport on: uploads are handed to the OS, which
  // runs them after the app is suspended. The scan only seeds ledger rows and
  // the transport plans from there.
  const background = backgroundTransportAvailable(workspaceId);
  if (background) {
    // Results first: a relaunch's finished uploads become ledger rows before
    // the planner looks at what is still pending.
    await settleFinishedJobs().catch(() => {});
  }
  const summary: BackupSummary = { scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0, unreadable: 0, skippedLarge: 0 };
  // `mime` is set only for a transport-staged file, where the native side
  // typed the export itself; the in-process path derives it from the filename.
  const pendingLarge: { asset: ResolvedAsset; fp: string | null; mime?: string }[] = [];
  // Staged copies the transport handed back in `large`: this run owns them and
  // deletes each one the moment it is done with it (uploaded, failed, or never
  // reached). The library asset itself is untouched, so the ledger row's next
  // run simply stages it again.
  const stagedLargeUris = new Set<string>();
  const nowS = Math.floor(Date.now() / 1000);
  const watermark = opts.auto && !opts.targetedAssets ? await getWatermark(workspaceId) : null;
  const fullScan =
    !opts.targetedAssets &&
    (!opts.auto || !watermark || nowS - watermark.lastFullScanAt >= FULL_RECONCILE_AFTER_S);
  let newestSeen = 0;
  let livePhotoProbes = 0;

  /**
   * Ask whether a still is a Live Photo and, if so, stage its paired video as
   * a sibling upload under its own ledger row. Marks the still checked either
   * way so it is not asked again. `folderId` is passed when the caller has
   * already resolved it for the still.
   */
  const stageLivePhotoPair = async (a: ScannedAsset & { uri?: string }, folderId?: string | null): Promise<UploadItem | null> => {
    const paired = await resolvePairedVideo({ id: a.id, uri: a.uri, filename: a.filename });
    await markPairChecked(workspaceId, a.id);
    if (!paired) return null;
    const pairedId = livePhotoLedgerId(a.id);
    await upsertAsset({
      workspace_id: workspaceId, local_id: pairedId, filename: paired.name,
      size: paired.size, created_at: a.createdAt,
    });
    const folder = folderId === undefined ? await resolveBackupFolder(workspaceId, a.createdAt) : folderId;
    uploadSeq += 1;
    const pairedUploadId = `bk_${pairedId}_${uploadSeq}`;
    registerBackupUpload(pairedUploadId, workspaceId, pairedId);
    return {
      id: pairedUploadId,
      name: paired.name,
      uri: paired.uri,
      size: paired.size,
      mime: paired.name.endsWith(".MP4") ? "video/mp4" : "video/quicktime",
      folderId: folder,
      workspaceId,
      status: "queued",
      progress: 0,
      // The paired video shares the photo's moment - the library has no
      // separate dates for it.
      sourceCreatedAt: a.createdAt,
      sourceModifiedAt: a.modifiedAt,
    };
  };

  /**
   * Whether an already-uploaded still still owes us a Live Photo probe: never
   * asked, or asked and the pair's own upload failed and can retry.
   */
  const owesPairProbe = (a: ScannedAsset, row: LedgerRow, rowsById: Map<string, LedgerRow>, active: Set<string>): boolean => {
    if (a.mediaType !== "photo") return false;
    const pairedId = livePhotoLedgerId(a.id);
    if (active.has(pairedId)) return false;
    const pair = rowsById.get(pairedId);
    if (pair) return pair.status === "error" && (pair.attempts ?? 0) < MAX_BACKUP_ATTEMPTS;
    return !row.pair_checked;
  };

  const onBatch = async (batch: ScannedAsset[]) => {
    // Stop dead on cancel OR on a fatal workspace error (storage limit etc.)
    // raised by an earlier batch's uploads - scanning, resolving (iCloud
    // downloads!), fingerprinting, and enqueueing more files is pointless
    // and would just re-fail every batch.
    if (cancelRequested || holdTimedOut || haltedForMaintenance || useUploadBlock.getState().reason) return;
    if (background) {
      // The background transport plans from the ledger, so a scan only has to
      // make sure every eligible asset has a row. No materialising here: that
      // is the staging step, budgeted separately.
      for (const a of batch) { summary.scanned += 1; newestSeen = Math.max(newestSeen, a.createdAt); }
      await seedAssets(workspaceId, batch.map((a) => ({ local_id: a.id, filename: a.filename, created_at: a.createdAt })));
      return;
    }
    // Backpressure: don't process (materialize/fingerprint/enqueue) this batch
    // until the live queue has drained below the ceiling.
    await waitForQueueRoom();
    if (cancelRequested || holdTimedOut || haltedForMaintenance || useUploadBlock.getState().reason) return;
    // Everything below makes API calls (checkFingerprints, resolveBackupFolder)
    // that can 503 with surface_disabled the moment the mobile platform switch
    // goes off - the very first one a real run makes. Wrapped so that halts
    // the run the same way a workspace-fatal error does (see the catch below)
    // instead of rejecting runBackup() outright, which callers were reporting
    // as "Backup failed" and which left the background task retrying every
    // ~15 minutes against a paused surface.
    try {
      // Assets that already have a live (queued/uploading/done) item in the
      // upload store - e.g. a second runBackup overlapping an in-flight one
      // (double-tap "Back up now", or a background run overlapping a
      // foreground one). Skip them so they don't get double-enqueued into a
      // second upload of the same file. Read once per batch since the store
      // changes as uploads settle; an errored/settled asset is NOT in this
      // set, so it can still retry on a later run.
      const activeLocalIds = backupLocalIdsInStore();
      // One IN-query per batch instead of a point read per asset (see getAssetsBulk).
      // A photo's paired-video key rides along so the Live Photo checks below
      // are answered from this map rather than a point read per photo.
      const rowsById = await getAssetsBulk(
        workspaceId,
        batch.flatMap((a) => (a.mediaType === "photo" ? [a.id, livePhotoLedgerId(a.id)] : [a.id])),
      );

      // 1. Reconcile into the ledger; keep only not-yet-uploaded, not-in-flight assets.
      const fresh: ResolvedAsset[] = [];
      const pairBackfill: ScannedAsset[] = [];
      for (const a of batch) {
        summary.scanned += 1;
        newestSeen = Math.max(newestSeen, a.createdAt);
        // Dedup by asset id BEFORE touching the file, so a re-scan over a huge /
        // iCloud library never re-downloads originals it already backed up.
        const row = rowsById.get(a.id);
        if (row?.status === "uploaded") {
          // Backed up before Live Photo pairing existed (or its pair failed):
          // the still is done, but its motion half may still be owed.
          if (owesPairProbe(a, row, rowsById, activeLocalIds)) pairBackfill.push(a);
          continue;
        }
        if (row?.status === "skipped_large") continue;
        // Give up on a permanently-failing asset: past the cap, stop re-hashing
        // and re-uploading it every run. It stays `error` permanently (visible
        // in the Backup screen's Failed count) - there is no retry/reset path,
        // so this asset is never attempted again by a later run.
        if (row?.status === "error" && (row.attempts ?? 0) >= MAX_BACKUP_ATTEMPTS) continue;
        if (activeLocalIds.has(a.id)) continue; // already has a live backup upload in flight - don't re-enqueue
        // Fresh - materialize the file now (downloads an iCloud original just in
        // time). Skip if it can't be read (won't download / Limited access).
        const outcome = await resolveAsset(a);
        if (!outcome.asset) {
          if (outcome.reason === "empty") {
            // A file the device itself reports as 0 bytes. Uploading it would
            // store an empty "backup" of a real photo; re-checking it forever
            // costs a stat and a 1.5s wait every run. Record it with an attempt
            // so the cap above eventually retires it, and leave it visible in
            // the Failed count where the user can see it.
            await upsertAsset({ workspace_id: workspaceId, local_id: a.id, filename: a.filename, size: 0, created_at: a.createdAt });
            await setStatus(workspaceId, a.id, "error", {
              lastError: t("backup.error.thisFileIsEmptyOnThisDevice"), incAttempts: true,
            });
          }
          // iCloud original would not download / Limited access - retried next
          // run, and surfaced on the dashboard so it is never a silent skip.
          summary.unreadable += 1;
          continue;
        }
        const resolved = outcome.asset;
        await upsertAsset({ workspace_id: workspaceId, local_id: a.id, filename: a.filename, size: resolved.size, created_at: a.createdAt });
        // The size cap can only be applied here - size is unknowable until the
        // file is materialized. Over the cap the row is marked and leaves the
        // pending count for good, so later runs drop it in the id-dedup check
        // above without re-downloading the original.
        if (filters.maxBytes != null && resolved.size > filters.maxBytes) {
          await setStatus(workspaceId, a.id, "skipped_large", {
            lastError: t("backup.label.largerThanYourMaxBytesByteLimit", { maxBytes: localDigits(filters.maxBytes) }),
          });
          summary.skippedLarge += 1;
          continue;
        }
        fresh.push(resolved);
      }

      // Live Photo backfill for stills already on the server. Bounded per run;
      // whatever is left is picked up by the next one, since only probed stills
      // get marked.
      const pairedOnly: UploadItem[] = [];
      for (const a of pairBackfill) {
        if (cancelRequested || holdTimedOut || haltedForMaintenance || useUploadBlock.getState().reason) break;
        if (livePhotoProbes >= LIVE_PHOTO_BACKFILL_PER_RUN) break;
        livePhotoProbes += 1;
        // The still is already uploaded, so the batch item here is a bare
        // ScannedAsset with no uri. iOS resolves the pair by PHAsset id alone;
        // Android has to read the file's own bytes, so it needs the still
        // materialized first - same just-in-time resolve the normal upload
        // path uses.
        const withUri = Platform.OS === "android" ? { ...a, uri: (await resolveAsset(a)).asset?.uri } : a;
        const item = await stageLivePhotoPair(withUri);
        if (item) pairedOnly.push(item);
      }
      if (pairedOnly.length > 0) {
        useUploadStore.getState().enqueue(pairedOnly);
        startUploads();
        summary.enqueued += pairedOnly.length;
      }

      if (fresh.length === 0) return;

      // 2. Fingerprint + server dedup check.
      const fps = new Map<string, string>(); // localId -> fingerprint
      for (const a of fresh) {
        try { fps.set(a.id, await computeFingerprint(a.uri, a.size)); } catch { /* leave unfingerprinted; retry later */ }
      }
      const existing = await checkFingerprints(workspaceId, Array.from(new Set(fps.values())));

      // 3. Classify each fresh asset.
      const toEnqueue: UploadItem[] = [];
      for (const a of fresh) {
        const fp = fps.get(a.id);
        if (fp && existing[fp]) {
          // Already on the server (another device / reinstall) - link, no upload.
          await setStatus(workspaceId, a.id, "uploaded", { remoteFileId: existing[fp], fingerprint: fp });
          summary.deduped += 1;
          continue;
        }
        if (a.size > MAX_SINGLE_SHOT) {
          if (fp) await setStatus(workspaceId, a.id, "pending", { fingerprint: fp });
          pendingLarge.push({ asset: a, fp: fp ?? null });
          continue;
        }
        const folderId = await resolveBackupFolder(workspaceId, a.createdAt);
        uploadSeq += 1;
        const uploadId = `bk_${a.id}_${uploadSeq}`;
        // Register with the real asset localId directly (not by parsing uploadId
        // back apart) - PHAsset local identifiers can themselves contain `_`,
        // which would make id-parsing fragile.
        registerBackupUpload(uploadId, workspaceId, a.id);
        toEnqueue.push({
          id: uploadId,
          name: a.filename,
          uri: a.uri,
          size: a.size,
          mime: mimeForFilename(a.filename, a.mediaType),
          folderId,
          workspaceId: workspaceId,
          status: "queued",
          progress: 0,
          // The asset's own dates, so the photo lists under the day it was
          // taken rather than the day this backup ran.
          sourceCreatedAt: a.createdAt,
          sourceModifiedAt: a.modifiedAt,
        });
        if (fp) await setStatus(workspaceId, a.id, "pending", { fingerprint: fp });
        summary.enqueued += 1;

        // Live Photos carry a second, paired video that expo-media-library never
        // surfaces - without this the motion half is silently dropped. It rides
        // along as a sibling in the same folder, under its own ledger row so it
        // dedupes and retries like any other asset.
        if (a.mediaType === "photo" && !rowsById.get(livePhotoLedgerId(a.id))) {
          const pairedItem = await stageLivePhotoPair(a, folderId);
          if (pairedItem) {
            toEnqueue.push(pairedItem);
            summary.enqueued += 1;
          }
        }
      }

      if (toEnqueue.length > 0) {
        useUploadStore.getState().enqueue(toEnqueue);
        startUploads();
        const done = summary.deduped + summary.largeUploaded;
        const seen = summary.scanned || 1;
        updateBackupService(t("backup.label.backingUpEnqueuedItems", { enqueued: localDigits(summary.enqueued) }), (done + summary.enqueued) / seen);
      }
    } catch (e) {
      // The mobile platform switch is off (client.ts already recorded
      // this for MaintenanceScreen the moment the response came back).
      // Not an asset failure - the server is refusing every gated request
      // right now - so halt the run: raise the run-local flag (the guard at
      // the top of onBatch makes every later batch a no-op, so no further
      // API call is made) and stop here rather than letting this rejection
      // propagate out of onBatch, out of scanAssets(), and out of runBackup()
      // itself as a failed promise. Nothing here has touched the ledger yet
      // for this batch's not-yet-classified assets, so they stay pending and
      // are picked back up by the next run untouched.
      if (e instanceof ApiError && e.code === "surface_disabled") {
        haltedForMaintenance = true;
        return;
      }
      throw e;
    }
  };

  let scanCompleted: boolean;
  try {
    if (opts.targetedAssets) {
      if (opts.targetedAssets.length > 0) await onBatch(opts.targetedAssets);
      scanCompleted = true;
    } else {
      scanCompleted = await scanAssets(onBatch, {
        filters,
        ...(fullScan || !watermark ? {} : { createdAfter: Math.max(0, watermark.newestCreatedAt - WATERMARK_OVERLAP_S) }),
      });
    }
  } catch (e) {
    // Defense in depth: onBatch already catches a surface_disabled ApiError
    // itself (see above), so this should never actually trigger - but if a
    // future change to onBatch or scanAssets ever let one leak past it, this
    // still ends the run as a halt rather than a rejected runBackup() promise.
    if (e instanceof ApiError && e.code === "surface_disabled") {
      haltedForMaintenance = true;
      scanCompleted = false;
    } else {
      throw e;
    }
  }

  // Advance the incremental-scan watermark only when the scan actually ran to
  // completion - a canceled or blocked run must not skip assets forever.
  if (scanCompleted && !cancelRequested && !holdTimedOut && !haltedForMaintenance && !useUploadBlock.getState().reason) {
    await advanceWatermark(workspaceId, newestSeen, { fullScan, now: nowS });
  }

  // `haltedForMaintenance` gates this the same way it gates the scan above: a
  // paused mobile surface refuses init-batch, so planning and staging another
  // round would export iCloud originals only to be turned away.
  if (background && !cancelRequested && !haltedForMaintenance && !useUploadBlock.getState().reason) {
    const deadlineMs = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
    // Top up until the staging budget is full or nothing is left to plan.
    while (!cancelRequested && !haltedForMaintenance && !useUploadBlock.getState().reason && Date.now() < deadlineMs) {
      // Staging exports iCloud originals, so a policy hold (Wi-Fi dropped,
      // charger unplugged) has to stop it just as it stops the in-process
      // scan. The run ends here rather than parking: the next trigger plans
      // again, and the ledger rows are untouched.
      if (getBackupHold()) break;
      let batch;
      try { batch = await queueNextBatch(workspaceId, { deadlineMs }); }
      catch { break; } // direct_unavailable or a network failure: the next run tries again (or falls back)
      summary.enqueued += batch.queued; summary.deduped += batch.deduped;
      summary.unreadable += batch.unreadable; summary.skippedLarge += batch.skippedLarge;
      for (const l of batch.large) {
        // A large row stays `pending` until this run's loop uploads it, so the
        // next batch can hand back the same staged file. Taking it twice would
        // upload it twice AND delete the staged copy from under the second
        // attempt, whose failure would then overwrite the `uploaded` row.
        if (stagedLargeUris.has(l.path)) continue;
        stagedLargeUris.add(l.path);
        pendingLarge.push({
          asset: {
            id: l.localId, filename: l.filename, createdAt: l.createdAt, modifiedAt: l.createdAt,
            mediaType: l.mime.startsWith("video/") ? "video" : "photo",
            uri: l.path, size: l.size,
          },
          fp: null,
          // PhotoKit's own type for the exported file; the extension can lie.
          mime: l.mime,
        });
      }
      // `queued: 0` is also how a denied library, a set upload block or a
      // wholly unreadable window comes back, so it ends the loop too - not
      // just `exhausted`.
      if (batch.queued === 0 || batch.exhausted) break;
    }
  }

  for (const { asset, fp: plannedFp, mime: stagedMime } of pendingLarge) {
    // A policy hold parks the large-file loop between files too. The file
    // already mid-multipart finishes on whatever network it has.
    await waitForQueueRoom();
    // Same rule as the scan: a fatal workspace error halts the run - don't
    // start another multi-minute multipart upload that is guaranteed to fail.
    if (cancelRequested || holdTimedOut || haltedForMaintenance || useUploadBlock.getState().reason) break;
    let fp = plannedFp;
    // The transport hands large files back unhashed (it fingerprints only what
    // it queues itself), so hash the staged copy here - otherwise these files
    // would be the only ones never to get a server-dedup entry, and every
    // reinstall would upload them again.
    if (fp === null && stagedLargeUris.has(asset.uri)) {
      try { fp = await computeFingerprint(asset.uri, asset.size); } catch { /* leave unfingerprinted; retry later */ }
    }
    uploadSeq += 1;
    const uploadId = `bk_${asset.id}_${uploadSeq}`;
    try {
      const folderId = await resolveBackupFolder(workspaceId, asset.createdAt);
      const item: UploadItem = {
        id: uploadId,
        name: asset.filename,
        uri: asset.uri,
        size: asset.size,
        mime: stagedMime ?? mimeForFilename(asset.filename, asset.mediaType),
        folderId,
        workspaceId,
        status: "uploading",
        progress: 0,
        sourceCreatedAt: asset.createdAt,
        sourceModifiedAt: asset.modifiedAt,
      };
      // Show large (multipart) uploads in the dock too. NOT registered with the
      // completion subscription - this loop owns the item's ledger lifecycle, so
      // registering would double-record. The dock/stats read it from the store.
      useUploadStore.getState().enqueue([item]);
      if (useUploadStore.getState().batchStartedAt == null) {
        useUploadStore.getState().setBatchStartedAt(Date.now());
      }
      // Reuse a session persisted from a prior killed/failed run (if any) so
      // resume is real: status_url reports the parts already stored server-side.
      const row = await getAsset(workspaceId, asset.id);
      const savedSession: ResumableSession | null = row?.mp_session ? JSON.parse(row.mp_session) : null;
      const fileId = await uploadResumable(
        item,
        workspaceId,
        (p) => useUploadStore.getState().patch(uploadId, { progress: p }),
        {
          savedSession,
          onSession: (s) => setMpSession(workspaceId, asset.id, JSON.stringify(s)),
        },
      );
      useUploadStore.getState().patch(uploadId, { status: "done", progress: 1, fileId });
      // Upload is source of truth - flip the ledger FIRST. If recordFingerprint
      // below throws, the asset stays correctly "uploaded" instead of falling
      // into the catch below, which would otherwise mark it "error" AND (if
      // the session were already cleared first) re-init the multipart from
      // part 1, leaking a duplicate large upload.
      await setStatus(workspaceId, asset.id, "uploaded", { remoteFileId: fileId });
      if (fp) {
        try {
          await recordFingerprint(workspaceId, fp, fileId);
        } catch {
          // server-dedup entry missed; same-device guard already holds
        }
      }
      // Clear the session now - the multipart upload completed server-side
      // and the ledger already reflects success.
      await setMpSession(workspaceId, asset.id, null);
      // Queued, not deleted - the whole run is offered to the OS in one prompt
      // below, rather than one confirmation dialog per photo.
      queueDeleteAfterBackup(asset.id);
      useUploadStore.getState().foldSettledBk(); // large uploads fold too - RAM stays flat
      summary.largeUploaded += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("backup.error.largeUploadFailed");
      // The mobile platform switch is off (client.ts already recorded this
      // for MaintenanceScreen the moment the response came back). Not this
      // asset's failure - the server is refusing every gated request right
      // now - so halt the run (the loop's guard above exits before the next
      // large file) without spending one of the asset's five attempts, or
      // counting it in the run's failure tally, on a pause that has nothing
      // to do with the file itself. Checked BEFORE the store is patched: the
      // item must not be shown as a failed upload either. It re-enters the
      // scan untouched next run, and the next scheduled run retries - no
      // upload block, so the background task is not parked until a manual tap.
      if (e instanceof ApiError && e.code === "surface_disabled") {
        haltedForMaintenance = true;
        continue;
      }
      useUploadStore.getState().patch(uploadId, { status: "error", error: msg });
      // A workspace-fatal failure (quota / membership / permission) blocks the
      // run - the loop's guard exits before the next large file, and auto
      // backups stay paused until a manual retry (same as the small-file path).
      if (isFatalUploadError(msg)) {
        useUploadBlock.getState().setReason(msg);
      }
      // Failure - KEEP mp_session (do not clear). The asset re-enters the
      // scan as "error" next runBackup, and uploadResumable will reuse the
      // saved session via status_url, skipping the parts already stored
      // instead of restarting from part 1 and leaking a second session.
      await setStatus(workspaceId, asset.id, "error", { lastError: msg, incAttempts: true });
      summary.largeFailed += 1;
    }
    // Uploaded or failed, this run is finished with the staged copy - drop it
    // so the staging directory does not fill up with files nothing will read
    // again. Best effort: a failed delete just leaves a file behind.
    if (stagedLargeUris.delete(asset.uri)) {
      releaseStagedLarge([asset.uri]);
      await backgroundUploadNative()?.removeStaged([asset.uri]).catch(() => {});
    }
  }
  // Whatever the loop broke before reaching still holds a staged copy, and its
  // ledger row is untouched - the next run stages it again from the library.
  if (stagedLargeUris.size > 0) {
    releaseStagedLarge([...stagedLargeUris]);
    await backgroundUploadNative()?.removeStaged([...stagedLargeUris]).catch(() => {});
    stagedLargeUris.clear();
  }
  // Reset the speed/ETA clock if the whole run (small + large) has drained.
  if (!useUploadStore.getState().items.some((i) => i.status === "uploading" || i.status === "queued")) {
    useUploadStore.getState().setBatchStartedAt(null);
  }

  // One batched OS prompt for everything this run backed up, instead of one per
  // photo. Runs before the history row so a declined prompt is still a
  // completed backup.
  //
  // Only in the foreground. `deleteAssetsAsync` raises an OS confirmation
  // dialog, and a background relaunch (the hourly task, or the few seconds iOS
  // gives the app when a background upload finishes) has nobody to see it: the
  // prompt goes to a screen that is not there, and the call sits unanswered
  // until the OS kills the process - taking the rest of the settle chain with
  // it. The queue is module state and is NOT cleared here, so everything this
  // run backed up is offered in one prompt by the next foreground run.
  if (AppState.currentState === "active") {
    await flushDeleteAfterBackup();
  }

  useBackupRun.getState().setLastUnreadable(summary.unreadable);
  // Before startUpload, which is what arms the drain check: the jobs this run
  // handed to iOS are not in the upload store, so without this count the check
  // would read the run as drained and end it on the spot.
  if (background) {
    let held = 0;
    try { held = await queuedJobCount(); } catch { held = 0; }
    useBackupRun.getState().setBackgroundJobs(held);
  }
  if (summary.enqueued > 0) {
    useBackupRun.getState().startUpload();
    // Everything this run enqueued may already have settled while the scan was
    // still going - in which case no further settle event is coming and the
    // completion subscription, which now ignores drains before this point,
    // would leave the run (and its notification) up forever.
    settleRunIfDrained();
  } else {
    useBackupRun.getState().idle();
  }
  // Only record a history row when the run actually did something - otherwise
  // the hourly background task + debounced media-change events would keep
  // inserting empty "nothing new" rows and flood Recent activity. A manual
  // no-op run still updates "Last run" via the screen's setLastRunAt, so the
  // user still gets feedback - just no clutter row.
  if (summary.enqueued + summary.deduped + summary.largeUploaded + summary.largeFailed + summary.skippedLarge > 0) {
    await recordBackupRun({
      workspace_name: workspaceName ?? null,
      uploaded: summary.enqueued + summary.largeUploaded,
      deduped: summary.deduped,
      skipped_large: summary.skippedLarge,
      failed: summary.largeFailed,
      at: Math.floor(Date.now() / 1000),
    });
  }

  return summary;
}
