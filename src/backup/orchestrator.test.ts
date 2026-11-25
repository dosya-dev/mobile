jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("./ledger", () => {
  const rows = new Map<string, any>();
  return {
    __rows: rows,
    openLedger: jest.fn(async () => {}),
    upsertAsset: jest.fn(async (a: any) => { if (!rows.has(a.local_id)) rows.set(a.local_id, { ...a, status: "pending", fingerprint: null, mp_session: null }); }),
    getAsset: jest.fn(async (_ws: string, id: string) => rows.get(id) ?? null),
    getAssetsBulk: jest.fn(async (_ws: string, ids: string[]) => {
      const out = new Map();
      for (const id of ids) if (rows.has(id)) out.set(id, rows.get(id));
      return out;
    }),
    setStatus: jest.fn(async (_ws: string, id: string, status: string, extra: any) => { const r = rows.get(id); if (r) Object.assign(r, { status, ...(extra?.fingerprint ? { fingerprint: extra.fingerprint } : {}), ...(extra?.remoteFileId ? { remote_file_id: extra.remoteFileId } : {}) }); }),
    setMpSession: jest.fn(async (_ws: string, id: string, json: string | null) => { const r = rows.get(id); if (r) r.mp_session = json; }),
    markPairChecked: jest.fn(async (_ws: string, id: string) => { const r = rows.get(id); if (r) r.pair_checked = 1; }),
    seedAssets: jest.fn(async (_ws: string, assets: any[]) => {
      for (const a of assets) if (!rows.has(a.local_id)) rows.set(a.local_id, { ...a, size: 0, status: "pending", fingerprint: null, mp_session: null });
    }),
  };
});
// The background transport (iOS). Every pre-existing spec in this file runs
// with `backgroundTransportAvailable` false, i.e. the in-process engine.
jest.mock("./transport/backgroundTransport", () => ({
  backgroundTransportAvailable: jest.fn(() => false),
  queueNextBatch: jest.fn(async () => ({ queued: 0, deduped: 0, unreadable: 0, skippedLarge: 0, large: [], exhausted: true })),
  settleFinishedJobs: jest.fn(async () => ({ uploaded: 0, requeued: 0 })),
  cancelQueuedJobs: jest.fn(async () => {}),
  queuedJobCount: jest.fn(async () => 0),
  releaseStagedLarge: jest.fn(),
}));
// The native module behind the transport: the orchestrator only asks it to
// drop the staged copy of a large file it has finished with.
jest.mock("../../modules/dosya-background-upload", () => {
  const n = {
    stage: jest.fn(async () => ({ staged: [], failed: [] })),
    enqueue: jest.fn(async () => {}),
    pending: jest.fn(async () => [] as unknown[]),
    drain: jest.fn(async () => [] as unknown[]),
    cancel: jest.fn(async () => {}),
    stagingUsage: jest.fn(async () => ({ bytes: 0, files: 0 })),
    removeStaged: jest.fn(async () => {}),
    addListener: jest.fn(() => ({ remove() {} })),
  };
  return { __native: n, backgroundUploadNative: () => n, STAGING_MAX_BYTES: 500 * 1024 * 1024, STAGING_MAX_FILES: 200 };
});
jest.mock("./scanner", () => ({
  scanAssets: jest.fn(async (onBatch: any) => {
    await onBatch([
      { id: "small_new", filename: "a.jpg", uri: "file://a", size: 100, createdAt: 1710000000, mediaType: "photo" },
      { id: "dup", filename: "b.jpg", uri: "file://b", size: 200, createdAt: 1710000000, mediaType: "photo" },
      { id: "big", filename: "v.mp4", uri: "file://v", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
    ]);
    return true;
  }),
  // Echo the light asset back with its (test-provided) uri + size - the real
  // resolveAsset materializes those from the media library just-in-time.
  resolveAsset: jest.fn(async (a: any) => ({ asset: a })),
}));
jest.mock("./fingerprint", () => ({ computeFingerprint: jest.fn(async (uri: string) => "fp:" + uri) }));
jest.mock("./watermark", () => ({
  getWatermark: jest.fn(async () => null),
  advanceWatermark: jest.fn(async () => {}),
  WATERMARK_OVERLAP_S: 3600,
  FULL_RECONCILE_AFTER_S: 86400,
}));
jest.mock("./api", () => ({ checkFingerprints: jest.fn(async () => ({ "fp:file://b": "existing_file_1" })), recordFingerprint: jest.fn(async () => {}) }));
jest.mock("./cleanup", () => ({
  queueDeleteAfterBackup: jest.fn(),
  flushDeleteAfterBackup: jest.fn(async () => 0),
  clearDeleteQueue: jest.fn(),
}));
jest.mock("./albumDefaults", () => ({ ensureAlbumDefaults: jest.fn(async () => {}) }));
jest.mock("./livePhoto", () => ({
  resolvePairedVideo: jest.fn(async () => null),
  livePhotoLedgerId: (id: string) => id + "#video",
}));
jest.mock("./foregroundService", () => ({
  startBackupService: jest.fn(),
  updateBackupService: jest.fn(),
  stopBackupService: jest.fn(),
}));
jest.mock("@/upload/resumable", () => ({ uploadResumable: jest.fn(async () => "file_big") }));
jest.mock("./folders", () => ({ resolveBackupFolder: jest.fn(async () => "backup_folder_1") }));
jest.mock("./completion", () => ({
  ensureBackupCompletionSubscribed: jest.fn(),
  registerBackupUpload: jest.fn(),
  backupLocalIdsInStore: jest.fn(() => new Set()),
  purgeBackupUploadRegistry: jest.fn(),
  settleRunIfDrained: jest.fn(),
}));
// Named with a `mock` prefix: babel-plugin-jest-hoist only allows a
// jest.mock() factory to reference out-of-scope variables that are either
// pure literals or explicitly escape-hatched via a `mock`-prefixed name.
// Mirrors the real store's two readable fields, so specs can assert the phase
// the run ends in and stopBackup can read the workspace it was running for.
const mockRunState = { phase: "idle" as string, workspaceId: null as string | null };
const mockStartScan = jest.fn((_name: string | null, ws: string) => { mockRunState.phase = "scanning"; mockRunState.workspaceId = ws; });
const mockStartUpload = jest.fn(() => { mockRunState.phase = "uploading"; });
const mockIdle = jest.fn(() => { mockRunState.phase = "idle"; });
const mockSetLastUnreadable = jest.fn();
const mockSetBackgroundJobs = jest.fn();
jest.mock("./runState", () => ({
  useBackupRun: {
    getState: () => ({
      startScan: mockStartScan, startUpload: mockStartUpload, idle: mockIdle, setLastUnreadable: mockSetLastUnreadable,
      setBackgroundJobs: mockSetBackgroundJobs,
      phase: mockRunState.phase, workspaceId: mockRunState.workspaceId,
    }),
    setState: (patch: { phase?: string; workspaceId?: string | null }) => { Object.assign(mockRunState, patch); },
  },
}));
// Rest-param signature (not `()`) so the wrapper below can spread into it -
// TS rejects spreading a variadic array into a zero-arg function type.
const mockRecordRun = jest.fn(async (..._args: unknown[]) => {});
// Wrapped in a passthrough arrow (not referenced directly) so the factory
// doesn't capture mockRecordRun's value before its `const` initializer runs
// - see pickers.test.ts / runner.test.ts for the same mechanism.
jest.mock("./history", () => ({ recordBackupRun: (...args: unknown[]) => mockRecordRun(...args) }));
const mockEnqueue = jest.fn();
const mockPatch = jest.fn();
// Mutable, module-scoped so Fix 2's start-of-run filter (useUploadStore.setState)
// has real store state to operate on; reset before every test for isolation.
let mockItems: unknown[] = [];
let mockBatchStartedAt: number | null = null;
beforeEach(() => {
  mockItems = [];
  mockBatchStartedAt = null;
  useUploadBlock.setState({ reason: null });
  // Filters default to the everything shape, so every pre-existing spec in this
  // file exercises exactly the behavior it did before filters existed.
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
});
jest.mock("@/upload/store", () => ({
  useUploadStore: {
    getState: () => ({
      enqueue: mockEnqueue,
      patch: mockPatch,
      foldSettledBk: () => {},
      resetSettledBk: () => {},
      setBatchStartedAt: (t: number | null) => { mockBatchStartedAt = t; },
      batchStartedAt: mockBatchStartedAt,
      items: mockItems,
    }),
    setState: (updater: (s: { items: unknown[] }) => { items: unknown[] }) => {
      mockItems = updater({ items: mockItems }).items;
    },
  },
}));
const mockHold = { reason: null as string | null };
const mockResetManualRunOverride = jest.fn();
jest.mock("@/upload/pacing", () => ({
  getBackupHold: () => mockHold.reason,
  resetManualRunOverride: () => mockResetManualRunOverride(),
}));
jest.mock("@/upload/controller", () => ({
  startUploads: jest.fn(),
  // Mirrors the real FATAL_MARKERS classification, minus the module's heavier imports.
  isFatalUploadError: (msg: string) => /storage limit|not a member|upload permission|not available in this workspace/i.test(msg),
}));

import { AppState, Platform } from "react-native";
import { runBackup, stopBackup, __setLivePhotoBackfillLimit, __setHoldDeadline } from "./orchestrator";
import { resolveAsset } from "./scanner";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "./settings";
import { DEFAULT_BACKUP_FILTERS } from "./filters";
import { flushDeleteAfterBackup } from "./cleanup";
import { ensureAlbumDefaults } from "./albumDefaults";
import { resolvePairedVideo } from "./livePhoto";
import { useUploadBlock } from "@/upload/uploadBlock";
import { setStatus, setMpSession, getAsset, upsertAsset as mockUpsertAsset, markPairChecked, seedAssets } from "./ledger";
import { useBackupRun } from "./runState";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { scanAssets } from "./scanner";
import { checkFingerprints, recordFingerprint } from "./api";
import { computeFingerprint } from "./fingerprint";
import { uploadResumable } from "@/upload/resumable";
import { backupLocalIdsInStore } from "./completion";
import { getWatermark, advanceWatermark } from "./watermark";
import { ApiError } from "@/api";

describe("runBackup", () => {
  it("dedups, enqueues new small assets, and skips large ones", async () => {
    const res = await runBackup("w1", "Personal");

    expect(res.scanned).toBe(3);
    expect(res.deduped).toBe(1);        // "dup" matched an existing fingerprint
    expect(res.enqueued).toBe(1);       // "small_new"
    expect(res.largeUploaded).toBe(1);  // "big" video > 50MB uploaded via multipart
    expect(res.largeFailed).toBe(0);
    expect(uploadResumable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "v.mp4" }),
      "w1",
      expect.any(Function),
      expect.objectContaining({ savedSession: null, onSession: expect.any(Function) }),
    );
    expect(recordFingerprint).toHaveBeenCalledWith("w1", "fp:file://v", "file_big");
    expect(setStatus).toHaveBeenCalledWith("w1", "big", "uploaded", expect.objectContaining({ remoteFileId: "file_big" }));
    // deduped asset marked uploaded (linked) without enqueue
    expect(setStatus).toHaveBeenCalledWith("w1", "dup", "uploaded", expect.objectContaining({ remoteFileId: "existing_file_1" }));
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({ name: "a.jpg", folderId: "backup_folder_1", workspaceId: "w1" })]);
    // Large (multipart) uploads now also appear in the dock (enqueued into the store) and are marked done.
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({ name: "v.mp4", status: "uploading" })]);
    expect(mockPatch).toHaveBeenCalledWith(expect.stringContaining("bk_big_"), { status: "done", progress: 1, fileId: "file_big" });
    // recordFingerprint is NOT called for freshly-enqueued uploads - that happens on upload completion in Phase 4b
    expect(recordFingerprint).not.toHaveBeenCalledWith("w1", "fp:file://a", expect.anything()); // new upload records on completion, not now

    // Orchestrator wiring: run-phase transitions and history recording.
    expect(mockStartScan).toHaveBeenCalledWith("Personal", "w1");
    expect(mockStartUpload).toHaveBeenCalled(); // enqueued > 0
    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    expect(mockRecordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_name: "Personal",
        uploaded: res.enqueued + res.largeUploaded,
      }),
    );
  });
});

// A workspace's location is settled when it is created; the API ignores a
// region on an upload, and runBackup no longer has one to thread.
describe("runBackup - no per-upload location", () => {
  it("enqueues small files and hands large ones to the resumable path with no location on either", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "loc_small", filename: "r.jpg", uri: "file://r", size: 100, createdAt: 1710000000, mediaType: "photo" },
        { id: "loc_big", filename: "r.mp4", uri: "file://rbig", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
      ]);
      return true;
    });

    await runBackup("w1", "Personal");

    const enqueued = mockEnqueue.mock.calls.flatMap((c: any[]) => c[0]);
    expect(enqueued.map((i: any) => i.name)).toContain("r.jpg");
    for (const item of enqueued) expect(item).not.toHaveProperty("region");
    expect(uploadResumable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "r.mp4" }),
      "w1",
      expect.any(Function),
      expect.anything(),
    );
    expect((uploadResumable as jest.Mock).mock.calls[0][0]).not.toHaveProperty("region");
  });
});

describe("runBackup - no-op run", () => {
  it("does not record a history row when the scan finds nothing new, but still flips the run phase to idle", async () => {
    // Nothing to scan at all - no assets enqueued, deduped, or uploaded, so
    // Fix 1's no-op guard (enqueued+deduped+largeUploaded+largeFailed === 0)
    // must suppress the history row entirely (hourly background runs /
    // debounced media-change events would otherwise flood Recent activity
    // with empty "nothing new" rows).
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([]);
      return true;
    });
    (checkFingerprints as jest.Mock).mockClear();
    const recordCallsBefore = mockRecordRun.mock.calls.length;

    const res = await runBackup("w1", "Personal");

    expect(res.enqueued).toBe(0);
    expect(res.deduped).toBe(0);
    expect(res.largeUploaded).toBe(0);
    expect(res.largeFailed).toBe(0);
    expect(checkFingerprints).not.toHaveBeenCalled(); // nothing fresh to fingerprint
    expect(mockRecordRun.mock.calls.length).toBe(recordCallsBefore); // no new history row
    expect(mockIdle).toHaveBeenCalled();
  });
});

describe("runBackup - a second run must not start on top of a live one", () => {
  // The media-change listener fires a gated run whenever the library changes -
  // including while a backup is already uploading. The second run called
  // startScan()/startBackupService() and then, finding nothing new to enqueue,
  // ended with idle() - which tore down the FIRST run's dataSync foreground
  // service. On a real device that cycled the service (and its notification)
  // every few seconds, repeatedly dropping the protection that keeps the
  // upload alive once the screen locks.
  it("returns an empty summary and leaves the running backup alone", async () => {
    let releaseFirst: (() => void) | null = null;
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      await onBatch([]);
      return true;
    });

    const first = runBackup("w1", "Personal");
    await new Promise((r) => setTimeout(r, 0)); // let the first run reach the scan
    (scanAssets as jest.Mock).mockClear();

    const second = await runBackup("w1", "Personal");

    expect(second.scanned).toBe(0);
    expect(second.enqueued).toBe(0);
    expect(scanAssets).not.toHaveBeenCalled(); // it never started a scan of its own

    releaseFirst!();
    await first;
  });

  it("allows the next run once the previous one has finished", async () => {
    await runBackup("w1", "Personal");
    (scanAssets as jest.Mock).mockClear();
    await runBackup("w1", "Personal");
    expect(scanAssets).toHaveBeenCalled();
  });
});

describe("runBackup - large upload failure", () => {
  it("marks the asset error, increments largeFailed, and KEEPS mp_session so the next run can resume the same session", async () => {
    // Isolated asset/id (distinct from the "big" one used above) so this
    // test doesn't depend on / interfere with the shared mock ledger rows
    // populated by the previous describe block.
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "big_fail", filename: "v2.mp4", uri: "file://v2", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
      ]);
      return true;
    });
    (uploadResumable as jest.Mock).mockRejectedValueOnce(new Error("network dropped"));

    const res = await runBackup("w1");

    expect(res.largeFailed).toBe(1);
    expect(res.largeUploaded).toBe(0);
    expect(setStatus).toHaveBeenCalledWith(
      "w1",
      "big_fail",
      "error",
      expect.objectContaining({ lastError: "network dropped", incAttempts: true }),
    );
    const row = await getAsset("w1", "big_fail");
    expect(row?.status).toBe("error");
    // The whole point: mp_session must survive the failure so uploadResumable
    // reuses the SAME server-side session (via status_url) next runBackup,
    // instead of restarting from part 1 and leaking the old session.
    expect(setMpSession).not.toHaveBeenCalledWith("big_fail", null);
  });
});

describe("runBackup - attempts cap", () => {
  it("stops retrying an asset that has hit the attempts cap", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    // "small_new" (from the scanner mock) has permanently failed 5×.
    rows.set("small_new", {
      local_id: "small_new", filename: "a.jpg", size: 100, created_at: 1710000000,
      status: "error", attempts: 5, fingerprint: "fp:file://a", remote_file_id: null, mp_session: null,
    });
    const res = await runBackup("w1");
    expect(res.enqueued).toBe(0); // capped asset is skipped, not re-enqueued
  });
});

describe("runBackup - in-flight asset guard", () => {
  it("does not re-enqueue an asset that already has a live upload-store item", async () => {
    const callsBefore = mockEnqueue.mock.calls.length;
    (backupLocalIdsInStore as jest.Mock).mockReturnValueOnce(new Set(["small_new"]));

    const res = await runBackup("w1");

    // "small_new" is already mid-flight (live upload-store item) - it must
    // not be fingerprinted/enqueued/counted again.
    expect(res.enqueued).toBe(0);
    expect(mockEnqueue.mock.calls.length).toBe(callsBefore);
  });
});

describe("runBackup - a fatal (storage limit) error stops the run exactly there", () => {
  it("stops processing further scan batches once the upload block is set", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "batch1_a", filename: "b1.jpg", uri: "file://b1", size: 100, createdAt: 1710000000, mediaType: "photo" },
      ]);
      // Between batches a fatal upload error lands (what abortBatch does in pump).
      useUploadBlock.setState({ reason: "Storage limit reached." });
      await onBatch([
        { id: "batch2_a", filename: "b2.jpg", uri: "file://b2", size: 100, createdAt: 1710000000, mediaType: "photo" },
      ]);
      return true;
    });

    const res = await runBackup("w1");

    expect(res.enqueued).toBe(1); // batch 1 only
    expect(res.scanned).toBe(1); // batch 2 was never processed - no resolving/fingerprinting/enqueueing
  });

  it("breaks the large-file loop and sets the block on a storage-limit failure", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "L1", filename: "l1.mp4", uri: "file://l1", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
        { id: "L2", filename: "l2.mp4", uri: "file://l2", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
      ]);
      return true;
    });
    const resumableCallsBefore = (uploadResumable as jest.Mock).mock.calls.length;
    (uploadResumable as jest.Mock).mockRejectedValueOnce(new Error("Storage limit reached for this workspace"));

    const res = await runBackup("w1");

    expect(res.largeFailed).toBe(1);
    expect(res.largeUploaded).toBe(0);
    // L2 must never be attempted - the loop stops at the fatal failure.
    expect((uploadResumable as jest.Mock).mock.calls.length).toBe(resumableCallsBefore + 1);
    // And the block is set so auto-backups stay paused.
    expect(useUploadBlock.getState().reason).toMatch(/storage limit/i);
  });

  it("does NOT set the block for a transient large-file failure (network)", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "T1", filename: "t1.mp4", uri: "file://t1", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
        { id: "T2", filename: "t2.mp4", uri: "file://t2", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
      ]);
      return true;
    });
    const resumableCallsBefore = (uploadResumable as jest.Mock).mock.calls.length;
    (uploadResumable as jest.Mock).mockRejectedValueOnce(new Error("network dropped"));

    const res = await runBackup("w1");

    expect(res.largeFailed).toBe(1);
    expect(res.largeUploaded).toBe(1); // T2 still uploads - transient errors don't halt the run
    expect((uploadResumable as jest.Mock).mock.calls.length).toBe(resumableCallsBefore + 2);
    expect(useUploadBlock.getState().reason).toBeNull();
  });

  // The mobile platform switch being off (client.ts sees the 503 and throws
  // an ApiError with this code) ends the run, but unlike a storage-limit error
  // it must NOT set the upload block: that store is persisted, parks the
  // background task until someone taps retry by hand, and raises a "Backup
  // paused" notification. Maintenance ends on its own and the next scheduled
  // run is meant to pick straight back up. It is not this asset's failure
  // either - nothing may be counted or attempted against it.
  it("halts on a surface_disabled ApiError without blocking uploads or marking the asset failed", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "M1", filename: "m1.mp4", uri: "file://m1", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
        { id: "M2", filename: "m2.mp4", uri: "file://m2", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" },
      ]);
      return true;
    });
    const resumableCallsBefore = (uploadResumable as jest.Mock).mock.calls.length;
    const patchCallsBefore = mockPatch.mock.calls.length;
    (uploadResumable as jest.Mock).mockRejectedValueOnce(
      new ApiError("The mobile app is paused for maintenance.", 503, "surface_disabled"),
    );

    // The run resolves - a paused surface is not a failed backup.
    const res = await runBackup("w1");

    expect(res.largeFailed).toBe(0);
    expect(res.largeUploaded).toBe(0);
    // M2 must never be attempted - the loop stops at the halt, same as a fatal error.
    expect((uploadResumable as jest.Mock).mock.calls.length).toBe(resumableCallsBefore + 1);
    // No persistent upload block: the next scheduled run simply retries.
    expect(useUploadBlock.getState().reason).toBeNull();
    // The item is not shown as a failed upload either.
    expect(mockPatch.mock.calls.slice(patchCallsBefore)).toEqual([]);
    // And the asset itself is not marked failed - it stays "pending" (set just
    // before entering this loop), not "error", and never spent an attempt.
    expect((setStatus as jest.Mock).mock.calls).not.toContainEqual(
      expect.arrayContaining(["w1", "M1", "error", expect.anything()]),
    );
    expect(rows.get("M1")?.status).toBe("pending");
  });

  // checkFingerprints is the FIRST network call a real run makes (before any
  // upload is even attempted), so a surface_disabled ApiError there used to
  // reject runBackup() outright - callers reported "Backup failed" and the
  // background task kept retrying every ~15 minutes against a paused surface,
  // instead of the quiet halt the maintenance copy promises.
  it("resolves (does not reject) when the very first checkFingerprints call hits the maintenance gate", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "F1", filename: "f1.jpg", uri: "file://f1", size: 100, createdAt: 1710000000, mediaType: "photo" },
      ]);
      return true;
    });
    (checkFingerprints as jest.Mock).mockRejectedValueOnce(
      new ApiError("The mobile app is paused for maintenance.", 503, "surface_disabled"),
    );
    const enqueueCallsBefore = mockEnqueue.mock.calls.length;
    const resumableCallsBefore = (uploadResumable as jest.Mock).mock.calls.length;
    const setStatusCallsBefore = (setStatus as jest.Mock).mock.calls.length;

    // The promise resolves - this used to reject and surface as "Backup failed".
    const res = await runBackup("w1");

    expect(res.scanned).toBe(1);
    expect(res.enqueued).toBe(0);
    expect(res.deduped).toBe(0);
    // No upload of any kind was attempted - the batch never got past dedup.
    expect(mockEnqueue.mock.calls.length).toBe(enqueueCallsBefore);
    expect((uploadResumable as jest.Mock).mock.calls.length).toBe(resumableCallsBefore);
    // The run ends quietly: no persistent upload block, so the background task
    // is not parked until a manual tap and no "Backup paused" alert fires.
    expect(useUploadBlock.getState().reason).toBeNull();
    // The asset is not marked failed - no additional ledger write happened for
    // it beyond the "pending" upsert already made while materializing the file.
    expect((setStatus as jest.Mock).mock.calls.length).toBe(setStatusCallsBefore);
    expect(rows.get("F1")?.status).toBe("pending");
  });

  // A later batch must make no API call at all once the run has halted: the
  // guard at the top of onBatch sees the run-local flag, where before it saw
  // the upload block this path no longer sets.
  it("makes no further API calls in later batches after a maintenance halt", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([{ id: "G1", filename: "g1.jpg", uri: "file://g1", size: 100, createdAt: 1710000000, mediaType: "photo" }]);
      await onBatch([{ id: "G2", filename: "g2.jpg", uri: "file://g2", size: 100, createdAt: 1710000000, mediaType: "photo" }]);
      return true;
    });
    (checkFingerprints as jest.Mock).mockRejectedValueOnce(
      new ApiError("The mobile app is paused for maintenance.", 503, "surface_disabled"),
    );
    const fpCallsBefore = (checkFingerprints as jest.Mock).mock.calls.length;
    const watermarkCallsBefore = (advanceWatermark as jest.Mock).mock.calls.length;

    const res = await runBackup("w1");

    // Batch two was handed to onBatch but returned at the guard - exactly one
    // checkFingerprints call (the one that hit the gate) was ever made.
    expect((checkFingerprints as jest.Mock).mock.calls.length).toBe(fpCallsBefore + 1);
    expect(res.enqueued).toBe(0);
    expect(useUploadBlock.getState().reason).toBeNull();
    // The watermark must not advance over assets a halted run never looked at.
    expect((advanceWatermark as jest.Mock).mock.calls.length).toBe(watermarkCallsBefore);
  });
});

describe("runBackup - drops settled bk_ items at run start", () => {
  it("removes previously-settled bk_ items (done/error) from the store, keeping non-bk_ items", async () => {
    mockItems = [
      { id: "bk_old_done", name: "old.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "done", progress: 1 },
      { id: "bk_old_error", name: "old2.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "boom" },
      { id: "manual_1", name: "manual.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "done", progress: 1 },
    ];

    await runBackup("w1");

    const ids = (mockItems as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain("bk_old_done");
    expect(ids).not.toContain("bk_old_error");
    expect(ids).toContain("manual_1");
    // Their completion bookkeeping is purged with them.
    const { purgeBackupUploadRegistry } = jest.requireMock("./completion");
    expect(purgeBackupUploadRegistry).toHaveBeenCalledWith(["bk_old_done", "bk_old_error"]);
  });
});

describe("manual stop latch", () => {
  it("stopBackup latches; clearManualStop re-arms", () => {
    const { stopBackup, isManuallyStopped, clearManualStop } = require("./orchestrator");
    expect(isManuallyStopped()).toBe(false);
    stopBackup();
    expect(isManuallyStopped()).toBe(true);
    clearManualStop();
    expect(isManuallyStopped()).toBe(false);
  });
});

describe("runBackup - queue backpressure (bounded RAM)", () => {
  it("waits for the live queue to drain below the ceiling before processing a batch", async () => {
    const { __setMaxLiveQueue } = require("./orchestrator");
    __setMaxLiveQueue(2);
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "wave_1", filename: "w.jpg", uri: "file://w", size: 100, createdAt: 1710000000, mediaType: "photo" },
      ]);
      return true;
    });
    // Queue already at the ceiling: two live bk_ uploads.
    mockItems = [
      { id: "bk_a", status: "queued" },
      { id: "bk_b", status: "uploading" },
    ];

    const run = runBackup("w1");
    await new Promise((r) => setTimeout(r, 700));
    // Still waiting - the batch has not been enqueued.
    expect(mockEnqueue.mock.calls.some((c) => c[0]?.[0]?.name === "w.jpg")).toBe(false);

    // Uploads settle -> room opens -> the batch flows.
    mockItems = [];
    await run;
    expect(mockEnqueue.mock.calls.some((c) => c[0]?.[0]?.name === "w.jpg")).toBe(true);
    __setMaxLiveQueue(120);
  });
});

describe("runBackup - incremental scanning (battery)", () => {
  const wm = jest.requireMock("./watermark");

  it("manual runs always full-scan and then advance the watermark with the newest asset", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    await runBackup("w1", "Personal");
    // Manual -> no watermark read, full scan (no createdAfter).
    expect(getWatermark).not.toHaveBeenCalled();
    expect((scanAssets as jest.Mock).mock.calls.at(-1)[1]).not.toHaveProperty("createdAfter");
    expect(advanceWatermark).toHaveBeenCalledWith("w1", 1710000000, expect.objectContaining({ fullScan: true }));
  });

  it("auto runs scan only past the watermark (minus overlap)", async () => {
    (wm.getWatermark as jest.Mock).mockResolvedValueOnce({
      newestCreatedAt: 1710000000,
      lastFullScanAt: Math.floor(Date.now() / 1000) - 60, // reconcile not due
    });
    await runBackup("w1", undefined, { auto: true });
    expect((scanAssets as jest.Mock).mock.calls.at(-1)[1]).toMatchObject({ createdAfter: 1710000000 - 3600 });
    expect(advanceWatermark).toHaveBeenCalledWith("w1", expect.any(Number), expect.objectContaining({ fullScan: false }));
  });

  it("auto runs full-reconcile when the last full scan is stale", async () => {
    (wm.getWatermark as jest.Mock).mockResolvedValueOnce({
      newestCreatedAt: 1710000000,
      lastFullScanAt: Math.floor(Date.now() / 1000) - 90_000, // > 24h
    });
    await runBackup("w1", undefined, { auto: true });
    expect((scanAssets as jest.Mock).mock.calls.at(-1)[1]).not.toHaveProperty("createdAfter");
    expect(advanceWatermark).toHaveBeenCalledWith("w1", expect.any(Number), expect.objectContaining({ fullScan: true }));
  });

  it("targeted runs process the given assets with no scan at all", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    const scanCalls = (scanAssets as jest.Mock).mock.calls.length;
    const res = await runBackup("w1", undefined, {
      auto: true,
      targetedAssets: [{ id: "shot_1", filename: "s.jpg", createdAt: 1710000123, modifiedAt: 1710000123, mediaType: "photo" }],
    });
    expect((scanAssets as jest.Mock).mock.calls.length).toBe(scanCalls); // untouched
    expect(res.scanned).toBe(1);
    expect(mockEnqueue.mock.calls.some((c) => c[0]?.[0]?.name === "s.jpg")).toBe(true);
    expect(advanceWatermark).toHaveBeenCalledWith("w1", 1710000123, expect.objectContaining({ fullScan: false }));
  });

  it("does not advance the watermark when the scan did not complete (no permission)", async () => {
    (scanAssets as jest.Mock).mockResolvedValueOnce(false);
    (advanceWatermark as jest.Mock).mockClear();
    await runBackup("w1");
    expect(advanceWatermark).not.toHaveBeenCalled();
  });
});

describe("runBackup - unreadable (iCloud) assets are counted, never silent", () => {
  it("counts assets that fail to materialize and publishes the count", async () => {
    const rows = (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
    rows.clear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([
        { id: "icloud_1", filename: "c.jpg", uri: "file://c", size: 100, createdAt: 1710000000, mediaType: "photo" },
        { id: "ok_1", filename: "d.jpg", uri: "file://d", size: 100, createdAt: 1710000000, mediaType: "photo" },
      ]);
      return true;
    });
    const { resolveAsset } = jest.requireMock("./scanner");
    (resolveAsset as jest.Mock)
      .mockImplementationOnce(async () => ({ asset: null, reason: "unreadable" })) // icloud_1 won't download
      .mockImplementationOnce(async (a: unknown) => ({ asset: a }));

    const res = await runBackup("w1");
    expect(res.unreadable).toBe(1);
    expect(res.enqueued).toBe(1);
    expect(mockSetLastUnreadable).toHaveBeenCalledWith(1);
  });
});

describe("runBackup - selection model", () => {
  const rowsOf = () => (jest.requireMock("./ledger") as any).__rows as Map<string, any>;

  const scanOne = (asset: Record<string, unknown>) => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([asset]);
      return true;
    });
  };

  // This file deliberately does not clearAllMocks globally (several specs assert
  // across a whole run), so the counters used below are cleared here instead.
  beforeEach(() => {
    rowsOf().clear();
    (mockEnqueue as jest.Mock).mockClear();
    (flushDeleteAfterBackup as jest.Mock).mockClear();
  });

  it("threads the user's filters into the scan", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] } },
    });
    scanOne({ id: "f1", filename: "a.jpg", uri: "file://a", size: 10, createdAt: 1710000000, mediaType: "photo" });
    await runBackup("w1");
    expect(scanAssets).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ filters: expect.objectContaining({ mediaTypes: ["photo"] }) }),
    );
  });

  it("resolves platform album defaults before the first scan", async () => {
    scanOne({ id: "f2", filename: "a.jpg", uri: "file://a", size: 10, createdAt: 1710000000, mediaType: "photo" });
    await runBackup("w1");
    expect(ensureAlbumDefaults).toHaveBeenCalled();
  });

  it("marks assets over the size cap as skipped_large instead of uploading them", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, maxBytes: 1_000 } },
    });
    scanOne({ id: "toobig", filename: "big.mp4", uri: "file://big", size: 5_000, createdAt: 1710000000, mediaType: "video" });
    const res = await runBackup("w1");
    expect(res.skippedLarge).toBe(1);
    expect(res.enqueued).toBe(0);
    expect(res.largeUploaded).toBe(0);
    // skipped_large has been in the ledger schema since day one and nothing
    // ever wrote it until now.
    expect(setStatus).toHaveBeenCalledWith("w1", "toobig", "skipped_large", expect.any(Object));
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not re-attempt a size-capped asset on the next run", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, maxBytes: 1_000 } },
    });
    const asset = { id: "toobig2", filename: "big.mp4", uri: "file://big", size: 5_000, createdAt: 1710000000, mediaType: "video" };
    scanOne(asset);
    await runBackup("w1");
    (mockEnqueue as jest.Mock).mockClear();
    scanOne(asset);
    const second = await runBackup("w1");
    // Already skipped_large in the ledger - the scan drops it before touching
    // the file, so no iCloud original is re-downloaded either.
    expect(second.skippedLarge).toBe(0);
    expect(second.enqueued).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("uploads a file exactly on the cap", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, maxBytes: 1_000 } },
    });
    scanOne({ id: "exact", filename: "a.jpg", uri: "file://a", size: 1_000, createdAt: 1710000000, mediaType: "photo" });
    const res = await runBackup("w1");
    expect(res.skippedLarge).toBe(0);
    expect(res.enqueued).toBe(1);
  });

  it("reports the skipped-large count in the run history", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, maxBytes: 1_000 } },
    });
    scanOne({ id: "toobig3", filename: "big.mp4", uri: "file://big", size: 5_000, createdAt: 1710000000, mediaType: "video" });
    await runBackup("w1", "Personal");
    // Previously hardcoded to 0 with a comment explaining there was nothing to
    // attribute, because nothing ever produced the number.
    expect(mockRecordRun).toHaveBeenCalledWith(expect.objectContaining({ skipped_large: 1 }));
  });
});

describe("runBackup - real MIME types", () => {
  const scanOne = (asset: Record<string, unknown>) => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([asset]);
      return true;
    });
  };

  beforeEach(() => ((jest.requireMock("./ledger") as any).__rows as Map<string, any>).clear());

  it("sends image/heic for a HEIC still, not the hardcoded image/jpeg", async () => {
    scanOne({ id: "heic", filename: "IMG_1.HEIC", uri: "file://h", size: 10, createdAt: 1710000000, mediaType: "photo" });
    await runBackup("w1");
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({ mime: "image/heic" })]);
  });

  it("sends video/quicktime for a MOV, not the hardcoded video/mp4", async () => {
    scanOne({ id: "mov", filename: "IMG_2.MOV", uri: "file://m", size: 10, createdAt: 1710000000, mediaType: "video" });
    await runBackup("w1");
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({ mime: "video/quicktime" })]);
  });

  it("types large multipart uploads from the filename too", async () => {
    scanOne({ id: "bigmov", filename: "IMG_3.MOV", uri: "file://bm", size: 60 * 1024 * 1024, createdAt: 1710000000, mediaType: "video" });
    await runBackup("w1");
    expect(mockEnqueue).toHaveBeenCalledWith([expect.objectContaining({ name: "IMG_3.MOV", mime: "video/quicktime" })]);
  });
});

describe("runBackup - batched delete-after-backup", () => {
  /** AppState.currentState is a plain property on the mocked module. */
  const setAppState = (state: string) => {
    Object.defineProperty(AppState, "currentState", { value: state, configurable: true, writable: true });
  };

  afterEach(() => setAppState("active"));

  it("flushes the delete queue once, at the end of the run", async () => {
    setAppState("active");
    (flushDeleteAfterBackup as jest.Mock).mockClear();
    await runBackup("w1");
    // One prompt per run, not one per photo.
    expect(flushDeleteAfterBackup).toHaveBeenCalledTimes(1);
  });

  /**
   * The flush raises an OS confirmation dialog. A background relaunch - the
   * hourly task, or the few seconds iOS gives the app when an upload finishes -
   * has nobody to answer it, so the call sits there until the OS kills the
   * process, taking the rest of the settle chain with it. The queue is module
   * state and survives, so the next foreground run offers the lot in one
   * prompt.
   */
  it("does not raise the delete prompt on a run that nobody is looking at", async () => {
    for (const state of ["background", "inactive"]) {
      setAppState(state);
      (flushDeleteAfterBackup as jest.Mock).mockClear();
      await runBackup("w1");
      expect(flushDeleteAfterBackup).not.toHaveBeenCalled();
    }
  });
});

describe("runBackup - Live Photos", () => {
  const scanOne = (asset: Record<string, unknown>) => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([asset]);
      return true;
    });
  };
  const still = { id: "lp1", filename: "IMG_1.HEIC", uri: "file://lp1", size: 10, createdAt: 1710000000, mediaType: "photo" };

  beforeEach(() => {
    ((jest.requireMock("./ledger") as any).__rows as Map<string, any>).clear();
    (mockEnqueue as jest.Mock).mockClear();
    // This file has no global clearAllMocks (several specs assert across a
    // whole run), so per-spec counters are reset here.
    (resolvePairedVideo as jest.Mock).mockClear();
    (resolvePairedVideo as jest.Mock).mockResolvedValue(null);
    (mockUpsertAsset as jest.Mock).mockClear();
  });

  it("uploads the paired video alongside the still", async () => {
    (resolvePairedVideo as jest.Mock).mockResolvedValue({ uri: "file://lp1.mov", size: 2400, name: "IMG_1.MOV" });
    scanOne(still);
    const res = await runBackup("w1");
    const names = (mockEnqueue as jest.Mock).mock.calls.flat(2).map((i: any) => i.name);
    expect(names).toContain("IMG_1.HEIC");
    expect(names).toContain("IMG_1.MOV");
    expect(res.enqueued).toBe(2);
  });

  it("gives the paired video its own ledger row so it dedupes like any asset", async () => {
    (resolvePairedVideo as jest.Mock).mockResolvedValue({ uri: "file://lp1.mov", size: 2400, name: "IMG_1.MOV" });
    scanOne(still);
    await runBackup("w1");
    expect(mockUpsertAsset).toHaveBeenCalledWith(expect.objectContaining({ local_id: "lp1#video" }));
  });

  it("types the sibling as QuickTime", async () => {
    (resolvePairedVideo as jest.Mock).mockResolvedValue({ uri: "file://lp1.mov", size: 2400, name: "IMG_1.MOV" });
    scanOne(still);
    await runBackup("w1");
    const items = (mockEnqueue as jest.Mock).mock.calls.flat(2) as any[];
    expect(items.find((i) => i.name === "IMG_1.MOV")?.mime).toBe("video/quicktime");
  });

  it("adds nothing for an ordinary photo", async () => {
    scanOne({ ...still, id: "plain", filename: "IMG_2.HEIC" });
    const res = await runBackup("w1");
    expect(res.enqueued).toBe(1);
    expect(mockUpsertAsset).not.toHaveBeenCalledWith(expect.objectContaining({ local_id: "plain#video" }));
  });

  it("never asks about videos", async () => {
    scanOne({ id: "vid", filename: "V.mp4", uri: "file://v", size: 10, createdAt: 1710000000, mediaType: "video" });
    await runBackup("w1");
    expect(resolvePairedVideo).not.toHaveBeenCalled();
  });
});

describe("runBackup - Live Photo backfill for stills uploaded before pairing existed", () => {
  const rows = () => (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
  const scanThese = (assets: Record<string, unknown>[]) => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch(assets);
      return true;
    });
  };
  const uploadedStill = (id: string, extra: Record<string, unknown> = {}) => {
    rows().set(id, {
      workspace_id: "w1", local_id: id, filename: `${id}.HEIC`, size: 10, created_at: 1710000000,
      status: "uploaded", fingerprint: `fp:${id}`, remote_file_id: `file_${id}`, mp_session: null, pair_checked: 0, ...extra,
    });
    return { id, filename: `${id}.HEIC`, uri: `file://${id}`, size: 10, createdAt: 1710000000, mediaType: "photo" };
  };

  beforeEach(() => {
    rows().clear();
    (mockEnqueue as jest.Mock).mockClear();
    (mockUpsertAsset as jest.Mock).mockClear();
    (markPairChecked as jest.Mock).mockClear();
    (resolvePairedVideo as jest.Mock).mockClear();
    (resolvePairedVideo as jest.Mock).mockResolvedValue(null);
    __setLivePhotoBackfillLimit(25);
  });

  it("schedules the paired video for an uploaded still that has no #video row, without re-uploading the still", async () => {
    const still = uploadedStill("old1");
    (resolvePairedVideo as jest.Mock).mockResolvedValue({ uri: "file://old1.mov", size: 2400, name: "old1.MOV" });
    scanThese([still]);

    const res = await runBackup("w1");

    expect(resolvePairedVideo).toHaveBeenCalledWith({ id: "old1", uri: "file://old1", filename: "old1.HEIC" });
    expect(mockUpsertAsset).toHaveBeenCalledWith(expect.objectContaining({ local_id: "old1#video", filename: "old1.MOV", size: 2400 }));
    const items = (mockEnqueue as jest.Mock).mock.calls.flat(2) as any[];
    expect(items.map((i) => i.name)).toEqual(["old1.MOV"]);
    expect(items[0]).toMatchObject({ mime: "video/quicktime", folderId: "backup_folder_1", workspaceId: "w1", sourceCreatedAt: 1710000000 });
    expect(res.enqueued).toBe(1);
    expect(markPairChecked).toHaveBeenCalledWith("w1", "old1");
  });

  it("marks an ordinary uploaded still as checked so it is never probed again", async () => {
    scanThese([uploadedStill("plain_old")]);
    await runBackup("w1");
    expect(resolvePairedVideo).toHaveBeenCalledTimes(1);
    expect(markPairChecked).toHaveBeenCalledWith("w1", "plain_old");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("leaves alone stills already checked, stills whose pair row exists, and videos", async () => {
    const checked = uploadedStill("checked", { pair_checked: 1 });
    const paired = uploadedStill("paired");
    rows().set("paired#video", { workspace_id: "w1", local_id: "paired#video", status: "uploaded", pair_checked: 0 });
    rows().set("vid", { workspace_id: "w1", local_id: "vid", status: "uploaded", pair_checked: 0 });
    scanThese([checked, paired, { id: "vid", filename: "vid.MOV", uri: "file://vid", size: 10, createdAt: 1710000000, mediaType: "video" }]);
    await runBackup("w1");
    expect(resolvePairedVideo).not.toHaveBeenCalled();
    expect(markPairChecked).not.toHaveBeenCalled();
  });

  it("bounds the backfill per run so a large library is worked through gradually", async () => {
    __setLivePhotoBackfillLimit(2);
    (resolvePairedVideo as jest.Mock).mockImplementation(async (a: { id: string }) => ({ uri: `file://${a.id}.mov`, size: 100, name: `${a.id}.MOV` }));
    scanThese([uploadedStill("b1"), uploadedStill("b2"), uploadedStill("b3"), uploadedStill("b4")]);
    const res = await runBackup("w1");
    expect(resolvePairedVideo).toHaveBeenCalledTimes(2);
    expect(res.enqueued).toBe(2);
    // The two left over were not marked, so the next run picks them up.
    expect(markPairChecked).toHaveBeenCalledTimes(2);
  });

  it("marks the still checked when it uploads through the normal path", async () => {
    rows().clear();
    scanThese([{ id: "fresh", filename: "fresh.HEIC", uri: "file://fresh", size: 10, createdAt: 1710000000, mediaType: "photo" }]);
    await runBackup("w1");
    expect(markPairChecked).toHaveBeenCalledWith("w1", "fresh");
  });

  it("on Android, resolves the already-uploaded still's uri before probing it for a pair", async () => {
    const originalOS = Platform.OS;
    (Platform as unknown as { OS: string }).OS = "android";
    try {
      // The real batch item for an already-uploaded still is a bare
      // ScannedAsset - no uri. Only resolveAsset() materializes one.
      rows().set("droid1", {
        workspace_id: "w1", local_id: "droid1", filename: "droid1.jpg", size: 10, created_at: 1710000000,
        status: "uploaded", fingerprint: "fp:droid1", remote_file_id: "file_droid1", mp_session: null, pair_checked: 0,
      });
      const scanned = { id: "droid1", filename: "droid1.jpg", createdAt: 1710000000, modifiedAt: 0, mediaType: "photo" };
      scanThese([scanned]);
      (resolveAsset as jest.Mock).mockResolvedValueOnce({ asset: { ...scanned, uri: "file://droid1-real", size: 10 } });
      // Once, not persistently - the mock's baseline (set in this describe's
      // beforeEach) must be back in place for describes that run after this one.
      (resolvePairedVideo as jest.Mock).mockResolvedValueOnce({ uri: "file://droid1.mp4", size: 100, name: "droid1.MP4" });

      await runBackup("w1");

      expect(resolveAsset).toHaveBeenCalledWith(scanned);
      expect(resolvePairedVideo).toHaveBeenCalledWith({ id: "droid1", uri: "file://droid1-real", filename: "droid1.jpg" });
    } finally {
      (Platform as unknown as { OS: string }).OS = originalOS;
    }
  });

  it("on Android, a resolveAsset failure during the probe still marks the still checked and enqueues nothing", async () => {
    const originalOS = Platform.OS;
    (Platform as unknown as { OS: string }).OS = "android";
    try {
      rows().set("droid2", {
        workspace_id: "w1", local_id: "droid2", filename: "droid2.jpg", size: 10, created_at: 1710000000,
        status: "uploaded", fingerprint: "fp:droid2", remote_file_id: "file_droid2", mp_session: null, pair_checked: 0,
      });
      const scanned = { id: "droid2", filename: "droid2.jpg", createdAt: 1710000000, modifiedAt: 0, mediaType: "photo" };
      scanThese([scanned]);
      // The still can't be materialized this run (iCloud-equivalent failure on
      // Android: unreadable / not yet downloaded) - there is no uri to probe with.
      (resolveAsset as jest.Mock).mockResolvedValueOnce({ asset: null, reason: "unreadable" });

      const res = await runBackup("w1");

      expect(resolveAsset).toHaveBeenCalledWith(scanned);
      expect(resolvePairedVideo).toHaveBeenCalledWith({ id: "droid2", uri: undefined, filename: "droid2.jpg" });
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(res.enqueued).toBe(0);
      expect(markPairChecked).toHaveBeenCalledWith("w1", "droid2");
    } finally {
      (Platform as unknown as { OS: string }).OS = originalOS;
    }
  });
});

describe("runBackup - policy hold mid-run", () => {
  afterEach(() => { mockHold.reason = null; });

  it("does not materialize or enqueue anything while the run is waiting for Wi-Fi, and continues once it returns", async () => {
    ((jest.requireMock("./ledger") as any).__rows as Map<string, any>).clear();
    (mockEnqueue as jest.Mock).mockClear();
    (resolveAsset as jest.Mock).mockClear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([{ id: "held", filename: "h.jpg", uri: "file://h", size: 100, createdAt: 1710000000, mediaType: "photo" }]);
      return true;
    });
    mockHold.reason = "waiting for Wi-Fi";

    const run = runBackup("w1");
    await new Promise((r) => setTimeout(r, 1200)); // two backpressure ticks
    // Nothing was downloaded from iCloud or handed to the uploader over cellular.
    expect(resolveAsset).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();

    mockHold.reason = null;
    const res = await run;
    expect(resolveAsset).toHaveBeenCalledTimes(1);
    expect(res.enqueued).toBe(1);
  });
});

describe("runBackup - a hold that never lifts", () => {
  afterEach(() => { mockHold.reason = null; __setHoldDeadline(null); });

  /**
   * Going offline or unplugging mid-run used to park waitForQueueRoom forever,
   * so runBackup never resolved: on Android the foreground service stayed up
   * and a headless background run hung until the OS killed it.
   */
  it("ends the run once the hold outlasts the deadline, leaving the work for the next run", async () => {
    ((jest.requireMock("./ledger") as any).__rows as Map<string, any>).clear();
    (mockEnqueue as jest.Mock).mockClear();
    (resolveAsset as jest.Mock).mockClear();
    (advanceWatermark as jest.Mock).mockClear();
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([{ id: "stuck", filename: "s.jpg", uri: "file://s", size: 100, createdAt: 1710000000, mediaType: "photo" }]);
      return true;
    });
    mockHold.reason = "offline";
    __setHoldDeadline(50);

    const res = await runBackup("w1");

    expect(res.enqueued).toBe(0);
    expect(resolveAsset).not.toHaveBeenCalled(); // nothing materialized over the wrong network
    expect(mockEnqueue).not.toHaveBeenCalled();
    // The scan did not really finish, so the incremental watermark must not
    // move - the next run has to see these assets again.
    expect(advanceWatermark).not.toHaveBeenCalled();
    expect(mockIdle).toHaveBeenCalled();
  });
});

describe("runBackup - a 0-byte asset is recorded, not re-stat'd every run", () => {
  const rows = () => (jest.requireMock("./ledger") as any).__rows as Map<string, any>;
  const empty = { id: "zero", filename: "z.jpg", uri: "file://z", size: 0, createdAt: 1710000000, mediaType: "photo" };
  const scanOne = (a: Record<string, unknown>) => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([a]); return true; });
  };

  beforeEach(() => {
    rows().clear();
    (mockEnqueue as jest.Mock).mockClear();
    (setStatus as jest.Mock).mockClear();
    (mockUpsertAsset as jest.Mock).mockClear();
    (resolveAsset as jest.Mock).mockClear();
    (resolveAsset as jest.Mock).mockResolvedValue({ asset: null, reason: "empty" });
  });
  afterEach(() => { (resolveAsset as jest.Mock).mockImplementation(async (a: any) => ({ asset: a })); });

  it("writes a ledger row with an attempt and an explanation instead of uploading nothing", async () => {
    scanOne(empty);
    const res = await runBackup("w1");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(res.unreadable).toBe(1);
    expect(mockUpsertAsset).toHaveBeenCalledWith(expect.objectContaining({ local_id: "zero" }));
    const call = (setStatus as jest.Mock).mock.calls.find((c) => c[1] === "zero");
    expect(call?.[2]).toBe("error");
    expect(call?.[3]).toMatchObject({ incAttempts: true });
    expect(String(call?.[3].lastError)).toMatch(/empty/i);
  });

  it("stops touching it once it has used up its attempts - no more 1.5s re-stat per run", async () => {
    rows().set("zero", { workspace_id: "w1", local_id: "zero", status: "error", attempts: 5, pair_checked: 1 });
    scanOne(empty);
    const res = await runBackup("w1");
    expect(resolveAsset).not.toHaveBeenCalled();
    expect(res.unreadable).toBe(0);
  });

  it("leaves an unreadable (iCloud) asset alone - it may well download next run", async () => {
    (resolveAsset as jest.Mock).mockResolvedValue({ asset: null, reason: "unreadable" });
    scanOne({ ...empty, id: "icloudy" });
    const res = await runBackup("w1");
    expect(res.unreadable).toBe(1);
    expect((setStatus as jest.Mock).mock.calls.find((c) => c[1] === "icloudy")).toBeUndefined();
  });
});

describe("stopBackup - the manual permission ends with the run", () => {
  /**
   * Stop deletes the queued/uploading items itself, so the completion
   * subscription never sees a last settle - the one path that hands the
   * "over mobile data this time" permission back. Without this the grant
   * outlived the run for the rest of the process (and, through the sign-out
   * purge, into the next account).
   */
  it("withdraws the one-off policy override", () => {
    mockResetManualRunOverride.mockClear();
    mockItems = [
      { id: "bk_a_1", name: "a.jpg", uri: "u", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.3 },
      { id: "up_1_1", name: "b.pdf", uri: "u", size: 1, mime: "application/pdf", folderId: null, workspaceId: "w1", status: "queued", progress: 0 },
    ];
    stopBackup();
    expect(mockResetManualRunOverride).toHaveBeenCalledTimes(1);
    // Unchanged: the user's own upload is not a backup item and stays queued.
    expect((mockItems as { id: string }[]).map((i) => i.id)).toEqual(["up_1_1"]);
  });
});

const transport = jest.requireMock("./transport/backgroundTransport") as Record<string, jest.Mock>;
const native = (jest.requireMock("../../modules/dosya-background-upload") as { __native: Record<string, jest.Mock> }).__native;

describe("runBackup with the background transport", () => {
  const batch = (over: Partial<{ queued: number; deduped: number; unreadable: number; skippedLarge: number; large: unknown[]; exhausted: boolean }> = {}) => ({
    queued: 0, deduped: 0, unreadable: 0, skippedLarge: 0, large: [], exhausted: true, ...over,
  });
  /** A `large` entry as the transport hands it back: over the single-shot cap,
   * staged, and typed by the native side. */
  const large = (localId: string, filename: string) => ({
    localId, path: `file:///staged/${filename}`, size: 60 * 1024 * 1024, filename, mime: "video/quicktime", createdAt: 1710000000,
  });

  beforeEach(() => {
    for (const fn of Object.values(transport)) fn.mockReset();
    transport.backgroundTransportAvailable.mockReturnValue(true);
    transport.queueNextBatch.mockResolvedValue(batch());
    transport.settleFinishedJobs.mockResolvedValue({ uploaded: 0, requeued: 0 });
    transport.cancelQueuedJobs.mockResolvedValue(undefined);
    transport.queuedJobCount.mockResolvedValue(0);
    native.removeStaged.mockClear();
    mockEnqueue.mockClear();
    mockPatch.mockClear();
    (recordFingerprint as jest.Mock).mockClear();
    (computeFingerprint as jest.Mock).mockClear();
    (resolveAsset as jest.Mock).mockReset();
    (resolveAsset as jest.Mock).mockImplementation(async (a: unknown) => ({ asset: a }));
    (seedAssets as jest.Mock).mockClear();
    (uploadResumable as jest.Mock).mockReset();
    (uploadResumable as jest.Mock).mockResolvedValue("file_big");
    mockRunState.phase = "idle";
    mockRunState.workspaceId = null;
  });

  afterAll(() => {
    // Leave the transport inactive for anything that runs after this file's
    // last describe.
    transport.backgroundTransportAvailable.mockReturnValue(false);
  });

  it("seeds every scanned asset, then queues batches until the planner is exhausted, and never materialises in-process", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([{ id: "a", filename: "a.jpg", createdAt: 1, modifiedAt: 1, mediaType: "photo" }]);
      return true;
    });
    transport.queueNextBatch
      .mockResolvedValueOnce(batch({ queued: 25, exhausted: false }))
      .mockResolvedValueOnce(batch({ queued: 0, exhausted: true }));

    const summary = await runBackup("w1", "Personal");

    expect(seedAssets).toHaveBeenCalledWith("w1", [{ local_id: "a", filename: "a.jpg", created_at: 1 }]);
    expect(resolveAsset).not.toHaveBeenCalled();
    expect(transport.queueNextBatch).toHaveBeenCalledTimes(2);
    expect(summary.scanned).toBe(1);
    expect(summary.enqueued).toBe(25);
    expect(useBackupRun.getState().phase).toBe("uploading");
    // Nothing went into the in-process upload store.
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("records how many jobs iOS holds BEFORE handing the run over, so the drain check cannot end it early", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => {
      await onBatch([{ id: "a", filename: "a.jpg", createdAt: 1, modifiedAt: 1, mediaType: "photo" }]);
      return true;
    });
    transport.queueNextBatch.mockResolvedValueOnce(batch({ queued: 25, exhausted: true }));
    transport.queuedJobCount.mockResolvedValue(25);
    mockSetBackgroundJobs.mockClear();
    mockStartUpload.mockClear();

    await runBackup("w1", "Personal");

    expect(mockSetBackgroundJobs).toHaveBeenCalledWith(25);
    // Order matters: startUpload is what arms settleRunIfDrained, and the
    // count has to be in place by then or the run goes idle on the spot.
    expect(mockSetBackgroundJobs.mock.invocationCallOrder[0]).toBeLessThan(mockStartUpload.mock.invocationCallOrder[0]);
  });

  it("stops topping up as soon as a batch queues nothing, even when the planner says it is not exhausted", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    // The shape the transport returns when photo access is denied or the
    // upload block is set: nothing queued, and not exhausted either.
    transport.queueNextBatch.mockResolvedValue(batch({ queued: 0, exhausted: false }));

    await runBackup("w1");

    expect(transport.queueNextBatch).toHaveBeenCalledTimes(1);
  });

  it("settles finished jobs before planning, so a relaunch's results are recorded first", async () => {
    const order: string[] = [];
    transport.settleFinishedJobs.mockImplementationOnce(async () => { order.push("settle"); return { uploaded: 0, requeued: 0 }; });
    transport.queueNextBatch.mockImplementationOnce(async () => { order.push("plan"); return batch(); });

    await runBackup("w1");

    expect(order).toEqual(["settle", "plan"]);
  });

  it("uploads a batch's large staged files in-process, fingerprints them, and removes each staged copy exactly once", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    transport.queueNextBatch.mockResolvedValueOnce(batch({ large: [large("bigmov", "bigmov.mov")] }));

    const summary = await runBackup("w1");

    expect(uploadResumable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bigmov.mov", uri: "file:///staged/bigmov.mov", mime: "video/quicktime" }),
      "w1",
      expect.any(Function),
      expect.anything(),
    );
    expect(summary.largeUploaded).toBe(1);
    // The transport hands large files back unhashed: this loop hashes the
    // staged copy so the file still gets a server-dedup entry.
    expect(computeFingerprint).toHaveBeenCalledWith("file:///staged/bigmov.mov", 60 * 1024 * 1024);
    expect(recordFingerprint).toHaveBeenCalledWith("w1", "fp:file:///staged/bigmov.mov", "file_big");
    expect(native.removeStaged.mock.calls.flatMap((c) => c[0])).toEqual(["file:///staged/bigmov.mov"]);
  });

  it("uploads a large staged file with the type the native side gave it, not one guessed from the extension", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    transport.queueNextBatch.mockResolvedValueOnce(batch({
      large: [{ ...large("odd", "IMG_0001.bin"), mime: "video/quicktime" }],
    }));

    await runBackup("w1");

    expect(uploadResumable).toHaveBeenCalledWith(
      expect.objectContaining({ name: "IMG_0001.bin", mime: "video/quicktime" }),
      "w1",
      expect.any(Function),
      expect.anything(),
    );
  });

  it("takes a large staged file once even when a later batch hands the same one back", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    // The row stays `pending` until this run uploads it, so the planner can
    // legitimately return it again while it is still topping up.
    const v = large("again", "again.mov");
    transport.queueNextBatch
      .mockResolvedValueOnce(batch({ queued: 30, exhausted: false, large: [v] }))
      .mockResolvedValueOnce(batch({ queued: 0, exhausted: true, large: [v] }));

    const summary = await runBackup("w1");

    expect(uploadResumable).toHaveBeenCalledTimes(1);
    expect(summary.largeUploaded).toBe(1);
    expect(summary.largeFailed).toBe(0);
    expect(native.removeStaged.mock.calls.flatMap((c) => c[0])).toEqual(["file:///staged/again.mov"]);
  });

  it("does not stage anything while a policy hold is in force - no iCloud exports over cellular", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    mockHold.reason = "wifi";
    try {
      await runBackup("w1");
    } finally {
      mockHold.reason = null;
    }

    expect(transport.queueNextBatch).not.toHaveBeenCalled();
  });

  it("removes the staged copy of a large file whose upload failed, and of one the run never reached", async () => {
    (scanAssets as jest.Mock).mockImplementationOnce(async (onBatch: any) => { await onBatch([]); return true; });
    transport.queueNextBatch.mockResolvedValueOnce(batch({
      large: [large("b1", "b1.mov"), large("b2", "b2.mov")],
    }));
    // A workspace-fatal error on the first file stops the loop before the second.
    (uploadResumable as jest.Mock).mockRejectedValueOnce(new Error("Workspace storage limit reached"));

    const summary = await runBackup("w1");

    expect(summary.largeFailed).toBe(1);
    expect(summary.largeUploaded).toBe(0);
    expect(native.removeStaged.mock.calls.flatMap((c) => c[0]).sort()).toEqual(["file:///staged/b1.mov", "file:///staged/b2.mov"]);
  });

  it("stopBackup cancels the workspace's queued jobs", () => {
    useBackupRun.setState({ workspaceId: "w1" });

    stopBackup();

    expect(transport.cancelQueuedJobs).toHaveBeenCalledWith("w1");
  });

  it("stopBackup after a relaunch falls back to the active workspace", () => {
    // The jobs outlived the process, so Stop is the first thing this process
    // does: no run has set useBackupRun.workspaceId, and without a fallback
    // the cancel would be skipped and iOS would keep uploading.
    useBackupRun.setState({ workspaceId: null });
    useWorkspaceStore.setState({ activeId: "w9" } as never);

    stopBackup();

    expect(transport.cancelQueuedJobs).toHaveBeenCalledWith("w9");
    useWorkspaceStore.setState({ activeId: null } as never);
  });

  it("stopBackup with no workspace at all cancels nothing", () => {
    useBackupRun.setState({ workspaceId: null });
    useWorkspaceStore.setState({ activeId: null } as never);

    stopBackup();

    expect(transport.cancelQueuedJobs).not.toHaveBeenCalled();
  });
});
