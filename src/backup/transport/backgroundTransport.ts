import {
  backgroundUploadNative, STAGING_MAX_BYTES, STAGING_MAX_FILES,
  type Job, type StageFailure, type StagedFile,
} from "../../../modules/dosya-background-upload";
import {
  listPlannable, listByStatus, markQueued, setStatus, getByJobIds, requeueToPending,
  upsertAsset, markPairChecked, getAssetsBulk, bumpAttempts, distinctWorkspaceIds,
  listUploadedUnpaired, retireExhausted, type LedgerRow,
} from "../ledger";
import { initBatch, completeDirect, DirectUnavailableError, isInitBatchOutage, type InitBatchEntry } from "../directApi";
import { computeFingerprint } from "../fingerprint";
import { checkFingerprints } from "../api";
import { resolveBackupFolder } from "../folders";
import { livePhotoLedgerId, isLivePhotoLedgerId } from "../livePhoto";
import { queueDeleteAfterBackup } from "../cleanup";
import { hasPhotoAccess } from "../scanner";
import { useBackupSettings } from "../settings";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useUploadBlock } from "@/upload/uploadBlock";
import { t } from "@/lib/i18n";
import { isFatalUploadError } from "@/upload/controller";
import { localDigits } from "@/lib/format-locale";

/** Same thresholds as the orchestrator; imported values would create a cycle. */
const MAX_SINGLE_SHOT = 50 * 1024 * 1024;
const MAX_BACKUP_ATTEMPTS = 5;
/** Files staged per native call: bounded so a 20-second relaunch window still
 * gets a batch out, and so a deadline is checked between calls. Staging runs
 * the exports sequentially - one iCloud original can take tens of seconds - so
 * this stays small, and the deadline is looked at that much more often. */
const STAGE_CHUNK = 10;
/** The API refuses more than this many entries in one init-batch or
 * complete-direct call, and `initBatch` silently slices to it - so the batch
 * is cut here, where the leftovers still get their own call. */
const BATCH_MAX = 200;
/** How many settles a finished session may go without the API acknowledging
 * its object before the upload is given up on and retried from scratch. */
const AWAITING_MAX_ASKS = 10;
/** Stills already backed up that one batch may ask "are you a Live Photo?".
 * Each is a native probe and, for a real pair, an export and an upload, so a
 * big library is caught up over many batches rather than one very long one. */
const LIVE_PHOTO_BACKFILL_PER_RUN = 25;

export interface StageBudget {
  /** Date.now() past which no new staging starts. */
  deadlineMs: number;
}

/** A staged file too big for one PUT: the caller uploads it in-process from
 * `path`, which is the staged copy, not the library asset. */
export interface LargeStagedFile {
  localId: string;
  path: string;
  size: number;
  filename: string;
  /** The type PhotoKit gave the exported file: the extension can lie (a HEVC
   * export of a `.bin`-named asset), so the caller uploads with this. */
  mime: string;
  createdAt: number;
}

export interface BatchOutcome {
  queued: number;
  deduped: number;
  unreadable: number;
  skippedLarge: number;
  large: LargeStagedFile[];
  /**
   * Nothing more can be planned for this workspace right now: either the
   * staging directory has no room left, or the ledger handed back fewer
   * plannable rows than were asked for and every one of them was attempted.
   * False whenever rows were left unstaged (deadline, upload block, staging
   * budget), since those are still plannable this second.
   */
  exhausted: boolean;
  /** Pending rows past the attempt cap flipped to `error` before planning,
   * so they show on the Failed screen instead of hiding in the queue. */
  retired?: number;
}

/** Remembered for the process once the server says the workspace cannot use
 * the direct transport (EU bucket); the orchestrator falls back for it. */
const unavailableWorkspaces = new Set<string>();

/**
 * Consecutive `init-batch` calls that could not be answered at all (5xx, or no
 * response), per workspace. Reset by the first call that IS answered.
 *
 * Without this a direct endpoint that is down leaves backup doing nothing at
 * all: every run stages a batch, fails to open sessions for it, throws away
 * the staged copies and ends - while the in-process uploader, which talks to a
 * different route, would have worked the whole time. At the third strike the
 * workspace is marked unavailable for the process and the next `runBackup`
 * takes the in-process path.
 */
const initFailures = new Map<string, number>();
const INIT_OUTAGE_STRIKES = 3;

/**
 * Sessions iOS has finished but the API could not yet register, mapped to how
 * many settles have asked about them without an answer.
 *
 * They matter because `drain()` hands a result out exactly once: the row would
 * otherwise sit `queued` forever with nothing left to re-drain. Every
 * `settleFinishedJobs` folds these back into its own complete-direct batch,
 * and gives up on one after `AWAITING_MAX_ASKS` tries.
 */
const awaitingObject = new Map<string, number>();

/**
 * One batch at a time PER WORKSPACE: a second caller for the same workspace
 * (the media-change listener firing while the background task runs) joins the
 * batch in flight instead of planning a second one over the same rows.
 *
 * Keyed by workspace, because the guard is not a lock on the device: a run for
 * another workspace would otherwise be handed an outcome planned over rows
 * that are not its own. The joiner gets that outcome with `large` emptied -
 * the staged large files belong to the caller that planned them, and two
 * callers uploading one staged path in parallel would race two multiparts and
 * delete the file out from under each other.
 */
const inFlight = new Map<string, Promise<BatchOutcome>>();

/**
 * Staged copies handed to a caller in `large` and not yet given back.
 *
 * They have no `queued` ledger row (the row stays pending until the caller's
 * multipart upload finishes), so nothing else in the ledger can name them and
 * `sweepStagedOrphans` would read them as abandoned and delete the file out
 * from under a multipart upload that can run for minutes. The caller releases
 * them with `releaseStagedLarge` when it is done with the copy.
 */
const heldLargePaths = new Set<string>();

/** The caller is finished with staged copies it was handed in `large`: they
 * are orphans from here on and the sweep may take them. */
export function releaseStagedLarge(paths: string[]): void {
  for (const p of paths) heldLargePaths.delete(p);
}

/**
 * One settle at a time, for the whole process.
 *
 * `drain()` hands each result out exactly once, so two settles running
 * together would split one batch of results across two complete-direct calls -
 * and the second would find `awaitingObject` mid-update. The callers cannot
 * arrange this between themselves: the wake-up paths chain their settles in
 * `background.ts`, but `runBackup` settles on its own account too, so the
 * guard has to live here, with the drain.
 */
let settleChain: Promise<unknown> = Promise.resolve();

/** Test hook: a fresh process. Not used in app code. */
export function __resetTransportState(): void {
  unavailableWorkspaces.clear();
  awaitingObject.clear();
  inFlight.clear();
  heldLargePaths.clear();
  initFailures.clear();
  settleChain = Promise.resolve();
}

/** `livePhotoLedgerId` appends a fixed suffix; this takes it back off. */
const PAIR_SUFFIX = livePhotoLedgerId("");

/** The library asset id behind a ledger key (a pair's key names its still). */
function assetIdOf(ledgerId: string): string {
  return isLivePhotoLedgerId(ledgerId) ? ledgerId.slice(0, ledgerId.length - PAIR_SUFFIX.length) : ledgerId;
}

/**
 * The ledger key for a staged file. A Live Photo's paired video is staged
 * under its still's local id plus `kind`, but it gets its own ledger row (and
 * its own `client_ref`) so it dedupes, retries and reports like any other
 * asset.
 */
function ledgerKey(f: { localId: string; kind: "original" | "pairedVideo" }): string {
  return f.kind === "pairedVideo" ? livePhotoLedgerId(f.localId) : f.localId;
}

/** What a plannable row asks the native side to stage: a `#video` row is a
 * paired video being retried on its own, not a library asset id. */
function stageRequestFor(row: LedgerRow): { localId: string; kind: "original" | "pairedVideo" } {
  return isLivePhotoLedgerId(row.local_id)
    ? { localId: assetIdOf(row.local_id), kind: "pairedVideo" }
    : { localId: row.local_id, kind: "original" };
}

/** Staging stops on these: the directory is full, or the device is. */
function haltsStaging(failed: StageFailure[]): boolean {
  return failed.some((f) => f.reason === "budget" || f.reason === "nospace");
}

export function backgroundTransportAvailable(workspaceId?: string): boolean {
  if (!backgroundUploadNative()) return false;
  if (!useBackupSettings.getState().settings.backgroundTransport) return false;
  return !(workspaceId && unavailableWorkspaces.has(workspaceId));
}

export async function queuedJobCount(): Promise<number> {
  const native = backgroundUploadNative();
  if (!native) return 0;
  return (await native.pending()).filter((j) => j.state === "queued" || j.state === "running").length;
}

/**
 * One batch: the oldest plannable rows that fit the staging budget are
 * staged, fingerprinted, deduped against the server, opened as direct
 * sessions and handed to iOS. Returns what it did and, in `large`, the staged
 * files over the single-shot cap, which the orchestrator's existing multipart
 * loop uploads in-process (their staged path is the upload source).
 *
 * Concurrent callers share one batch: planning twice over the same rows would
 * stage every file a second time.
 */
export function queueNextBatch(workspaceId: string, budget: StageBudget): Promise<BatchOutcome> {
  const joined = inFlight.get(workspaceId);
  if (joined) return joined.then((o) => ({ ...o, large: [] }));
  const run = planNextBatch(workspaceId, budget)
    // Only the paths that actually reach a caller are held: an outcome that
    // never returns (a throw) has already removed its staged copies.
    .then((o) => { for (const l of o.large) heldLargePaths.add(l.path); return o; })
    .finally(() => { if (inFlight.get(workspaceId) === run) inFlight.delete(workspaceId); });
  inFlight.set(workspaceId, run);
  return run;
}

async function planNextBatch(workspaceId: string, budget: StageBudget): Promise<BatchOutcome> {
  const out: BatchOutcome = { queued: 0, deduped: 0, unreadable: 0, skippedLarge: 0, large: [], exhausted: false };
  const native = backgroundUploadNative();
  if (!native) return out;
  // Without photo access PhotoKit answers `unreadable` for every asset, which
  // would burn an attempt on each row and retire the whole library at the cap.
  if (!(await hasPhotoAccess())) return out;

  // Ownership of every staged byte, so no path can be left behind by a throw:
  // a staged copy is either queued against a ledger row, handed back in
  // `large`, or removed.
  const stagedPaths = new Set<string>();
  const queuedPaths = new Set<string>();
  const removedPaths = new Set<string>();
  const remove = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => !removedPaths.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) removedPaths.add(p);
    await native.removeStaged(fresh);
  };

  try {
    const settings = useBackupSettings.getState().settings;
    const usage = await native.stagingUsage();
    const roomFiles = Math.max(0, STAGING_MAX_FILES - usage.files);
    if (roomFiles === 0 || usage.bytes >= STAGING_MAX_BYTES) {
      // Nothing more can go out until the jobs in flight settle and free room.
      out.exhausted = true;
      return out;
    }

    // Halved against the staging room: every still may bring a paired video
    // with it, and one init-batch call carries at most BATCH_MAX entries.
    const requested = Math.min(roomFiles, BATCH_MAX / 2);
    // Anything that has used up its tries stops hiding in `pending`: it
    // becomes a visible failure the user can retry from the Failed screen.
    const retired = await retireExhausted(workspaceId, MAX_BACKUP_ATTEMPTS);
    if (retired > 0) out.retired = (out.retired ?? 0) + retired;
    const rows = await listPlannable(workspaceId, requested, MAX_BACKUP_ATTEMPTS);
    const rowByKey = new Map(rows.map((r) => [r.local_id, r]));

    const staged: StagedFile[] = [];
    /** Ledger key -> the plannable row it came from (a pair staged alongside
     * its still shares the still's row until it has one of its own). */
    const rowFor = new Map<string, LedgerRow>();
    /** Rows this call actually asked the native side to stage. */
    let attempted = 0;

    /**
     * Stage the paired videos of the stills just staged, in a SECOND native
     * call - `stage` keys its results by (localId, kind), so a still and its
     * video never share a request list.
     *
     * A still whose pair row already exists is not probed: that row is planned
     * on its own, like any other asset. A pair that fails to stage is not an
     * error - it just means the still is not a Live Photo - but the still is
     * marked probed either way so the next run does not ask again.
     */
    const stagePairedVideos = async (justStaged: StagedFile[]): Promise<boolean> => {
      const stills = justStaged.filter((f) => f.kind === "original" && f.mime.startsWith("image/"));
      if (stills.length === 0) return false;
      const existing = await getAssetsBulk(workspaceId, stills.map((f) => livePhotoLedgerId(f.localId)));
      const probe = stills.filter((f) => !existing.has(livePhotoLedgerId(f.localId)));
      if (probe.length === 0) return false;
      const res = await native.stage(probe.map((f) => ({ localId: f.localId, kind: "pairedVideo" as const })));
      for (const f of res.staged) {
        stagedPaths.add(f.path);
        const still = rowByKey.get(f.localId);
        if (!still) continue;
        const pairedId = livePhotoLedgerId(f.localId);
        await upsertAsset({
          workspace_id: workspaceId, local_id: pairedId, filename: f.filename,
          size: f.size, created_at: still.created_at,
        });
        rowFor.set(pairedId, still);
        staged.push(f);
      }
      if (res.failed.some((f) => f.reason === "nospace")) {
        useUploadBlock.getState().setReasonMessage("backup.error.notEnoughFreeSpaceOnThisDeviceToStageTheNextPhotos");
      }
      noteInconclusive(res.failed);
      for (const f of probe) if (!probeInconclusive.has(f.localId)) await markPairChecked(workspaceId, f.localId);
      return haltsStaging(res.failed);
    };

    /**
     * Which probed stills got no answer this time. `budget` and `nospace` say
     * the staging directory or the device was full, not that the still has no
     * motion half - marking those `pair_checked` lost the pair for good, since
     * a checked still is never asked again. They stay unmarked and are probed
     * by a later batch, once there is room.
     */
    const probeInconclusive = new Set<string>();
    const noteInconclusive = (failed: StageFailure[]): void => {
      for (const f of failed) if (f.reason === "budget" || f.reason === "nospace") probeInconclusive.add(f.localId);
    };

    /**
     * Live Photo backfill for stills that are already backed up.
     *
     * An `uploaded` row is invisible to `listPlannable`, which returns pending
     * rows only, so a still uploaded before pairing existed (or by the
     * in-process path, which probes on its own schedule) would never be asked
     * whether it has a motion half - and that half would be lost for good. The
     * in-process runner has had this pass since pairing shipped; the
     * background transport never did.
     *
     * Bounded per call: a relaunch window is seconds long, and each probe is a
     * native call plus, for a real Live Photo, an export and an upload. The
     * rest is picked up by the next batch, since only probed stills are marked.
     *
     * Whatever this stages joins `staged`/`rowFor` and goes through the same
     * cap, dedup, init-batch and enqueue path as everything else in the batch.
     */
    const backfillLivePhotoPairs = async (stagingHalted: boolean): Promise<void> => {
      if (stagingHalted || Date.now() > budget.deadlineMs || useUploadBlock.getState().reason) return;
      // Only as many stills as the staging directory still has room for: a
      // probe that comes back `budget` is no answer, and asking for it just
      // burns the native call.
      const room = roomFiles - staged.length;
      if (room <= 0) return;
      const stills = await listUploadedUnpaired(workspaceId, Math.min(LIVE_PHOTO_BACKFILL_PER_RUN, room));
      if (stills.length === 0) return;
      // A pair row that already exists is planned on its own like any other
      // asset; staging it here as well would upload the video twice.
      const existing = await getAssetsBulk(workspaceId, stills.map((r) => livePhotoLedgerId(r.local_id)));
      const probe = stills.filter((r) => !existing.has(livePhotoLedgerId(r.local_id)));
      if (probe.length === 0) return;
      const res = await native.stage(probe.map((r) => ({ localId: r.local_id, kind: "pairedVideo" as const })));
      const stillById = new Map(probe.map((r) => [r.local_id, r]));
      for (const f of res.staged) {
        stagedPaths.add(f.path);
        const still = stillById.get(f.localId);
        if (!still) continue;
        const pairedId = livePhotoLedgerId(f.localId);
        // The pair takes its still's capture date, so it lands in the same
        // month folder, beside the photo it belongs to.
        await upsertAsset({
          workspace_id: workspaceId, local_id: pairedId, filename: f.filename,
          size: f.size, created_at: still.created_at,
        });
        rowFor.set(pairedId, still);
        staged.push(f);
      }
      if (res.failed.some((f) => f.reason === "nospace")) {
        useUploadBlock.getState().setReasonMessage("backup.error.notEnoughFreeSpaceOnThisDeviceToStageTheNextPhotos");
      }
      // Marked whether or not a pair turned up: a still that is not a Live
      // Photo must not be probed again on every run for the rest of time.
      // Unless the probe itself never got an answer (see `noteInconclusive`).
      noteInconclusive(res.failed);
      for (const r of probe) if (!probeInconclusive.has(r.local_id)) await markPairChecked(workspaceId, r.local_id);
    };

    /** Set when staging stopped because the directory or the device is full. */
    let halted = false;
    for (let i = 0; i < rows.length; i += STAGE_CHUNK) {
      if (Date.now() > budget.deadlineMs || useUploadBlock.getState().reason) break;
      const chunk = rows.slice(i, i + STAGE_CHUNK);
      attempted += chunk.length;
      const res = await native.stage(chunk.map(stageRequestFor));
      for (const f of res.failed) {
        const key = ledgerKey(f);
        if (f.reason === "empty") {
          await setStatus(workspaceId, key, "error", { lastError: t("backup.error.thisFileIsEmptyOnThisDevice"), incAttempts: true });
        } else if (f.reason === "nospace") {
          useUploadBlock.getState().setReasonMessage("backup.error.notEnoughFreeSpaceOnThisDeviceToStageTheNextPhotos");
        } else if (f.reason === "unreadable") {
          // Stays PENDING (an iCloud original that would not download this
          // time may well download the next), but the try is charged: with
          // `listPlannable` ordering by attempts, the row falls behind the
          // untried ones instead of taking a slot in every batch, and a
          // permanently unreadable asset retires at MAX_BACKUP_ATTEMPTS
          // rather than blocking the queue for good.
          await bumpAttempts(workspaceId, key, t("backup.error.couldNotReadThisItemFromTheLibrary"));
        }
        // `budget` and `nospace` are the staging directory or the device
        // filling up, not a problem with the asset: it is planned again,
        // unchanged, by the next batch.
        if (f.reason !== "budget" && f.reason !== "nospace") out.unreadable += 1;
      }
      for (const f of res.staged) {
        stagedPaths.add(f.path);
        const row = rowByKey.get(ledgerKey(f));
        if (!row) continue;
        rowFor.set(ledgerKey(f), row);
        staged.push(f);
      }
      // Out of staging room or device space: staging more (a paired video
      // included) can only fail, so stop and send what is in hand.
      if (haltsStaging(res.failed)) { halted = true; break; }
      if (await stagePairedVideos(res.staged)) { halted = true; break; }
    }
    // "Nothing left to plan" only holds if every row that came back was
    // actually attempted: rows left behind by the deadline are plannable now.
    out.exhausted = attempted === rows.length && rows.length < requested;
    await backfillLivePhotoPairs(halted);
    if (staged.length === 0) return out;

    // Size cap and single-shot split now that sizes are known.
    const candidates: StagedFile[] = [];
    const toDiscard: string[] = [];
    for (const f of staged) {
      const key = ledgerKey(f);
      const row = rowFor.get(key);
      // Staged for something this batch is not planning (it cannot happen from
      // the calls above, but a staged copy nobody owns must never be left
      // holding container bytes).
      if (!row) { toDiscard.push(f.path); continue; }
      if (settings.filters.maxBytes != null && f.size > settings.filters.maxBytes) {
        // `size` on every branch that ends a row's life without queueing it:
        // the seeded row carries 0 (a scan cannot know byte counts), and
        // pendingTotals and reclaim.ts both sum this column.
        await setStatus(workspaceId, key, "skipped_large", { lastError: t("backup.label.largerThanYourMaxBytesByteLimit", { maxBytes: localDigits(settings.filters.maxBytes) }), size: f.size });
        out.skippedLarge += 1; toDiscard.push(f.path); continue;
      }
      if (f.size > MAX_SINGLE_SHOT) {
        // Handed back staged: the caller uploads it from `path` and owns both
        // the ledger row and the staged copy from here on.
        out.large.push({ localId: key, path: f.path, size: f.size, filename: f.filename, mime: f.mime, createdAt: row.created_at });
        continue;
      }
      candidates.push(f);
    }

    // The deadline covers the whole call, not just the staging loop.
    // Fingerprinting reads every staged byte back off disk and the init-batch
    // calls are network round trips, so the window can close here just as
    // easily - and when it does the process is killed outright, mid-write.
    // Nothing is queued yet at this point, so stop and drop the staged copies
    // rather than leave them for a run that will stage them again anyway.
    // `out.large` is kept: the caller owns those, uploads them in-process
    // where no relaunch window applies, and removes them itself.
    if (Date.now() > budget.deadlineMs) {
      out.exhausted = false;
      await remove([...toDiscard, ...candidates.map((f) => f.path)]);
      return out;
    }

    // Fingerprint + server dedup, exactly as the in-process path does.
    const fps = new Map<string, string>();
    for (const f of candidates) {
      try { fps.set(ledgerKey(f), await computeFingerprint(f.path, f.size)); } catch { /* unfingerprinted: uploads anyway */ }
    }
    const fpList = Array.from(new Set(fps.values()));
    const existing = fpList.length > 0 ? await checkFingerprints(workspaceId, fpList) : {};
    const entries: InitBatchEntry[] = [];
    const byRef = new Map<string, StagedFile>();
    for (const f of candidates) {
      const key = ledgerKey(f);
      const fp = fps.get(key);
      if (fp && existing[fp]) {
        await setStatus(workspaceId, key, "uploaded", { remoteFileId: existing[fp], fingerprint: fp, size: f.size });
        out.deduped += 1; toDiscard.push(f.path); continue;
      }
      // The pair shares its still's capture date, so it resolves to the same
      // month folder and the two land side by side.
      const folderId = await resolveBackupFolder(workspaceId, rowFor.get(key)!.created_at);
      entries.push({
        client_ref: key,
        file_name: f.filename,
        file_size: f.size,
        mime_type: f.kind === "pairedVideo" ? "video/quicktime" : f.mime,
        folder_id: folderId,
      });
      byRef.set(key, f);
    }
    if (toDiscard.length > 0) await remove(toDiscard);
    if (entries.length === 0) return out;

    for (let i = 0; i < entries.length; i += BATCH_MAX) {
      // Between slices too: each one is its own round trip, and the slices
      // already sent have their jobs with iOS, which finish on their own.
      // Everything from here on has no session and no job, so its rows stay
      // pending and its staged copies go.
      if (Date.now() > budget.deadlineMs) {
        out.exhausted = false;
        await remove(entries.slice(i).map((en) => byRef.get(en.client_ref)!.path));
        break;
      }
      const slice = entries.slice(i, i + BATCH_MAX);
      let opened: Awaited<ReturnType<typeof initBatch>>;
      try {
        opened = await initBatch(workspaceId, slice);
        // Answered: whatever it said, the endpoint is reachable.
        initFailures.delete(workspaceId);
      } catch (e) {
        if (!(e instanceof DirectUnavailableError)) {
          if (isInitBatchOutage(e)) {
            const strikes = (initFailures.get(workspaceId) ?? 0) + 1;
            initFailures.set(workspaceId, strikes);
            // Three in a row: stop staging batches nothing can open and let
            // the orchestrator's in-process uploader carry this workspace for
            // the rest of the process. The staged copies this call is holding
            // are dropped by the catch below, as for any other throw.
            if (strikes >= INIT_OUTAGE_STRIKES) unavailableWorkspaces.add(workspaceId);
          } else {
            // A real answer, just an unwelcome one: not an outage.
            initFailures.delete(workspaceId);
          }
          throw e;
        }
        // Not a failure of these assets: this workspace cannot use the direct
        // transport at all. Hand the outcome back rather than throwing, so the
        // orchestrator's loop simply stops and falls back to the in-process
        // runner - which means giving up every staged copy this call still
        // owns, `large` included (the caller never gets to act on it).
        unavailableWorkspaces.add(workspaceId);
        await remove([...entries.slice(i).map((en) => byRef.get(en.client_ref)!.path), ...out.large.map((l) => l.path)]);
        // `out.queued` is 0 in practice: the verdict is workspace-wide, so it
        // lands on the first slice. Anything an earlier slice really did queue
        // stays counted rather than being reported as never having happened.
        out.large = [];
        return out;
      }
      const answered = new Set<string>();
      const discard: string[] = [];
      for (const r of opened.refused) {
        const f = byRef.get(r.client_ref);
        if (!f) continue;
        answered.add(r.client_ref);
        await setStatus(workspaceId, ledgerKey(f), "error", { lastError: r.error, incAttempts: true, size: f.size });
        discard.push(f.path);
        if (isFatalUploadError(r.error)) useUploadBlock.getState().setReason(r.error);
      }
      const jobs: Job[] = [];
      for (const u of opened.uploads) {
        const f = byRef.get(u.client_ref);
        if (!f) continue;
        answered.add(u.client_ref);
        jobs.push({ jobId: u.session_id, path: f.path, url: u.url, headers: u.headers });
      }
      // Neither opened nor refused: the row stays pending for the next batch,
      // so its staged copy goes rather than sitting there until the app is
      // deleted.
      for (const en of slice) if (!answered.has(en.client_ref)) discard.push(byRef.get(en.client_ref)!.path);
      if (discard.length > 0) await remove(discard);
      if (jobs.length === 0) continue;

      // Ledger BEFORE enqueue: a job can finish and be drained the instant it
      // is handed over, and a result with no `queued` row is ignored for good.
      // A row queued for a job that was never enqueued is the recoverable
      // direction - `cancelQueuedJobs` sweeps it back to pending.
      for (const u of opened.uploads) {
        const f = byRef.get(u.client_ref);
        if (!f) continue;
        const key = ledgerKey(f);
        await markQueued(workspaceId, key, {
          sessionId: u.session_id, jobId: u.session_id, stagedPath: f.path,
          fingerprint: fps.get(key) ?? null, size: f.size,
        });
        queuedPaths.add(f.path);
        out.queued += 1;
      }
      await native.enqueue(jobs, !settings.wifiOnly);
    }
    return out;
  } catch (e) {
    // The outcome never reaches the caller, so nothing else will ever look at
    // the staged copies this call was holding - `large` included.
    const orphans = [...stagedPaths].filter((p) => !queuedPaths.has(p) && !removedPaths.has(p));
    if (orphans.length > 0) {
      try { await native.removeStaged(orphans); } catch { /* best effort: the throw below is the real news */ }
    }
    throw e;
  }
}

/**
 * Everything iOS has finished since the last call: register the successes,
 * return the failures to pending, delete every staged copy that is no longer
 * needed. Safe to call at any time (drain is idempotent, complete-direct is
 * idempotent), so it runs on launch, on foreground, on every job event and
 * from the background task.
 *
 * `drain()` is the source of truth, not the `onJobFinished` event: events are
 * not buffered while the app is dead, the drained buffer is.
 *
 * Concurrent callers are queued behind one another (see `settleChain`), so a
 * manual run settling mid-flight cannot drain into a wake-up's settle.
 */
export function settleFinishedJobs(): Promise<{ uploaded: number; requeued: number }> {
  const next = settleChain.then(runSettle, runSettle);
  // The chain must survive a rejection, or every later settle is dropped.
  settleChain = next.catch(() => {});
  return next;
}

async function runSettle(): Promise<{ uploaded: number; requeued: number }> {
  const out = { uploaded: 0, requeued: 0 };
  const native = backgroundUploadNative();
  if (!native) return out;
  const results = await native.drain();
  if (results.length === 0 && awaitingObject.size === 0) return out;

  // A job id IS its session id (see `queueNextBatch`), so one lookup answers
  // both the drained results and the sessions still awaiting their object.
  const rows = await getByJobIds(Array.from(new Set([...results.map((r) => r.jobId), ...awaitingObject.keys()])));
  const rowByJob = new Map(rows.map((r) => [r.job_id as string, r]));
  const toComplete: LedgerRow[] = [];
  const inBatch = new Set<string>();
  const failed: { row: LedgerRow; error: string }[] = [];

  for (const r of results) {
    const row = rowByJob.get(r.jobId);
    // No row (the ledger was purged on sign-out) or no longer queued (JS
    // cancelled the job, or already settled it, while iOS was finishing it):
    // there is nothing this result may still change.
    if (!row || row.status !== "queued") continue;
    if (!r.ok) {
      // An `invalid job:` error arrives here too - a bad URL or header set is
      // a failure like any other, and the retry re-opens a fresh session.
      failed.push({ row, error: r.error ?? t("backup.label.httpHttpStatus", { httpStatus: String(r.httpStatus ?? 0) }) });
      continue;
    }
    const sessionId = row.session_id;
    if (!sessionId || inBatch.has(sessionId)) continue;
    inBatch.add(sessionId);
    toComplete.push(row);
  }
  for (const sessionId of [...awaitingObject.keys()]) {
    const row = rowByJob.get(sessionId);
    if (!row || row.status !== "queued") { awaitingObject.delete(sessionId); continue; }
    if (inBatch.has(sessionId)) continue;
    inBatch.add(sessionId);
    toComplete.push(row);
  }

  const toRemove: string[] = [];
  /** A session the API did not account for this time: ask again next settle,
   * or give up on it once it has had enough tries. */
  const keepAwaiting = async (row: LedgerRow): Promise<void> => {
    const sessionId = row.session_id as string;
    const asks = (awaitingObject.get(sessionId) ?? 0) + 1;
    if (asks < AWAITING_MAX_ASKS) { awaitingObject.set(sessionId, asks); return; }
    // The object never turned up. Upload it again rather than leaving the
    // asset queued against a session nothing will ever register.
    awaitingObject.delete(sessionId);
    // Charged, unlike Stop and a relaunch sweep: a 2xx PUT whose object never
    // turns up is a captive portal, a proxy or a bucket mismatch, and without
    // a charge the asset re-uploads its full bytes forever with nothing shown.
    await requeueToPending(row.workspace_id, row.local_id, t("backup.error.objectNeverRegistered"));
    if (row.staged_path) toRemove.push(row.staged_path);
    out.requeued += 1;
  };

  for (let i = 0; i < toComplete.length; i += BATCH_MAX) {
    // Chunked here rather than inside `completeDirect`: a throw part-way
    // through its own chunking would lose the earlier chunks' answers.
    const slice = toComplete.slice(i, i + BATCH_MAX);
    const bySession = new Map(slice.map((row) => [row.session_id as string, row]));
    let answer: Awaited<ReturnType<typeof completeDirect>>;
    try {
      answer = await completeDirect(slice.map((row) => ({
        session_id: row.session_id as string, fingerprint: row.fingerprint ?? null,
        source_created_at: row.created_at, source_modified_at: row.created_at,
      })));
    } catch {
      // The drained results are already consumed, so remember these sessions
      // rather than stranding finished uploads. One failing chunk must not
      // cost the other chunks their ledger writes.
      for (const row of slice) await keepAwaiting(row);
      continue;
    }
    const answered = new Set<string>();
    for (const c of answer.completed) {
      const row = bySession.get(c.session_id);
      if (!row) continue;
      answered.add(c.session_id);
      awaitingObject.delete(c.session_id);
      await setStatus(row.workspace_id, row.local_id, "uploaded", { remoteFileId: c.file_id });
      queueDeleteAfterBackup(row.local_id);
      if (row.staged_path) toRemove.push(row.staged_path);
      out.uploaded += 1;
    }
    for (const r of answer.refused) {
      const row = bySession.get(r.session_id);
      if (!row) continue;
      // The object is not there yet: iOS said done, R2 may still be settling.
      // Left out of `answered` so the sweep below keeps asking.
      //
      // `busy` is the same shape of answer for a different reason: the
      // workspace's storage balance lost a race and no limit said no, so the
      // server left the object in R2 and the session pending on purpose.
      // Re-queueing would throw away bytes that are already uploaded; asking
      // again finishes the entry without sending one.
      if (r.code === "not_uploaded" || r.code === "busy") continue;
      answered.add(r.session_id);
      awaitingObject.delete(r.session_id);
      await requeueToPending(row.workspace_id, row.local_id, r.error);
      if (row.staged_path) toRemove.push(row.staged_path);
      out.requeued += 1;
    }
    // `not_uploaded`, `busy`, and anything the answer simply did not mention.
    for (const row of slice) if (!answered.has(row.session_id as string)) await keepAwaiting(row);
  }

  for (const { row, error } of failed) {
    if (row.session_id) awaitingObject.delete(row.session_id);
    await requeueToPending(row.workspace_id, row.local_id, error);
    if (row.staged_path) toRemove.push(row.staged_path);
    out.requeued += 1;
  }
  if (toRemove.length > 0) await native.removeStaged(toRemove);
  return out;
}

/**
 * Every workspace whose ledger may hold rows of ours.
 *
 * Read from the LEDGER, not from the settings: a workspace taken out of the
 * destination list still has whatever it had queued, and deriving this from
 * the settings left those rows queued forever and their staged copies holding
 * the staging budget with nothing left to sweep them. The active workspace is
 * unioned in because it is the destination when the list is empty, and it may
 * have no rows yet.
 */
async function ledgerWorkspaces(): Promise<string[]> {
  const activeId = useWorkspaceStore.getState().activeId;
  const known = await distinctWorkspaceIds().catch(() => [] as string[]);
  return Array.from(new Set(activeId ? [...known, activeId] : known));
}

/**
 * Rows left `queued` against a job that no longer exists on the native side:
 * the process was force-quit between `markQueued` and `enqueue`, the device
 * rebooted, or a native reconcile surfaced the result before this process
 * existed. Nothing will ever finish them and nothing will ever drain them, so
 * without this they sit queued until the app is deleted - invisible to the
 * planner, which only ever looks at `pending`.
 *
 * MUST run after `settleFinishedJobs`, whose drain is what turns a finished
 * job into an `uploaded` row. A session that drained but is still waiting for
 * the API to register its object is deliberately left alone: its job is gone
 * from `pending()` too, and requeuing it would upload the same asset twice.
 *
 * Returns how many rows it returned to pending.
 */
export async function reconcileQueuedRows(): Promise<number> {
  const native = backgroundUploadNative();
  if (!native) return 0; // Android: nothing ever queued a native job
  const workspaces = await ledgerWorkspaces();
  if (workspaces.length === 0) return 0;
  const toRemove: string[] = [];
  let requeued = 0;
  for (const workspaceId of workspaces) {
    // A batch being planned RIGHT NOW holds rows that are marked queued but
    // not yet enqueued (the ledger write comes first, deliberately). They are
    // not lost jobs, they are seconds from being handed over - sweeping them
    // here would delete the staged copies out from under the enqueue.
    if (inFlight.has(workspaceId)) continue;
    // Both snapshots are taken per workspace and INSIDE the guard, one on each
    // side of the listing, and a job in either counts as live. The listing is
    // an await, and a whole batch can start and finish inside it: a job
    // enqueued during it is in the second snapshot, and one drained during it
    // is still in the first. Judging on a single snapshot would requeue a live
    // job (and delete the copy iOS is uploading) in one direction, or an
    // already-uploaded row in the other.
    const before = (await native.pending()).map((j) => j.jobId);
    // The ledger is per workspace, so each one is asked in turn.
    const rows = await listByStatus(workspaceId, ["queued"], STAGING_MAX_FILES * 2);
    // A batch that started while the listing was out may still be between its
    // markQueued and its enqueue: its rows are in `rows`, and no snapshot can
    // show a job that has not been handed over yet.
    if (inFlight.has(workspaceId)) continue;
    const live = new Set([...before, ...(await native.pending()).map((j) => j.jobId)]);
    for (const r of rows) {
      if (r.job_id && live.has(r.job_id)) continue; // iOS still holds it
      if (r.session_id && awaitingObject.has(r.session_id)) continue; // finished, waiting on the API
      await requeueToPending(r.workspace_id, r.local_id, t("backup.error.jobMissingAfterRelaunch"), { charge: false });
      if (r.staged_path) toRemove.push(r.staged_path);
      requeued += 1;
    }
  }
  if (toRemove.length > 0) await native.removeStaged(toRemove);
  return requeued;
}

/**
 * Deletes staged copies no ledger row and no native job owns any more.
 *
 * `reconcileQueuedRows` heals the ROWS; this heals the FILES, which the rows
 * cannot always name: a batch killed between staging and `markQueued`, a
 * ledger purged on sign-out, a workspace whose rows were dropped. Every one of
 * those leaves bytes in the staging directory that nothing will ever remove,
 * and the staging budget is what stops the next batch being planned at all.
 *
 * MUST run after `reconcileQueuedRows`, which is what turns a row whose job is
 * gone back into `pending` (and removes its staged copy itself).
 */
export async function sweepStagedOrphans(): Promise<void> {
  const native = backgroundUploadNative();
  // Optional on the native side: an OTA JS update can land on an older binary.
  if (!native?.sweepStaging) return;
  // A batch being planned right now is holding staged copies that have no
  // queued row yet - it is between `stage` and `markQueued`, which is exactly
  // what this sweep cannot tell apart from an abandoned file. Sweeping then
  // would delete the files out from under its own init-batch call.
  if (inFlight.size > 0) return;
  const keep = new Set<string>(heldLargePaths);
  for (const workspaceId of await ledgerWorkspaces()) {
    for (const r of await listByStatus(workspaceId, ["queued"], STAGING_MAX_FILES * 2)) {
      if (r.staged_path) keep.add(r.staged_path);
    }
  }
  await native.sweepStaging([...keep]);
}

/**
 * Sign-out: nothing of this account may keep uploading. Cancels every job iOS
 * still holds and deletes the staged copies behind them.
 *
 * Runs BEFORE the ledger is cleared AND before the workspace/settings reset,
 * because the staged paths are only knowable from the rows, and which
 * workspaces to ask is only knowable from the settings. The rows themselves
 * are not touched: `clearLedger` comes later and takes the lot.
 */
export async function clearBackgroundUploads(): Promise<void> {
  const native = backgroundUploadNative();
  if (!native) return;
  // Sessions this process was still asking the API about belong to the
  // account that just left.
  awaitingObject.clear();
  const paths = new Set<string>();
  const jobIds = (await native.pending()).map((j) => j.jobId);
  if (jobIds.length > 0) {
    await native.cancel(jobIds);
    for (const r of await getByJobIds(jobIds)) if (r.staged_path) paths.add(r.staged_path);
  }
  // A row whose job has already been drained is holding a staged copy too, and
  // iOS no longer knows anything about it - the ledger is the only record.
  for (const workspaceId of await ledgerWorkspaces()) {
    for (const r of await listByStatus(workspaceId, ["queued"], STAGING_MAX_FILES * 2)) {
      if (r.staged_path) paths.add(r.staged_path);
    }
  }
  if (paths.size > 0) await native.removeStaged([...paths]);
}

/**
 * Stop this workspace's in-flight jobs (the user pressed stop, or signed out):
 * cancel them on iOS, return their assets to pending and drop the staged
 * copies. A result that arrives for one of them anyway is ignored by
 * `settleFinishedJobs`, since the row is no longer queued.
 *
 * Driven from the LEDGER, not from `pending()`: a row whose job has already
 * been drained (or was never enqueued) is queued just as much as one iOS still
 * holds, and leaving it behind would strand the asset for good.
 */
export async function cancelQueuedJobs(workspaceId: string): Promise<void> {
  const native = backgroundUploadNative();
  if (!native) return;
  const mine = await listByStatus(workspaceId, ["queued"], STAGING_MAX_FILES * 2);
  if (mine.length === 0) return;
  const live = new Set((await native.pending()).map((j) => j.jobId));
  const cancelIds = mine.map((r) => r.job_id).filter((id): id is string => !!id && live.has(id));
  if (cancelIds.length > 0) await native.cancel(cancelIds);
  for (const r of mine) {
    if (r.session_id) awaitingObject.delete(r.session_id);
    await requeueToPending(r.workspace_id, r.local_id, t("backup.label.stopped"), { charge: false });
  }
  const paths = mine.map((r) => r.staged_path).filter((p): p is string => !!p);
  if (paths.length > 0) await native.removeStaged(paths);
}
