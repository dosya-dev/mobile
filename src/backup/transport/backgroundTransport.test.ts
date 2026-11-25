// Every mock is built INSIDE its factory: `import` statements hoist above the
// const declarations, so a factory that closes over an outer object would read
// it before its initializer ran. The handles below are taken back out with
// jest.requireMock once the mocked modules exist.
jest.mock("../../../modules/dosya-background-upload", () => {
  const n = {
    stage: jest.fn(), enqueue: jest.fn(async () => {}), pending: jest.fn(async () => [] as unknown[]), drain: jest.fn(async () => [] as unknown[]),
    cancel: jest.fn(async () => {}), stagingUsage: jest.fn(async () => ({ bytes: 0, files: 0 })), removeStaged: jest.fn(async () => {}),
    sweepStaging: jest.fn(async () => {}), addListener: jest.fn(() => ({ remove() {} })),
  };
  return { __native: n, backgroundUploadNative: () => n, STAGING_MAX_BYTES: 500 * 1024 * 1024, STAGING_MAX_FILES: 200 };
});
jest.mock("../ledger", () => ({
  listPlannable: jest.fn(async () => [] as unknown[]), markQueued: jest.fn(async () => {}), setStatus: jest.fn(async () => {}),
  getByJobIds: jest.fn(async () => [] as unknown[]), requeueToPending: jest.fn(async () => {}), upsertAsset: jest.fn(async () => {}),
  retireExhausted: jest.fn(async () => 0),
  markPairChecked: jest.fn(async () => {}), getAssetsBulk: jest.fn(async () => new Map()), listByStatus: jest.fn(async () => [] as unknown[]),
  bumpAttempts: jest.fn(async () => {}), distinctWorkspaceIds: jest.fn(async () => [] as string[]),
  listUploadedUnpaired: jest.fn(async () => [] as unknown[]),
}));
jest.mock("../directApi", () => ({
  initBatch: jest.fn(), completeDirect: jest.fn(), DirectUnavailableError: class extends Error {},
  // The real one reads ApiError.status; the specs drive it directly.
  isInitBatchOutage: jest.fn(() => true),
}));
jest.mock("../fingerprint", () => ({ computeFingerprint: jest.fn(async (uri: string) => `fp:${uri}`) }));
jest.mock("../api", () => ({ checkFingerprints: jest.fn(async () => ({})) }));
jest.mock("../folders", () => ({ resolveBackupFolder: jest.fn(async () => "fld_1") }));
jest.mock("../livePhoto", () => ({
  livePhotoLedgerId: (id: string) => `${id}#video`,
  isLivePhotoLedgerId: (id: string) => id.endsWith("#video"),
  resolvePairedVideo: jest.fn(async () => null),
}));
jest.mock("../cleanup", () => ({ queueDeleteAfterBackup: jest.fn() }));
jest.mock("../scanner", () => ({ hasPhotoAccess: jest.fn(async () => true) }));
jest.mock("@/upload/controller", () => ({ isFatalUploadError: (m: string) => /storage limit/i.test(m) }));

import {
  queueNextBatch, settleFinishedJobs, cancelQueuedJobs, reconcileQueuedRows, clearBackgroundUploads,
  backgroundTransportAvailable, sweepStagedOrphans, releaseStagedLarge, __resetTransportState,
} from "./backgroundTransport";
import { useUploadBlock } from "@/upload/uploadBlock";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "../settings";
import { checkFingerprints } from "../api";
import { hasPhotoAccess } from "../scanner";
import { queueDeleteAfterBackup } from "../cleanup";

type Fns = Record<string, jest.Mock>;
const native = (jest.requireMock("../../../modules/dosya-background-upload") as { __native: Fns }).__native;
const ledger = jest.requireMock("../ledger") as Fns;
const api = jest.requireMock("../directApi") as Fns;
const { DirectUnavailableError } = jest.requireMock("../directApi") as { DirectUnavailableError: new () => Error };

/** A plannable ledger row, with only the fields the transport reads. */
function row(localId: string, filename: string, createdAt: number) {
  return { workspace_id: "w1", local_id: localId, filename, created_at: createdAt, attempts: 0 };
}
/** A row the transport reads back for a job it queued. */
function queuedRow(localId: string, jobId: string, stagedPath: string | null, extra: Record<string, unknown> = {}) {
  return {
    workspace_id: "w1", local_id: localId, job_id: jobId, session_id: jobId,
    staged_path: stagedPath, fingerprint: null, created_at: 1, status: "queued", ...extra,
  };
}

describe("exhausted rows are retired before a batch is planned", () => {
  it("calls retireExhausted with the attempt cap, before listPlannable", async () => {
    // A pending row at the cap would otherwise sit invisible forever: not
    // plannable, not in the Failed list. Retiring it first is what makes it
    // show up where the user can retry it.
    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(ledger.retireExhausted).toHaveBeenCalledWith("w1", 5);
    const retiredAt = ledger.retireExhausted.mock.invocationCallOrder[0];
    const plannedAt = ledger.listPlannable.mock.invocationCallOrder[0];
    expect(retiredAt).toBeLessThan(plannedAt);
  });
});

/** A batch whose enqueue is held open: the ledger rows are written (markQueued
 * runs first, deliberately) and iOS has not been given the jobs yet - the one
 * window in which a queued row legitimately has no native job, and the one in
 * which a staged copy has no row that can name it. */
function batchStuckAtEnqueue(): { reachedEnqueue: Promise<void>; release: () => void; planning: Promise<unknown> } {
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const reachedEnqueue = new Promise<void>((r) => { reached = r; });
  ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
  native.stage.mockResolvedValueOnce({ staged: [{ localId: "a", kind: "original", path: "/s/a", size: 10, filename: "a.jpg", mime: "image/jpeg" }], failed: [] });
  api.initBatch.mockResolvedValueOnce({ uploads: [{ client_ref: "a", session_id: "j9", url: "https://r2/a", headers: {}, expires_at: 1 }], refused: [] });
  native.enqueue.mockImplementationOnce(async () => { reached(); await gate; });
  return { reachedEnqueue, release, planning: queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetTransportState();
  useUploadBlock.setState({ reason: null });
  useWorkspaceStore.setState({ activeId: "w1", hydrated: true } as never);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true }, hydrated: true });
  // Default for the SECOND (paired-video) stage call of every batch: nothing
  // paired. Tests that care queue their own `mockResolvedValueOnce`s.
  native.stage.mockResolvedValue({ staged: [], failed: [] });
  native.stagingUsage.mockResolvedValue({ bytes: 0, files: 0 });
  // Reset, not clear: a `mockResolvedValueOnce` a test queued but the code
  // under test did not consume would otherwise answer the NEXT test's first
  // pending() call - and a leaked "this job is live" is exactly what makes a
  // reconcile spec pass against code that never looks.
  native.pending.mockReset();
  native.pending.mockResolvedValue([]);
  ledger.getAssetsBulk.mockResolvedValue(new Map());
  api.isInitBatchOutage.mockReturnValue(true);
  (hasPhotoAccess as jest.Mock).mockResolvedValue(true);
});

/** A Date.now() the spec drives by hand, so a spec can close the relaunch
 * window part-way through a batch without waiting for real time. */
function fakeClock(): { now: () => number; advance: (ms: number) => void; restore: () => void } {
  const spy = jest.spyOn(Date, "now");
  let t = 1_700_000_000_000;
  spy.mockImplementation(() => t);
  return { now: () => t, advance: (ms) => { t += ms; }, restore: () => spy.mockRestore() };
}

/** One batch whose init-batch call fails, swallowed the way the orchestrator's
 * loop swallows it. */
async function batchWithFailingInit(error: Error): Promise<void> {
  ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
  native.stage.mockResolvedValueOnce({ staged: [{ localId: "a", kind: "original", path: "/s/a", size: 10, filename: "a.jpg", mime: "image/jpeg" }], failed: [] });
  api.initBatch.mockRejectedValueOnce(error);
  await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY }).catch(() => {});
}

describe("queueNextBatch", () => {
  it("stages plannable rows, dedups by fingerprint, opens sessions and enqueues one job per file", async () => {
    ledger.listPlannable.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "a", filename: "a.heic", created_at: 10, attempts: 0 },
      { workspace_id: "w1", local_id: "b", filename: "b.heic", created_at: 11, attempts: 0 },
    ]);
    native.stage.mockResolvedValueOnce({
      staged: [
        { localId: "a", kind: "original", path: "/s/a.heic", size: 100, filename: "a.heic", mime: "image/heic" },
        { localId: "b", kind: "original", path: "/s/b.heic", size: 200, filename: "b.heic", mime: "image/heic" },
      ], failed: [],
    });
    (checkFingerprints as jest.Mock).mockResolvedValueOnce({ "fp:/s/b.heic": "file_existing" });
    api.initBatch.mockResolvedValueOnce({ uploads: [{ client_ref: "a", session_id: "upl_a", url: "https://r2/a", headers: { "Content-Type": "image/heic" }, expires_at: 1 }], refused: [] });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(out).toMatchObject({ queued: 1, deduped: 1, unreadable: 0, skippedLarge: 0, large: [] });
    // `size` rides along: the seeded row carries 0 until something learns the
    // real byte count, and a deduped row is never queued (where markQueued
    // would have written it).
    expect(ledger.setStatus).toHaveBeenCalledWith("w1", "b", "uploaded", { remoteFileId: "file_existing", fingerprint: "fp:/s/b.heic", size: 200 });
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/b.heic"]);
    expect(api.initBatch).toHaveBeenCalledWith("w1", [{ client_ref: "a", file_name: "a.heic", file_size: 100, mime_type: "image/heic", folder_id: "fld_1" }]);
    expect(native.enqueue).toHaveBeenCalledWith([{ jobId: "upl_a", path: "/s/a.heic", url: "https://r2/a", headers: { "Content-Type": "image/heic" } }], false);
    expect(ledger.markQueued).toHaveBeenCalledWith("w1", "a", { sessionId: "upl_a", jobId: "upl_a", stagedPath: "/s/a.heic", fingerprint: "fp:/s/a.heic", size: 100 });
    // The row has to exist before iOS can finish the job: a drained result
    // with no `queued` row is ignored for good.
    expect(ledger.markQueued.mock.invocationCallOrder[0]).toBeLessThan(native.enqueue.mock.invocationCallOrder[0]);
  });

  it("plans a paired-video row as a pairedVideo staging request, not as a library asset", async () => {
    ledger.listPlannable.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "p#video", filename: "p.MOV", created_at: 20, attempts: 1 },
    ]);
    native.stage.mockResolvedValueOnce({ staged: [{ localId: "p", kind: "pairedVideo", path: "/s/p.mov", size: 400, filename: "p.MOV", mime: "video/quicktime" }], failed: [] });
    api.initBatch.mockResolvedValueOnce({ uploads: [{ client_ref: "p#video", session_id: "upl_pv", url: "https://r2/pv", headers: {}, expires_at: 1 }], refused: [] });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(native.stage).toHaveBeenCalledTimes(1);
    expect(native.stage).toHaveBeenCalledWith([{ localId: "p", kind: "pairedVideo" }]);
    expect(api.initBatch).toHaveBeenCalledWith("w1", [{ client_ref: "p#video", file_name: "p.MOV", file_size: 400, mime_type: "video/quicktime", folder_id: "fld_1" }]);
    expect(ledger.markQueued).toHaveBeenCalledWith("w1", "p#video", { sessionId: "upl_pv", jobId: "upl_pv", stagedPath: "/s/p.mov", fingerprint: "fp:/s/p.mov", size: 400 });
    expect(out.queued).toBe(1);
  });

  it("routes a staged file over 50 MB to the caller's large-file path instead of a job", async () => {
    ledger.listPlannable.mockResolvedValueOnce([{ workspace_id: "w1", local_id: "v", filename: "v.mov", created_at: 1, attempts: 0 }]);
    native.stage.mockResolvedValueOnce({ staged: [{ localId: "v", kind: "original", path: "/s/v.mov", size: 60 * 1024 * 1024, filename: "v.mov", mime: "video/quicktime" }], failed: [] });
    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    // `mime` rides along: the caller uploads with the type the native export
    // reported rather than guessing from the filename.
    expect(out.large).toEqual([{ localId: "v", path: "/s/v.mov", size: 60 * 1024 * 1024, filename: "v.mov", mime: "video/quicktime", createdAt: 1 }]);
    expect(api.initBatch).not.toHaveBeenCalled();
  });

  it("records unreadable and empty stagings on the ledger and a fatal refusal on the block", async () => {
    ledger.listPlannable.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "x", filename: "x.jpg", created_at: 1, attempts: 0 },
      { workspace_id: "w1", local_id: "y", filename: "y.jpg", created_at: 2, attempts: 0 },
    ]);
    native.stage.mockResolvedValueOnce({ staged: [{ localId: "y", kind: "original", path: "/s/y.jpg", size: 1, filename: "y.jpg", mime: "image/jpeg" }], failed: [{ localId: "x", kind: "original", reason: "empty" }] });
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [{ client_ref: "y", error: "You've reached your storage limit", code: "quota" }] });
    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(out.unreadable).toBe(1);
    expect(ledger.setStatus).toHaveBeenCalledWith("w1", "x", "error", { lastError: "This file is empty on this device", incAttempts: true });
    expect(useUploadBlock.getState().reason).toMatch(/storage limit/);
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/y.jpg"]);
  });

  /**
   * Before this, an unreadable staging cost the row nothing: it stayed pending
   * with attempts 0, so the very next batch planned it again, and once enough
   * of them accumulated every batch was full of rows that could never be
   * staged - `queued: 0`, and the orchestrator's loop stopped for good.
   */
  it("charges an attempt for an unreadable asset, leaving it pending so a later batch retries it", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("x", "x.jpg", 1), row("p#video", "p.MOV", 2)]);
    native.stage.mockResolvedValueOnce({
      staged: [],
      failed: [{ localId: "x", kind: "original", reason: "unreadable" }, { localId: "p", kind: "pairedVideo", reason: "unreadable" }],
    });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(out.unreadable).toBe(2);
    expect(ledger.bumpAttempts).toHaveBeenCalledWith("w1", "x", "Could not read this item from the library");
    // A paired-video row being retried on its own is charged under its own key.
    expect(ledger.bumpAttempts).toHaveBeenCalledWith("w1", "p#video", "Could not read this item from the library");
    // Pending, not error: listPlannable only ever returns pending rows, so an
    // `error` here would take the asset out of the queue on its first miss.
    expect(ledger.setStatus).not.toHaveBeenCalled();
  });

  it("does not charge an attempt when staging stopped for budget or device space", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({ staged: [], failed: [{ localId: "a", kind: "original", reason: "budget" }] });
    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(ledger.bumpAttempts).not.toHaveBeenCalled();
  });

  it("records the staged size on the rows it will never queue: over the cap and refused", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_SETTINGS.filters, maxBytes: 50 } }, hydrated: true });
    ledger.listPlannable.mockResolvedValueOnce([row("big", "big.jpg", 1), row("bad", "bad.jpg", 2)]);
    native.stage.mockResolvedValueOnce({
      staged: [
        { localId: "big", kind: "original", path: "/s/big.jpg", size: 900, filename: "big.jpg", mime: "image/jpeg" },
        { localId: "bad", kind: "original", path: "/s/bad.jpg", size: 33, filename: "bad.jpg", mime: "image/jpeg" },
      ], failed: [],
    });
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [{ client_ref: "bad", error: "nope", code: "x" }] });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(out.skippedLarge).toBe(1);
    expect(ledger.setStatus).toHaveBeenCalledWith("w1", "big", "skipped_large", { lastError: "Larger than your 50 byte limit", size: 900 });
    expect(ledger.setStatus).toHaveBeenCalledWith("w1", "bad", "error", { lastError: "nope", incAttempts: true, size: 33 });
  });

  it("stops staging once the deadline has passed", async () => {
    ledger.listPlannable.mockResolvedValueOnce([{ workspace_id: "w1", local_id: "a", filename: "a.jpg", created_at: 1, attempts: 0 }]);
    const out = await queueNextBatch("w1", { deadlineMs: Date.now() - 1 });
    expect(native.stage).not.toHaveBeenCalled();
    expect(out.exhausted).toBe(false);
  });

  /**
   * The deadline used to cover the staging loop alone, so a window that closed
   * during fingerprinting or an init-batch round trip was not noticed: the
   * process was killed mid-write, and the staged copies it was holding stayed
   * in the directory with nothing that could name them.
   */
  it("stops before fingerprinting when the window closed during staging, dropping what it had staged", async () => {
    const clock = fakeClock();
    try {
      ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
      native.stage.mockImplementationOnce(async () => {
        clock.advance(30_000);
        return { staged: [{ localId: "a", kind: "original", path: "/s/a.jpg", size: 10, filename: "a.jpg", mime: "image/jpeg" }], failed: [] };
      });

      const out = await queueNextBatch("w1", { deadlineMs: clock.now() + 20_000 });

      expect(checkFingerprints).not.toHaveBeenCalled();
      expect(api.initBatch).not.toHaveBeenCalled();
      expect(native.removeStaged).toHaveBeenCalledWith(["/s/a.jpg"]);
      // The row is untouched and still plannable, so the batch is not spent.
      expect(out).toMatchObject({ queued: 0, exhausted: false });
      expect(ledger.markQueued).not.toHaveBeenCalled();
    } finally {
      clock.restore();
    }
  });

  it("stops between init-batch slices when the window closes, keeping the slice already handed over", async () => {
    const clock = fakeClock();
    try {
      // 201 entries: two slices, since one init-batch call carries at most 200.
      const ids = Array.from({ length: 201 }, (_, i) => `v${String(i).padStart(3, "0")}`);
      ledger.listPlannable.mockResolvedValueOnce(ids.map((id) => row(id, `${id}.mov`, 1)));
      native.stage.mockImplementation(async (reqs: { localId: string; kind: string }[]) => ({
        // Videos, so no paired-video probe rides along.
        staged: reqs.map((r) => ({ localId: r.localId, kind: r.kind, path: `/s/${r.localId}`, size: 10, filename: `${r.localId}.mov`, mime: "video/quicktime" })),
        failed: [],
      }));
      api.initBatch.mockImplementationOnce(async (_ws: string, slice: { client_ref: string }[]) => {
        clock.advance(30_000);
        return { uploads: slice.map((e) => ({ client_ref: e.client_ref, session_id: `u_${e.client_ref}`, url: "https://r2/x", headers: {}, expires_at: 1 })), refused: [] };
      });

      const out = await queueNextBatch("w1", { deadlineMs: clock.now() + 20_000 });

      expect(api.initBatch).toHaveBeenCalledTimes(1);
      expect(out.queued).toBe(200);
      expect(out.exhausted).toBe(false);
      // The leftover entry never got a session, so its copy goes and its row
      // stays pending for the next batch.
      expect(native.removeStaged).toHaveBeenLastCalledWith(["/s/v200"]);
    } finally {
      clock.restore();
    }
  });

  it("stages nothing at all without photo access", async () => {
    (hasPhotoAccess as jest.Mock).mockResolvedValue(false);
    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(ledger.listPlannable).not.toHaveBeenCalled();
    expect(native.stage).not.toHaveBeenCalled();
    expect(out).toEqual({ queued: 0, deduped: 0, unreadable: 0, skippedLarge: 0, large: [], exhausted: false });
  });

  it("stages a Live Photo's paired video in a second call, as its own row, entry and job", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("p", "p.heic", 20)]);
    native.stage
      .mockResolvedValueOnce({ staged: [{ localId: "p", kind: "original", path: "/s/p.heic", size: 100, filename: "p.heic", mime: "image/heic" }], failed: [] })
      .mockResolvedValueOnce({ staged: [{ localId: "p", kind: "pairedVideo", path: "/s/p.mov", size: 400, filename: "p.MOV", mime: "video/quicktime" }], failed: [] });
    api.initBatch.mockResolvedValueOnce({
      uploads: [
        { client_ref: "p", session_id: "upl_p", url: "https://r2/p", headers: {}, expires_at: 1 },
        { client_ref: "p#video", session_id: "upl_pv", url: "https://r2/pv", headers: {}, expires_at: 1 },
      ], refused: [],
    });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(native.stage).toHaveBeenNthCalledWith(1, [{ localId: "p", kind: "original" }]);
    expect(native.stage).toHaveBeenNthCalledWith(2, [{ localId: "p", kind: "pairedVideo" }]);
    expect(ledger.upsertAsset).toHaveBeenCalledWith({ workspace_id: "w1", local_id: "p#video", filename: "p.MOV", size: 400, created_at: 20 });
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "p");
    expect(api.initBatch).toHaveBeenCalledWith("w1", [
      { client_ref: "p", file_name: "p.heic", file_size: 100, mime_type: "image/heic", folder_id: "fld_1" },
      { client_ref: "p#video", file_name: "p.MOV", file_size: 400, mime_type: "video/quicktime", folder_id: "fld_1" },
    ]);
    expect(out.queued).toBe(2);
    expect(ledger.markQueued).toHaveBeenCalledWith("w1", "p#video", { sessionId: "upl_pv", jobId: "upl_pv", stagedPath: "/s/p.mov", fingerprint: "fp:/s/p.mov", size: 400 });
  });

  it("skips a still whose pair row exists and treats a pair staging failure as not-a-Live-Photo", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("p1", "p1.heic", 1), row("p2", "p2.heic", 2)]);
    native.stage
      .mockResolvedValueOnce({
        staged: [
          { localId: "p1", kind: "original", path: "/s/p1.heic", size: 10, filename: "p1.heic", mime: "image/heic" },
          { localId: "p2", kind: "original", path: "/s/p2.heic", size: 20, filename: "p2.heic", mime: "image/heic" },
        ], failed: [],
      })
      .mockResolvedValueOnce({ staged: [], failed: [{ localId: "p2", kind: "pairedVideo", reason: "unreadable" }] });
    ledger.getAssetsBulk.mockResolvedValueOnce(new Map([["p1#video", { local_id: "p1#video" }]]));
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [] });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(native.stage).toHaveBeenNthCalledWith(2, [{ localId: "p2", kind: "pairedVideo" }]);
    expect(out.unreadable).toBe(0);
    expect(ledger.setStatus).not.toHaveBeenCalledWith("w1", "p2", "error", expect.anything());
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "p2");
    expect(ledger.markPairChecked).not.toHaveBeenCalledWith("w1", "p1");
    // Neither opened nor refused: the staged copies must not be left behind.
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/p1.heic", "/s/p2.heic"]);
  });

  it("hands back the outcome when the workspace cannot use direct upload, dropping every staged copy", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("s", "s.jpg", 1), row("v", "v.mov", 2)]);
    native.stage.mockResolvedValueOnce({
      staged: [
        { localId: "s", kind: "original", path: "/s/s.jpg", size: 10, filename: "s.jpg", mime: "image/jpeg" },
        { localId: "v", kind: "original", path: "/s/v.mov", size: 60 * 1024 * 1024, filename: "v.mov", mime: "video/quicktime" },
      ], failed: [],
    });
    api.initBatch.mockRejectedValueOnce(new DirectUnavailableError());

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(out.queued).toBe(0);
    // The caller never gets to upload the large one, so its copy goes too.
    expect(out.large).toEqual([]);
    expect(native.removeStaged).toHaveBeenLastCalledWith(["/s/s.jpg", "/s/v.mov"]);
    expect(backgroundTransportAvailable("w1")).toBe(false);
    expect(backgroundTransportAvailable("w2")).toBe(true);
  });

  /**
   * A direct endpoint that is down used to leave backup doing nothing at all:
   * every run staged a batch, failed to open sessions for it, threw the staged
   * copies away and ended - while the in-process uploader, which talks to a
   * different route, would have worked the whole time.
   */
  it("gives up on the direct path for a workspace after three unanswered init-batch calls in a row", async () => {
    await batchWithFailingInit(new Error("Network request failed"));
    expect(backgroundTransportAvailable("w1")).toBe(true);
    await batchWithFailingInit(new Error("Network request failed"));
    expect(backgroundTransportAvailable("w1")).toBe(true);
    await batchWithFailingInit(new Error("Network request failed"));

    // The next runBackup takes the in-process path for this workspace.
    expect(backgroundTransportAvailable("w1")).toBe(false);
    // And only for this one: the outage is counted per workspace.
    expect(backgroundTransportAvailable("w2")).toBe(true);
  });

  it("forgets the strikes as soon as one init-batch call is answered", async () => {
    await batchWithFailingInit(new Error("Network request failed"));
    await batchWithFailingInit(new Error("Network request failed"));

    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({ staged: [{ localId: "a", kind: "original", path: "/s/a", size: 10, filename: "a.jpg", mime: "image/jpeg" }], failed: [] });
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [] });
    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    await batchWithFailingInit(new Error("Network request failed"));
    expect(backgroundTransportAvailable("w1")).toBe(true);
  });

  it("does not count a refusal the API actually answered", async () => {
    api.isInitBatchOutage.mockReturnValue(false);
    for (let i = 0; i < 4; i += 1) await batchWithFailingInit(new Error("Bad request"));
    expect(backgroundTransportAvailable("w1")).toBe(true);
  });

  it("removes every staged copy it still owns when the batch throws", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("s", "s.jpg", 1), row("v", "v.mov", 2)]);
    native.stage.mockResolvedValueOnce({
      staged: [
        { localId: "s", kind: "original", path: "/s/s.jpg", size: 10, filename: "s.jpg", mime: "image/jpeg" },
        { localId: "v", kind: "original", path: "/s/v.mov", size: 60 * 1024 * 1024, filename: "v.mov", mime: "video/quicktime" },
      ], failed: [],
    });
    api.initBatch.mockRejectedValueOnce(new Error("Network request failed"));

    await expect(queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY })).rejects.toThrow("Network request failed");
    expect(native.removeStaged).toHaveBeenLastCalledWith(["/s/s.jpg", "/s/v.mov"]);
  });

  it("joins a batch already in flight for the same workspace instead of planning a second one, and hands the joiner no large files", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.mov", 1), row("big", "big.mov", 1)]);
    native.stage.mockResolvedValueOnce({
      staged: [
        { localId: "a", kind: "original", path: "/s/a.mov", size: 10, filename: "a.mov", mime: "video/quicktime" },
        { localId: "big", kind: "original", path: "/s/big.mov", size: 60 * 1024 * 1024, filename: "big.mov", mime: "video/quicktime" },
      ], failed: [],
    });
    api.initBatch.mockResolvedValueOnce({ uploads: [{ client_ref: "a", session_id: "u1", url: "https://r2/a", headers: {}, expires_at: 1 }], refused: [] });

    const [first, second] = await Promise.all([
      queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY }),
      queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY }),
    ]);

    expect(first.queued).toBe(1);
    expect(first.large.map((l) => l.path)).toEqual(["/s/big.mov"]);
    // The joiner gets the same counts, but never the staged large files: they
    // belong to the caller that planned them, and uploading one twice in
    // parallel would race two multiparts over a single staged path.
    expect(second).not.toBe(first);
    expect(second).toEqual({ ...first, large: [] });
    expect(ledger.listPlannable).toHaveBeenCalledTimes(1);
    expect(native.stage).toHaveBeenCalledTimes(1);
    // The guard is released once the batch settles.
    ledger.listPlannable.mockResolvedValueOnce([]);
    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(ledger.listPlannable).toHaveBeenCalledTimes(2);
  });

  it("plans a second workspace's batch independently - the guard is per workspace, not per device", async () => {
    // w1's batch is parked mid-plan; w2 must not be handed w1's outcome.
    let releaseW1 = () => {};
    ledger.listPlannable
      .mockImplementationOnce(async () => {
        await new Promise<void>((r) => { releaseW1 = r; });
        return [row("a", "a.jpg", 1)];
      })
      .mockResolvedValueOnce([]);

    const w1 = queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    const w2 = await queueNextBatch("w2", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.listPlannable).toHaveBeenCalledTimes(2);
    expect(ledger.listPlannable).toHaveBeenLastCalledWith("w2", expect.any(Number), expect.any(Number));
    expect(w2.exhausted).toBe(true); // w2's own empty ledger, not w1's result
    releaseW1();
    await w1;
  });

  it("is exhausted when the ledger has nothing left and when staging has no room", async () => {
    ledger.listPlannable.mockResolvedValueOnce([]);
    expect((await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY })).exhausted).toBe(true);

    native.stagingUsage.mockResolvedValueOnce({ bytes: 0, files: 200 });
    ledger.listPlannable.mockClear();
    const full = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(full.exhausted).toBe(true);
    expect(ledger.listPlannable).not.toHaveBeenCalled();
  });

  /**
   * A still that is already `uploaded` is invisible to listPlannable, which
   * returns pending rows only - so under the background transport nothing ever
   * asked whether it was a Live Photo, and the motion half of every photo
   * backed up before pairing existed was lost for good.
   */
  it("backfills the paired video of a still that is already backed up, in the same batch", async () => {
    ledger.listPlannable.mockResolvedValueOnce([]);
    ledger.listUploadedUnpaired.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "done", filename: "done.heic", created_at: 30, status: "uploaded", attempts: 0 },
      { workspace_id: "w1", local_id: "plain", filename: "plain.jpg", created_at: 31, status: "uploaded", attempts: 0 },
    ]);
    native.stage.mockResolvedValueOnce({
      staged: [{ localId: "done", kind: "pairedVideo", path: "/s/done.mov", size: 700, filename: "done.MOV", mime: "video/quicktime" }],
      failed: [{ localId: "plain", kind: "pairedVideo", reason: "unreadable" }],
    });
    api.initBatch.mockResolvedValueOnce({ uploads: [{ client_ref: "done#video", session_id: "upl_dv", url: "https://r2/dv", headers: {}, expires_at: 1 }], refused: [] });

    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.listUploadedUnpaired).toHaveBeenCalledWith("w1", 25);
    expect(native.stage).toHaveBeenCalledWith([{ localId: "done", kind: "pairedVideo" }, { localId: "plain", kind: "pairedVideo" }]);
    // Its own row, dated like its still so the two land in the same folder.
    expect(ledger.upsertAsset).toHaveBeenCalledWith({ workspace_id: "w1", local_id: "done#video", filename: "done.MOV", size: 700, created_at: 30 });
    // Routed through the normal path: init-batch entry, job, queued row.
    expect(api.initBatch).toHaveBeenCalledWith("w1", [{ client_ref: "done#video", file_name: "done.MOV", file_size: 700, mime_type: "video/quicktime", folder_id: "fld_1" }]);
    expect(ledger.markQueued).toHaveBeenCalledWith("w1", "done#video", { sessionId: "upl_dv", jobId: "upl_dv", stagedPath: "/s/done.mov", fingerprint: "fp:/s/done.mov", size: 700 });
    expect(out.queued).toBe(1);
    // Both probed stills are marked, pair or no pair: a plain photo must not
    // be asked again on every run for the rest of time. And a pair that does
    // not exist is not a failure of the still.
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "done");
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "plain");
    expect(out.unreadable).toBe(0);
  });

  /**
   * A probe that comes back `budget` or `nospace` says the staging directory
   * or the device was full, not that the still has no motion half. Marking
   * it checked lost the pair for good - a checked still is never asked again.
   */
  it("leaves a still unmarked when its probe failed for room, so a later batch asks again", async () => {
    ledger.listPlannable.mockResolvedValueOnce([]);
    ledger.listUploadedUnpaired.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "full", filename: "full.heic", created_at: 30, status: "uploaded", attempts: 0 },
      { workspace_id: "w1", local_id: "dry", filename: "dry.heic", created_at: 31, status: "uploaded", attempts: 0 },
      { workspace_id: "w1", local_id: "plain", filename: "plain.jpg", created_at: 32, status: "uploaded", attempts: 0 },
    ]);
    native.stage.mockResolvedValueOnce({
      staged: [],
      failed: [
        { localId: "full", kind: "pairedVideo", reason: "budget" },
        { localId: "dry", kind: "pairedVideo", reason: "nospace" },
        { localId: "plain", kind: "pairedVideo", reason: "unreadable" },
      ],
    });

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.markPairChecked).not.toHaveBeenCalledWith("w1", "full");
    expect(ledger.markPairChecked).not.toHaveBeenCalledWith("w1", "dry");
    // A still that simply is not a Live Photo is still settled for good.
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "plain");
  });

  it("applies the same rule to the pair probe of a freshly staged still", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("p1", "p1.heic", 1), row("p2", "p2.heic", 2)]);
    native.stage
      .mockResolvedValueOnce({
        staged: [
          { localId: "p1", kind: "original", path: "/s/p1", size: 10, filename: "p1.heic", mime: "image/heic" },
          { localId: "p2", kind: "original", path: "/s/p2", size: 10, filename: "p2.heic", mime: "image/heic" },
        ],
        failed: [],
      })
      // The pair probe: p1's video has no room this time, p2 has no video.
      .mockResolvedValueOnce({
        staged: [],
        failed: [
          { localId: "p1", kind: "pairedVideo", reason: "budget" },
          { localId: "p2", kind: "pairedVideo", reason: "unreadable" },
        ],
      });
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [] });

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.markPairChecked).not.toHaveBeenCalledWith("w1", "p1");
    expect(ledger.markPairChecked).toHaveBeenCalledWith("w1", "p2");
  });

  it("asks for no more backfill stills than the staging directory has room for", async () => {
    // 200 slots, 198 used: the batch stages 1 original, leaving room for 1 probe.
    native.stagingUsage.mockResolvedValueOnce({ bytes: 0, files: 198 });
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({
      staged: [{ localId: "a", kind: "original", path: "/s/a", size: 10, filename: "a.jpg", mime: "image/jpeg" }],
      failed: [],
    });
    ledger.listUploadedUnpaired.mockResolvedValueOnce([]);
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [] });

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.listUploadedUnpaired).toHaveBeenCalledWith("w1", 1);
  });

  it("skips the backfill entirely when the batch used the last staging slot", async () => {
    native.stagingUsage.mockResolvedValueOnce({ bytes: 0, files: 199 });
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({
      staged: [{ localId: "a", kind: "original", path: "/s/a", size: 10, filename: "a.jpg", mime: "image/jpeg" }],
      failed: [],
    });
    api.initBatch.mockResolvedValueOnce({ uploads: [], refused: [] });

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.listUploadedUnpaired).not.toHaveBeenCalled();
  });

  it("does not re-probe a still whose paired row already exists", async () => {
    ledger.listPlannable.mockResolvedValueOnce([]);
    ledger.listUploadedUnpaired.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "done", filename: "done.heic", created_at: 30, status: "uploaded", attempts: 0 },
    ]);
    ledger.getAssetsBulk.mockResolvedValueOnce(new Map([["done#video", { local_id: "done#video" }]]));

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(native.stage).not.toHaveBeenCalled();
  });

  it("skips the backfill when staging has already halted for space", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({ staged: [], failed: [{ localId: "a", kind: "original", reason: "budget" }] });
    ledger.listUploadedUnpaired.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "done", filename: "done.heic", created_at: 30, status: "uploaded", attempts: 0 },
    ]);

    await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });

    expect(ledger.listUploadedUnpaired).not.toHaveBeenCalled();
    expect(native.stage).toHaveBeenCalledTimes(1);
  });

  it("blocks uploads on nospace and does not count it against the asset", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("a", "a.jpg", 1)]);
    native.stage.mockResolvedValueOnce({ staged: [], failed: [{ localId: "a", kind: "original", reason: "nospace" }] });
    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(out.unreadable).toBe(0);
    expect(ledger.setStatus).not.toHaveBeenCalled();
    expect(useUploadBlock.getState().reason).toMatch(/free space/);
    // The second (paired-video) call is never made once staging has halted.
    expect(native.stage).toHaveBeenCalledTimes(1);
  });
});

describe("settleFinishedJobs", () => {
  it("completes finished jobs, flips the ledger, deletes staged copies, and requeues failures", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "upl_a", ok: true, httpStatus: 200 }, { jobId: "upl_b", ok: false, httpStatus: 403, error: "HTTP 403" }]);
    ledger.getByJobIds.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "a", job_id: "upl_a", session_id: "upl_a", staged_path: "/s/a", fingerprint: "fpa", created_at: 5, status: "queued" },
      { workspace_id: "w1", local_id: "b", job_id: "upl_b", session_id: "upl_b", staged_path: "/s/b", fingerprint: null, created_at: 6, status: "queued" },
    ]);
    api.completeDirect.mockResolvedValueOnce({ completed: [{ session_id: "upl_a", file_id: "file_a", version: 1, size_bytes: 1 }], refused: [] });
    const out = await settleFinishedJobs();
    expect(out).toEqual({ uploaded: 1, requeued: 1 });
    expect(api.completeDirect).toHaveBeenCalledWith([{ session_id: "upl_a", fingerprint: "fpa", source_created_at: 5, source_modified_at: 5 }]);
    expect(ledger.setStatus).toHaveBeenCalledWith("w1", "a", "uploaded", { remoteFileId: "file_a" });
    expect(queueDeleteAfterBackup).toHaveBeenCalledWith("a");
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "b", "HTTP 403");
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/a", "/s/b"]);
  });

  it("leaves a not_uploaded refusal queued and requeues any other refusal", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "j1", ok: true }, { jobId: "j2", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([
      { workspace_id: "w1", local_id: "a", job_id: "j1", session_id: "s1", staged_path: "/s/a", fingerprint: null, created_at: 1, status: "queued" },
      { workspace_id: "w1", local_id: "b", job_id: "j2", session_id: "s2", staged_path: "/s/b", fingerprint: null, created_at: 1, status: "queued" },
    ]);
    api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "s1", code: "not_uploaded", error: "" }, { session_id: "s2", code: "size_mismatch", error: "bad" }] });
    await settleFinishedJobs();
    expect(ledger.requeueToPending).toHaveBeenCalledTimes(1);
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "b", "bad");
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/b"]);
  });

  it("asks about a not_uploaded session again on the next settle, though its result was already drained", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "s1", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "s1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "s1", code: "not_uploaded", error: "" }] });
    await settleFinishedJobs();
    expect(native.removeStaged).not.toHaveBeenCalled();

    native.drain.mockResolvedValueOnce([]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "s1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [{ session_id: "s1", file_id: "file_a", version: 1, size_bytes: 1 }], refused: [] });
    const out = await settleFinishedJobs();

    expect(ledger.getByJobIds).toHaveBeenLastCalledWith(["s1"]);
    expect(api.completeDirect).toHaveBeenLastCalledWith([{ session_id: "s1", fingerprint: null, source_created_at: 1, source_modified_at: 1 }]);
    expect(out).toEqual({ uploaded: 1, requeued: 0 });
    expect(native.removeStaged).toHaveBeenLastCalledWith(["/s/a"]);
  });

  it("keeps a session whose complete-direct call threw, rather than losing the drained result", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "s1", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "s1", "/s/a")]);
    api.completeDirect.mockRejectedValueOnce(new Error("Network request failed"));
    const out = await settleFinishedJobs();
    expect(out).toEqual({ uploaded: 0, requeued: 0 });
    expect(ledger.requeueToPending).not.toHaveBeenCalled();
    expect(native.removeStaged).not.toHaveBeenCalled();

    native.drain.mockResolvedValueOnce([]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "s1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [{ session_id: "s1", file_id: "file_a", version: 1, size_bytes: 1 }], refused: [] });
    expect(await settleFinishedJobs()).toEqual({ uploaded: 1, requeued: 0 });
  });

  it("gives up on a session the API never registers, and re-uploads the asset", async () => {
    for (let ask = 1; ask <= 10; ask += 1) {
      native.drain.mockResolvedValueOnce(ask === 1 ? [{ jobId: "s1", ok: true }] : []);
      ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "s1", "/s/a")]);
      api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "s1", code: "not_uploaded", error: "" }] });
      const out = await settleFinishedJobs();
      expect(out).toEqual(ask < 10 ? { uploaded: 0, requeued: 0 } : { uploaded: 0, requeued: 1 });
    }
    expect(ledger.requeueToPending).toHaveBeenCalledTimes(1);
    // Charged: an object that never registers after a 2xx PUT is a captive
    // portal, a proxy or a bucket mismatch, and without a charge the asset
    // re-uploads its full bytes forever with nothing visible to the user.
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "a", "object never registered");
    expect(native.removeStaged).toHaveBeenCalledTimes(1);
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/a"]);
  });

  it("ignores a result for a job the ledger no longer has queued", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "j1", ok: true }, { jobId: "j2", ok: false, error: "HTTP 500" }]);
    ledger.getByJobIds.mockResolvedValueOnce([
      queuedRow("a", "j1", "/s/a", { status: "pending" }),
      queuedRow("b", "j2", "/s/b", { status: "uploaded" }),
    ]);
    const out = await settleFinishedJobs();
    expect(out).toEqual({ uploaded: 0, requeued: 0 });
    expect(api.completeDirect).not.toHaveBeenCalled();
    expect(ledger.setStatus).not.toHaveBeenCalled();
    expect(ledger.requeueToPending).not.toHaveBeenCalled();
    expect(native.removeStaged).not.toHaveBeenCalled();
  });
});

describe("settleFinishedJobs serialisation", () => {
  it("queues concurrent settles behind one another: two drains, never overlapping", async () => {
    // `runBackup` settles on its own account, outside the wake-up chain, so
    // two settles CAN be asked for at once. A drain hands each result out
    // exactly once - overlapping them would split one batch of results.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let overlapped = false;
    let inDrain = false;
    native.drain.mockImplementationOnce(async () => {
      inDrain = true;
      await gate;
      inDrain = false;
      return [];
    });
    native.drain.mockImplementationOnce(async () => {
      if (inDrain) overlapped = true;
      return [];
    });

    const first = settleFinishedJobs();
    const second = settleFinishedJobs();
    await Promise.resolve();
    expect(native.drain).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(native.drain).toHaveBeenCalledTimes(2);
    expect(overlapped).toBe(false);
  });

  it("a failing settle does not strand the next one", async () => {
    native.drain.mockRejectedValueOnce(new Error("native gone"));
    await expect(settleFinishedJobs()).rejects.toThrow("native gone");
    native.drain.mockResolvedValueOnce([]);
    expect(await settleFinishedJobs()).toEqual({ uploaded: 0, requeued: 0 });
  });
});

describe("cancelQueuedJobs", () => {
  it("cancels this workspace's live jobs and sweeps the queued rows iOS no longer holds", async () => {
    // `b` has already been drained (or was never enqueued): it is not in
    // pending(), but its row is just as queued as `a`'s.
    ledger.listByStatus.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a"), queuedRow("b", "j2", "/s/b")]);
    native.pending.mockResolvedValueOnce([{ jobId: "j1", state: "running" }]);

    await cancelQueuedJobs("w1");

    expect(ledger.listByStatus).toHaveBeenCalledWith("w1", ["queued"], expect.any(Number));
    expect(native.cancel).toHaveBeenCalledWith(["j1"]);
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "a", "Stopped", { charge: false });
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "b", "Stopped", { charge: false });
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/a", "/s/b"]);
  });

  it("drops a cancelled session from the awaiting-object set", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "j1", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "j1", code: "not_uploaded", error: "" }] });
    await settleFinishedJobs();

    ledger.listByStatus.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a")]);
    native.pending.mockResolvedValueOnce([]);
    await cancelQueuedJobs("w1");

    // Nothing left to ask about, so a settle with an empty drain does no work.
    native.drain.mockResolvedValueOnce([]);
    ledger.getByJobIds.mockClear();
    expect(await settleFinishedJobs()).toEqual({ uploaded: 0, requeued: 0 });
    expect(ledger.getByJobIds).not.toHaveBeenCalled();
  });
});

describe("reconcileQueuedRows", () => {
  it("returns a row whose job no longer exists natively to pending and drops its staged copy", async () => {
    // `a` is still with iOS. `b` is the force-quit case: its row was marked
    // queued and the process died before (or during) enqueue, so nothing will
    // ever finish it and nothing will ever drain it.
    ledger.listByStatus.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a"), queuedRow("b", "j2", "/s/b")]);
    native.pending.mockResolvedValueOnce([{ jobId: "j1", state: "queued" }]);

    expect(await reconcileQueuedRows()).toBe(1);

    expect(ledger.listByStatus).toHaveBeenCalledWith("w1", ["queued"], expect.any(Number));
    expect(ledger.requeueToPending).toHaveBeenCalledWith("w1", "b", "job missing after relaunch", { charge: false });
    expect(ledger.requeueToPending).toHaveBeenCalledTimes(1);
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/b"]);
  });

  it("leaves a finished session the API has not registered yet alone", async () => {
    // Drained, uploaded, and answered `not_uploaded`: the job is gone from
    // pending() but the row is one settle away from being completed. Requeuing
    // it here would upload the same asset a second time.
    native.drain.mockResolvedValueOnce([{ jobId: "j1", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "j1", code: "not_uploaded", error: "" }] });
    await settleFinishedJobs();

    ledger.listByStatus.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a")]);
    native.pending.mockResolvedValueOnce([]);

    expect(await reconcileQueuedRows()).toBe(0);
    expect(ledger.requeueToPending).not.toHaveBeenCalled();
  });

  /**
   * The settings used to be the source of this list, so a workspace the user
   * took OUT of the destinations was never swept again: its rows stayed queued
   * forever and their staged copies held the budget with nothing left that
   * could name them.
   */
  it("sweeps every workspace the LEDGER knows, not the ones the settings name", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, destinationIds: ["wA"] }, hydrated: true });
    ledger.distinctWorkspaceIds.mockResolvedValueOnce(["wOld", "w1"]);

    await reconcileQueuedRows();

    // wOld has rows and no longer appears in the settings; wA is named by the
    // settings but has no rows yet, so there is nothing of its to sweep.
    expect(ledger.listByStatus.mock.calls.map((c) => c[0])).toEqual(["wOld", "w1"]);
  });

  it("leaves a workspace alone while a batch of its own is between markQueued and enqueue", async () => {
    const { reachedEnqueue, release, planning } = batchStuckAtEnqueue();
    await reachedEnqueue; // the row is queued; iOS has not been handed the job

    expect(await reconcileQueuedRows()).toBe(0);
    expect(ledger.listByStatus).not.toHaveBeenCalled();

    release();
    await planning;
  });

  it("does not requeue a row a batch queued while the listing was out", async () => {
    // The listing is an await: a whole batch can start AND finish inside it,
    // so the pending() snapshot taken before it knows nothing of that job.
    ledger.listByStatus.mockImplementationOnce(async () => {
      const { reachedEnqueue, release, planning } = batchStuckAtEnqueue();
      await reachedEnqueue;
      release();
      await planning;
      return [queuedRow("a", "j9", "/s/a")];
    });
    native.pending
      .mockResolvedValueOnce([])                                 // before the listing: nothing yet
      .mockResolvedValueOnce([{ jobId: "j9", state: "queued" }]); // after it: iOS has the job

    expect(await reconcileQueuedRows()).toBe(0);
    expect(ledger.requeueToPending).not.toHaveBeenCalled();
    expect(native.removeStaged).not.toHaveBeenCalled();
  });

  it("skips the workspace when a batch is still in flight once the listing returns", async () => {
    let started: { release: () => void; planning: Promise<unknown> } | null = null;
    ledger.listByStatus.mockImplementationOnce(async () => {
      const b = batchStuckAtEnqueue();
      await b.reachedEnqueue;
      started = b;
      return [queuedRow("a", "j9", "/s/a")];
    });

    expect(await reconcileQueuedRows()).toBe(0);
    expect(ledger.requeueToPending).not.toHaveBeenCalled();

    started!.release();
    await started!.planning;
  });

  it("asks nothing when there is no workspace to sweep", async () => {
    useWorkspaceStore.setState({ activeId: null } as never);
    expect(await reconcileQueuedRows()).toBe(0);
    expect(ledger.listByStatus).not.toHaveBeenCalled();
  });
});

describe("sweepStagedOrphans", () => {
  it("keeps the staged copies of every queued row across the ledger's workspaces, and nothing else", async () => {
    ledger.distinctWorkspaceIds.mockResolvedValueOnce(["wOld", "w1"]);
    ledger.listByStatus
      .mockResolvedValueOnce([queuedRow("old", "j0", "/s/old")])
      .mockResolvedValueOnce([queuedRow("a", "j1", "/s/a"), queuedRow("b", "j2", null)]);

    await sweepStagedOrphans();

    expect(native.sweepStaging).toHaveBeenCalledWith(["/s/old", "/s/a"]);
  });

  it("does not sweep while a batch is between staging and markQueued", async () => {
    const { reachedEnqueue, release, planning } = batchStuckAtEnqueue();
    await reachedEnqueue;

    await sweepStagedOrphans();
    // Its staged copies have no queued row yet in the ledger the sweep reads,
    // so a sweep now would delete the files out from under the enqueue.
    expect(native.sweepStaging).not.toHaveBeenCalled();

    release();
    await planning;
  });

  it("keeps a large staged copy the caller still owns, and takes it once released", async () => {
    ledger.listPlannable.mockResolvedValueOnce([row("big", "big.mov", 1)]);
    native.stage.mockResolvedValueOnce({ staged: [{ localId: "big", kind: "original", path: "/s/big.mov", size: 60 * 1024 * 1024, filename: "big.mov", mime: "video/quicktime" }], failed: [] });
    const out = await queueNextBatch("w1", { deadlineMs: Number.POSITIVE_INFINITY });
    expect(out.large.map((l) => l.path)).toEqual(["/s/big.mov"]);

    // The row stays pending while the caller's multipart upload runs, so only
    // this hold stops the sweep deleting the file mid-upload.
    await sweepStagedOrphans();
    expect(native.sweepStaging).toHaveBeenLastCalledWith(["/s/big.mov"]);

    releaseStagedLarge(["/s/big.mov"]);
    await sweepStagedOrphans();
    expect(native.sweepStaging).toHaveBeenLastCalledWith([]);
  });

  it("does nothing when the installed native build has no sweepStaging", async () => {
    const saved = native.sweepStaging;
    delete (native as Record<string, unknown>).sweepStaging;
    await expect(sweepStagedOrphans()).resolves.toBeUndefined();
    expect(ledger.listByStatus).not.toHaveBeenCalled();
    (native as Record<string, unknown>).sweepStaging = saved;
  });
});

describe("clearBackgroundUploads", () => {
  it("cancels every pending job and removes the staged copies behind them", async () => {
    native.pending.mockResolvedValueOnce([{ jobId: "j1", state: "running" }, { jobId: "j2", state: "queued" }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a"), queuedRow("b", "j2", "/s/b")]);

    await clearBackgroundUploads();

    expect(native.cancel).toHaveBeenCalledWith(["j1", "j2"]);
    expect(ledger.getByJobIds).toHaveBeenCalledWith(["j1", "j2"]);
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/a", "/s/b"]);
  });

  it("forgets sessions still awaiting their object, so the next account never sees them", async () => {
    native.drain.mockResolvedValueOnce([{ jobId: "j1", ok: true }]);
    ledger.getByJobIds.mockResolvedValueOnce([queuedRow("a", "j1", "/s/a")]);
    api.completeDirect.mockResolvedValueOnce({ completed: [], refused: [{ session_id: "j1", code: "not_uploaded", error: "" }] });
    await settleFinishedJobs();

    native.pending.mockResolvedValueOnce([]);
    await clearBackgroundUploads();

    native.drain.mockResolvedValueOnce([]);
    ledger.getByJobIds.mockClear();
    expect(await settleFinishedJobs()).toEqual({ uploaded: 0, requeued: 0 });
    expect(ledger.getByJobIds).not.toHaveBeenCalled();
  });

  it("also drops the staged copy of a row whose job iOS has already reported", async () => {
    // Drained but never completed (the API never registered the object): iOS
    // knows nothing about it any more, so pending() cannot name its copy.
    native.pending.mockResolvedValueOnce([]);
    ledger.listByStatus.mockResolvedValueOnce([queuedRow("c", "j3", "/s/c")]);

    await clearBackgroundUploads();

    expect(native.cancel).not.toHaveBeenCalled();
    expect(native.removeStaged).toHaveBeenCalledWith(["/s/c"]);
  });

  it("cancels nothing and removes nothing when there is nothing left", async () => {
    native.pending.mockResolvedValueOnce([]);
    await clearBackgroundUploads();
    expect(native.cancel).not.toHaveBeenCalled();
    expect(ledger.getByJobIds).not.toHaveBeenCalled();
    expect(native.removeStaged).not.toHaveBeenCalled();
  });
});
