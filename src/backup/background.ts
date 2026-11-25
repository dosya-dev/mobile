import { AppState } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import * as MediaLibrary from "expo-media-library";
import { useBackupSettings, resolveBackupDestinations } from "./settings";
import { assetPasses } from "./filters";
import { readPolicyInputs, shouldRunBackup } from "./policy";
import { isAutoWorkHeld } from "@/perf/heatHold";
import { runBackup, isManuallyStopped } from "./orchestrator";
import { settleFinishedJobs, reconcileQueuedRows, queuedJobCount, sweepStagedOrphans } from "./transport/backgroundTransport";
import { useBackupRun } from "./runState";
import type { ScannedAsset } from "./scanner";
import { backgroundUploadNative } from "../../modules/dosya-background-upload";
import { ensureI18n } from "@/lib/i18n";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { getAccessToken } from "@/auth/authStore";
import { useUploadStore } from "@/upload/store";
import { useUploadBlock, hydrateUploadBlock } from "@/upload/uploadBlock";
import { usePacing } from "@/upload/pacing";

export const BACKUP_TASK = "dosya-backup-scan";

export type RunOutcome = "ran" | "skipped-no-auth" | "skipped-blocked" | "skipped-user-stopped" | "skipped-no-workspace" | "skipped-disabled" | "skipped-policy";

/**
 * The single decision point shared by the background task and the media-change
 * listener: run a backup only if auto-backup is on, a workspace is selected, and
 * the network/battery policy allows it.
 */
export async function runBackupIfAllowed(
  targetedAssets?: ScannedAsset[],
  opts: { deadlineMs?: number } = {},
): Promise<RunOutcome> {
  if (!getAccessToken()) return "skipped-no-auth"; // signed out (or session dead) - never attempt a backup
  // Restart-safe: a persisted fatal block (e.g. storage limit) must gate even a
  // headless cold-start run, before the in-memory store has been hydrated.
  await hydrateUploadBlock();
  if (useUploadBlock.getState().reason) return "skipped-blocked"; // a fatal error (e.g. quota) paused auto-backups; a manual run clears it
  if (isManuallyStopped()) return "skipped-user-stopped"; // the user tapped Stop - nothing auto-restarts until they start again
  // Same restart-safety as the block above: a headless run has no React tree,
  // so nothing has read the persisted settings into this process yet. Skipping
  // this leaves `autoBackup` at its in-memory default of false and every
  // periodic run reports "skipped-disabled" - i.e. auto-backup never happens.
  await useBackupSettings.getState().hydrate();
  const settings = useBackupSettings.getState().settings;
  if (!settings.autoBackup) return "skipped-disabled";
  const destinations = resolveBackupDestinations(useWorkspaceStore.getState().activeId, settings);
  if (destinations.length === 0) return "skipped-no-workspace";
  if (isAutoWorkHeld()) return "skipped-policy"; // the next trigger picks it up
  const inputs = await readPolicyInputs();
  if (!shouldRunBackup(settings, inputs).ok) return "skipped-policy";
  // The same reading seeds the live policy hold, so a headless run's first
  // batch is judged on measured state rather than the store's optimistic
  // defaults while the listeners are still warming up.
  usePacing.getState().set({ connected: inputs.connected, onWifi: inputs.onWifi, charging: inputs.charging });
  // A media-change payload names the inserted assets but NOT which album they
  // belong to. With an album filter active there is no way to tell whether an
  // asset is in scope, and guessing is how a filter silently leaks - so drop
  // the targeted shortcut and take the normal incremental scan, which goes
  // through the scanner's album loop.
  const targeted = settings.filters.albumMode === "include" ? undefined : targetedAssets;
  for (const workspaceId of destinations) {
    // Re-check the gates between destinations: a quota block or a manual Stop
    // during workspace A must not roll into workspace B.
    if (useUploadBlock.getState().reason || isManuallyStopped()) break;
    await runBackup(workspaceId, undefined, {
      auto: true,
      // The caller's wall clock, not this run's: a wake-up window is shared by
      // every destination, and staging must stop when the window does.
      ...(opts.deadlineMs ? { deadlineMs: opts.deadlineMs } : {}),
      ...(targeted && targeted.length > 0 ? { targetedAssets: targeted } : {}),
    });
  }
  return "ran";
}

/**
 * Settles are chained, never run in parallel: `settleFinishedJobs` drains the
 * native result buffer, and two drains at once would split one batch of
 * results across two complete-direct calls (or hand the same session to both).
 * Every wake-up path goes through here, so the OS relaunching the app while
 * the user is also foregrounding it is one settle, then the next.
 */
let settleChain: Promise<unknown> = Promise.resolve();

function serializeSettle<T>(fn: () => Promise<T>): Promise<T> {
  const next = settleChain.then(fn, fn);
  // The chain must survive a rejection, or every later settle is dropped.
  settleChain = next.catch(() => {});
  return next;
}

/** Test hook: resolves once every settle queued so far has finished. */
export function __settleIdle(): Promise<unknown> {
  return settleChain;
}

/**
 * What every wake-up does before it plans anything: register what iOS finished
 * while this process was not running (or not looking), then return any row
 * whose job did not survive to pending.
 *
 * Never rejects - a failed settle must not stop the run that follows it.
 */
export function settleBackgroundUploads(): Promise<void> {
  return serializeSettle(settleAndReconcile);
}

/** The body of a settle. Called only from inside the chain - calling
 * `settleBackgroundUploads` from a link of the chain would wait on itself. */
async function settleAndReconcile(): Promise<void> {
  // Android (and Expo Go): nothing was ever handed to the OS, so there is
  // nothing to settle and nothing to reconcile - and no reason to touch the
  // stores on a path that only exists for the iOS background transport.
  if (!backgroundUploadNative()) return;
  // Same gate as runBackupIfAllowed, and for the same reason: a settle
  // registers finished uploads with the API, which a signed-out process (a
  // headless task slot after a sign-out, say) has no session for.
  if (!getAccessToken()) return;
  await settleFinishedJobs().catch(() => {});
  // Which workspaces have a ledger to sweep comes from the persisted settings
  // and the persisted workspace choice: a headless start has no React tree to
  // have read either.
  await useBackupSettings.getState().hydrate().catch(() => {});
  const workspaces = useWorkspaceStore.getState();
  // Only when there is nothing to lose: hydrate() overwrites activeId with
  // what is on disk, and a workspace picked moments ago may not have been
  // persisted yet.
  if (!workspaces.hydrated && !workspaces.activeId) await workspaces.hydrate().catch(() => {});
  await reconcileQueuedRows().catch(() => {});
  // After the rows are healed, not before: reconcile is what returns a row
  // whose job is gone to pending, and a staged copy is only an orphan once no
  // row and no native job names it.
  await sweepStagedOrphans().catch(() => {});
}

/** Backup uploads the in-process engine is still working on. */
function hasLiveBackupUploads(): boolean {
  return useUploadStore.getState().items.some(
    (i) => i.id.startsWith("bk_") && (i.status === "queued" || i.status === "uploading"),
  );
}

/**
 * iOS relaunches the app for a few seconds when background uploads finish.
 * Record what finished, queue the next batch inside that window, and take the
 * run-state card down once nothing is queued.
 *
 * The event payload is never read: events are not buffered while the app is
 * dead (the drained result buffer is), and a result can arrive for a job that
 * was already cancelled. The event is a wake-up, nothing more.
 */
export function startBackgroundUploadEvents(): () => void {
  const native = backgroundUploadNative();
  if (!native) return () => {}; // Android / Expo Go: no background transport at all
  const sub = native.addListener("onJobFinished", () => {
    void serializeSettle(async () => {
      await settleAndReconcile();
      // A short budget: the relaunch window is seconds, and staging that
      // overruns it is killed mid-export.
      await runBackupIfAllowed(undefined, { deadlineMs: Date.now() + 20_000 });
      // The card comes down only when nothing is left ANYWHERE: an in-process
      // run (a manual backup, or a workspace the transport cannot serve) keeps
      // its own items in the upload store, and taking its card down would
      // leave a live run with no UI.
      const remaining = await queuedJobCount();
      useBackupRun.getState().setBackgroundJobs(remaining);
      if (remaining === 0 && !hasLiveBackupUploads()) useBackupRun.getState().idle();
    }).catch(() => {});
  });
  return () => sub.remove();
}

let taskDefined = false;

// Register the task handler. Idempotent: safe to call more than once. Invoked at
// module load (below) so the OS can run the handler after a cold start, before
// React mounts - per Expo TaskManager guidance for headless execution.
export function defineBackupTask(): void {
  if (taskDefined) return;
  taskDefined = true;
  TaskManager.defineTask(BACKUP_TASK, async () => {
    // Headless: no React tree has booted the language, and the run may post a
    // local notification. Never rejects.
    await ensureI18n();
    try {
      // First: the results of the jobs the LAST slot queued. Planning before
      // settling would read a ledger still full of rows whose uploads have
      // already finished, and would stage against a full staging directory.
      await settleBackgroundUploads();
      // The OS budget for this slot. Staging exports iCloud originals, so a
      // run with no deadline would still be exporting when the task is killed.
      await runBackupIfAllowed(undefined, { deadlineMs: Date.now() + 120_000 });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackupTask(): Promise<void> {
  // minimumInterval is in minutes for expo-background-task; the OS decides the
  // actual cadence (Android WorkManager / iOS BGTaskScheduler). 15 is
  // WorkManager's floor for a periodic job - asking for less is silently
  // rounded up, and asking for more just delays the catch-up for a user who
  // left the app closed. Runs are cheap when there is nothing new: the ledger
  // makes an idle scan a no-op.
  await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 15 });
}

export async function unregisterBackupTask(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(BACKUP_TASK);
}

let debounce: ReturnType<typeof setTimeout> | null = null;
let pendingInserted: ScannedAsset[] | null = null;
let insertedUnknown = false;

function mapInsertedAssets(assets: MediaLibrary.Asset[] | undefined): ScannedAsset[] | null {
  if (!assets || assets.length === 0) return null;
  // This is the THIRD place assets enter the pipeline (after the full scan and
  // the incremental scan) and the only one that never touches the scanner, so
  // the filters have to be applied here by hand or a brand-new photo bypasses
  // every one of them.
  const filters = useBackupSettings.getState().settings.filters;
  return assets
    .filter((a) => a.mediaType === MediaLibrary.MediaType.photo || a.mediaType === MediaLibrary.MediaType.video)
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      createdAt: Math.floor((a.creationTime ?? 0) / 1000),
      modifiedAt: Math.floor((a.modificationTime ?? 0) / 1000),
      mediaType: a.mediaType === MediaLibrary.MediaType.video ? "video" as const : "photo" as const,
    }))
    .filter((a) => assetPasses(a, filters));
}

/**
 * Live capture: while the app is active, re-run a gated backup shortly after the
 * media library changes (new photo/video). Debounced so a burst of inserts
 * triggers a single run. On Android the event payload is `{}`; on iOS it carries
 * incremental asset lists - either way we just re-run the gated orchestrator.
 */
export function startMediaChangeListener(delayMs = 2000): () => void {
  const sub = MediaLibrary.addListener((event) => {
    // iOS names exactly what was inserted - accumulate the burst so the run
    // processes just those assets with NO library scan. Any event without a
    // payload (Android, or iOS "changes too large") poisons the burst back to
    // a normal incremental run.
    const mapped = mapInsertedAssets((event as { insertedAssets?: MediaLibrary.Asset[] }).insertedAssets);
    if (mapped === null) insertedUnknown = true;
    else pendingInserted = [...(pendingInserted ?? []), ...mapped];
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const targeted = !insertedUnknown && pendingInserted && pendingInserted.length > 0 ? pendingInserted : undefined;
      pendingInserted = null;
      insertedUnknown = false;
      void runBackupIfAllowed(targeted);
    }, delayMs);
  });
  return () => {
    if (debounce) { clearTimeout(debounce); debounce = null; }
    pendingInserted = null;
    insertedUnknown = false;
    sub.remove();
  };
}

/**
 * Every in-app auto-backup trigger, for the whole signed-in session.
 *
 * Previously the media-library listener was started by the Backup TAB's focus
 * effect, so a new photo was only ever picked up while the user happened to be
 * looking at that one screen. Auto-backup is a background promise, not a
 * feature of a screen - this belongs at the root.
 *
 * Three triggers:
 * - media library changed -> a debounced gated run (new photo/video)
 * - app returned to the foreground -> a settle, then a catch-up run,
 *   reconciling anything the OS did not give us a periodic slot for while we
 *   were closed
 * - a background upload finished -> a settle and a short top-up inside the
 *   window iOS relaunched us for (iOS only; a no-op without the native module)
 *
 * Both funnel through runBackupIfAllowed, so every gate (signed in, auto-backup
 * on, not manually stopped, policy) still applies. Returns a dispose function.
 */
export function startAutoBackupTriggers(): () => void {
  const disposeMedia = startMediaChangeListener();
  const disposeEvents = startBackgroundUploadEvents();
  const sub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    // Settle first: while the app was away iOS may have finished jobs, and the
    // catch-up must plan against what is actually left.
    void settleBackgroundUploads().then(() => runBackupIfAllowed()).catch(() => {});
  });
  return () => {
    disposeMedia();
    disposeEvents();
    sub.remove();
  };
}

// Define at module scope (global) - do not wait for a component to mount.
defineBackupTask();
