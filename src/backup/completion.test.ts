import { useUploadStore } from "@/upload/store";
import type { UploadItem } from "@/upload/types";

jest.mock("./ledger", () => ({
  getAsset: jest.fn(async (_ws: string, id: string) => ({ local_id: id, fingerprint: "fp_" + id })),
  setStatus: jest.fn(async () => {}),
}));
jest.mock("./api", () => ({ recordFingerprint: jest.fn(async () => {}) }));
jest.mock("./cleanup", () => ({ queueDeleteAfterBackup: jest.fn() }));
// `var` (not const): the factory below is hoisted above the imports, so a
// const would still be in its temporal dead zone when the module is required.
// eslint-disable-next-line no-var
var mockPhase: "idle" | "scanning" | "uploading" = "uploading";
// eslint-disable-next-line no-var
var mockIdle = jest.fn();
// eslint-disable-next-line no-var
var mockBackgroundJobs = 0;
jest.mock("./runState", () => ({ useBackupRun: { getState: () => ({ idle: mockIdle, phase: mockPhase, backgroundJobs: mockBackgroundJobs }) } }));
jest.mock("@/upload/pacing", () => ({ maybeWithdrawPolicyOverride: jest.fn() }));
jest.mock("./livePhoto", () => ({
  isLivePhotoLedgerId: (id: string) => id.endsWith("#video"),
  discardLivePhotoTemp: jest.fn(async () => {}),
}));

import { registerBackupUpload, ensureBackupCompletionSubscribed, __resetBackupCompletion, backupLocalIdsInStore, settleRunIfDrained } from "./completion";
import { setStatus } from "./ledger";
import { recordFingerprint } from "./api";
import { queueDeleteAfterBackup } from "./cleanup";
import { discardLivePhotoTemp } from "./livePhoto";
import { maybeWithdrawPolicyOverride } from "@/upload/pacing";

const flush = () => new Promise((r) => setTimeout(r, 0));

function item(id: string, over: Partial<UploadItem> = {}): UploadItem {
  return { id, name: "a.jpg", uri: "file://a", size: 10, mime: "image/jpeg", folderId: "f1", workspaceId: "w1", status: "uploading", progress: 0, ...over };
}

beforeEach(() => {
  __resetBackupCompletion();
  useUploadStore.setState({ items: [], settledBk: { count: 0, bytes: 0 } });
  mockPhase = "uploading";
  mockBackgroundJobs = 0;
  jest.clearAllMocks();
});

describe("backup completion subscription", () => {
  it("records the fingerprint + flips the ledger to uploaded on done", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_a1_1", "w1", "a1");
    useUploadStore.getState().enqueue([item("bk_a1_1")]);
    useUploadStore.getState().patch("bk_a1_1", { status: "done", progress: 1, fileId: "file_9" });
    await flush();
    expect(recordFingerprint).toHaveBeenCalledWith("w1", "fp_a1", "file_9");
    expect(setStatus).toHaveBeenCalledWith("w1", "a1", "uploaded", { remoteFileId: "file_9" });
  });

  it("marks the ledger error + increments attempts on error", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_a2_2", "w1", "a2");
    useUploadStore.getState().enqueue([item("bk_a2_2")]);
    useUploadStore.getState().patch("bk_a2_2", { status: "error", error: "boom" });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "a2", "error", { lastError: "boom", incAttempts: true });
    expect(recordFingerprint).not.toHaveBeenCalled();
  });

  it("ignores non-backup uploads and processes each done item once", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_a3_3", "w1", "a3");
    useUploadStore.getState().enqueue([item("bk_a3_3"), item("plain_1")]);
    useUploadStore.getState().patch("bk_a3_3", { status: "done", fileId: "file_x" });
    await flush();
    useUploadStore.getState().patch("bk_a3_3", { progress: 1 }); // another store change
    await flush();
    expect(recordFingerprint).toHaveBeenCalledTimes(1); // not reprocessed
    expect(recordFingerprint).not.toHaveBeenCalledWith("w1", expect.anything(), "plain_1");
  });

  it("still flips the ledger to uploaded when recordFingerprint rejects (record is best-effort)", async () => {
    (recordFingerprint as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_a4_4", "w1", "a4");
    useUploadStore.getState().enqueue([item("bk_a4_4")]);
    useUploadStore.getState().patch("bk_a4_4", { status: "done", progress: 1, fileId: "file_4" });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "a4", "uploaded", { remoteFileId: "file_4" });
  });

  it("treats a done item with an empty fileId as an error (retry) instead of silently dropping it", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_a5_5", "w1", "a5");
    useUploadStore.getState().enqueue([item("bk_a5_5")]);
    useUploadStore.getState().patch("bk_a5_5", { status: "done", progress: 1, fileId: "" });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "a5", "error", { lastError: "Upload completed without a file id", incAttempts: true });
    expect(recordFingerprint).not.toHaveBeenCalled();
  });

  it("keeps the registry entry through an error so a later retry-to-done still records", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_r_1", "w1", "r");
    useUploadStore.getState().enqueue([item("bk_r_1")]);

    // First attempt errors out - ledger goes to "error", but the registry
    // entry must survive so a retry can still be recorded later.
    useUploadStore.getState().patch("bk_r_1", { status: "error", error: "net" });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "r", "error", { lastError: "net", incAttempts: true });
    expect(recordFingerprint).not.toHaveBeenCalled();

    // User taps Retry in the upload dock: the controller resets the same
    // upload id back to "queued" and it re-runs to "done".
    useUploadStore.getState().patch("bk_r_1", { status: "queued", error: undefined });
    useUploadStore.getState().patch("bk_r_1", { status: "done", fileId: "file_r" });
    await flush();

    expect(recordFingerprint).toHaveBeenCalledWith("w1", "fp_r", "file_r");
    expect(setStatus).toHaveBeenCalledWith("w1", "r", "uploaded", { remoteFileId: "file_r" });
  });
});

describe("size verification on done", () => {
  it("marks the ledger error (not uploaded) when the server stored a different byte count", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_sz_1", "w1", "sz");
    useUploadStore.getState().enqueue([item("bk_sz_1", { size: 10 })]);
    useUploadStore.getState().patch("bk_sz_1", { status: "done", progress: 1, fileId: "file_sz", uploadedBytes: 7 });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "sz", "error", { lastError: "size mismatch (local 10, server 7)", incAttempts: true });
    expect(setStatus).not.toHaveBeenCalledWith("w1", "sz", "uploaded", expect.anything());
    // A short server copy must never be recorded as the dedup target, and the
    // original must never be offered for deletion on its strength.
    expect(recordFingerprint).not.toHaveBeenCalled();
    expect(queueDeleteAfterBackup).not.toHaveBeenCalled();
    // The dock shows the failure (and can Retry it) instead of a green tick,
    // and the item is not counted as a settled success.
    const row = useUploadStore.getState().items.find((i) => i.id === "bk_sz_1");
    expect(row).toMatchObject({ status: "error", error: "size mismatch (local 10, server 7)" });
    expect(useUploadStore.getState().settledBk).toEqual({ count: 0, bytes: 0 });
    // Further store churn does not re-run the handler.
    useUploadStore.getState().patch("bk_sz_1", { progress: 1 });
    await flush();
    expect(setStatus).toHaveBeenCalledTimes(1);
    // A retry that lands at the right size is still recorded: the registry survived.
    useUploadStore.getState().patch("bk_sz_1", { status: "queued", error: undefined });
    useUploadStore.getState().patch("bk_sz_1", { status: "done", fileId: "file_sz2", uploadedBytes: 10 });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "sz", "uploaded", { remoteFileId: "file_sz2" });
  });

  it("accepts the upload when the server's byte count matches", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_ok_1", "w1", "ok");
    useUploadStore.getState().enqueue([item("bk_ok_1", { size: 10 })]);
    useUploadStore.getState().patch("bk_ok_1", { status: "done", progress: 1, fileId: "file_ok", uploadedBytes: 10 });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "ok", "uploaded", { remoteFileId: "file_ok" });
    expect(queueDeleteAfterBackup).toHaveBeenCalledWith("ok");
  });

  it("still accepts an upload whose response carried no byte count (older server)", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_nb_1", "w1", "nb");
    useUploadStore.getState().enqueue([item("bk_nb_1", { size: 10 })]);
    useUploadStore.getState().patch("bk_nb_1", { status: "done", progress: 1, fileId: "file_nb" });
    await flush();
    expect(setStatus).toHaveBeenCalledWith("w1", "nb", "uploaded", { remoteFileId: "file_nb" });
  });
});

describe("Live Photo temp cleanup", () => {
  it("deletes the extracted .mov once the paired video is recorded, and leaves stills alone", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_lp_v", "w1", "lp1#video");
    registerBackupUpload("bk_lp_s", "w1", "lp1");
    useUploadStore.getState().enqueue([
      item("bk_lp_v", { uri: "file:///cache/dosya-live-photos/lp1.mov" }),
      item("bk_lp_s", { uri: "file:///var/mobile/Media/DCIM/IMG_1.HEIC" }),
    ]);
    useUploadStore.getState().patch("bk_lp_v", { status: "done", progress: 1, fileId: "file_v" });
    useUploadStore.getState().patch("bk_lp_s", { status: "done", progress: 1, fileId: "file_s" });
    await flush();
    expect(discardLivePhotoTemp).toHaveBeenCalledTimes(1);
    expect(discardLivePhotoTemp).toHaveBeenCalledWith("file:///cache/dosya-live-photos/lp1.mov");
  });

  it("keeps the extracted .mov when the upload was short - the retry needs it", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_lp_v2", "w1", "lp2#video");
    useUploadStore.getState().enqueue([item("bk_lp_v2", { uri: "file:///cache/dosya-live-photos/lp2.mov", size: 10 })]);
    useUploadStore.getState().patch("bk_lp_v2", { status: "done", progress: 1, fileId: "file_v2", uploadedBytes: 3 });
    await flush();
    expect(discardLivePhotoTemp).not.toHaveBeenCalled();
  });
});

describe("backupLocalIdsInStore", () => {
  it("does not report a done item with an empty fileId as in-flight (must be allowed to retry)", () => {
    registerBackupUpload("bk_b1_1", "w1", "b1");
    useUploadStore.getState().enqueue([item("bk_b1_1")]);
    useUploadStore.getState().patch("bk_b1_1", { status: "done", fileId: "" });
    expect(backupLocalIdsInStore().has("b1")).toBe(false);
  });

  it("reports a done item WITH a fileId as in-flight (still pending record)", () => {
    registerBackupUpload("bk_b2_2", "w1", "b2");
    useUploadStore.getState().enqueue([item("bk_b2_2")]);
    useUploadStore.getState().patch("bk_b2_2", { status: "done", fileId: "file_x" });
    expect(backupLocalIdsInStore().has("b2")).toBe(true);
  });

  it("reports an uploading item as in-flight", () => {
    registerBackupUpload("bk_b3_3", "w1", "b3");
    useUploadStore.getState().enqueue([item("bk_b3_3")]);
    useUploadStore.getState().patch("bk_b3_3", { status: "uploading" });
    expect(backupLocalIdsInStore().has("b3")).toBe(true);
  });
});

describe("manual run permission is withdrawn with the RUN, not with the scan", () => {
  it("asks to withdraw only once the last backup upload has settled", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_w1_1", "w1", "w1a");
    registerBackupUpload("bk_w2_2", "w1", "w2a");
    useUploadStore.getState().enqueue([item("bk_w1_1"), item("bk_w2_2")]);

    useUploadStore.getState().patch("bk_w1_1", { status: "done", progress: 1, fileId: "f1" });
    await flush();
    // One still uploading - the run is not over, so the permission stands.
    expect(maybeWithdrawPolicyOverride).not.toHaveBeenCalled();

    useUploadStore.getState().patch("bk_w2_2", { status: "done", progress: 1, fileId: "f2" });
    await flush();
    expect(maybeWithdrawPolicyOverride).toHaveBeenCalled();
  });

  it("withdraws after the last item settles as an ERROR too", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_e1_1", "w1", "e1");
    useUploadStore.getState().enqueue([item("bk_e1_1")]);
    useUploadStore.getState().patch("bk_e1_1", { status: "error", error: "boom" });
    await flush();
    expect(maybeWithdrawPolicyOverride).toHaveBeenCalled();
  });

  it("withdraws after a size-mismatch settle", async () => {
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_m1_1", "w1", "m1");
    useUploadStore.getState().enqueue([item("bk_m1_1", { size: 10 })]);
    useUploadStore.getState().patch("bk_m1_1", { status: "done", progress: 1, fileId: "fm", uploadedBytes: 3 });
    await flush();
    expect(maybeWithdrawPolicyOverride).toHaveBeenCalled();
  });
});

describe("a drained queue mid-scan is not the end of the run", () => {
  // The scanner enqueues in batches, so the queue is briefly empty between
  // them. Treating that as the end of the run tore the Android dataSync
  // foreground service down and started it again about once a second: the
  // notification flickered and the upload kept losing the protection that
  // keeps it alive once the screen locks.
  it("does not settle while the scan is still enqueuing", async () => {
    mockPhase = "scanning";
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_s1_1", "w1", "s1");
    useUploadStore.getState().enqueue([item("bk_s1_1")]);
    useUploadStore.getState().patch("bk_s1_1", { status: "done", progress: 1, fileId: "f_s1" });
    await flush();
    expect(mockIdle).not.toHaveBeenCalled();
    expect(maybeWithdrawPolicyOverride).not.toHaveBeenCalled();
  });

  it("settles once the scan has handed over to the upload phase", async () => {
    mockPhase = "uploading";
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_s2_1", "w1", "s2");
    useUploadStore.getState().enqueue([item("bk_s2_1")]);
    useUploadStore.getState().patch("bk_s2_1", { status: "done", progress: 1, fileId: "f_s2" });
    await flush();
    expect(mockIdle).toHaveBeenCalled();
  });

  it("does not settle while iOS still holds jobs for this run, even with the in-process queue empty", () => {
    // On the background transport the uploads are not in the JS store at all,
    // so the in-process queue reads as drained the moment the scan ends. Going
    // idle there made the ring drop out of "running" for the second between
    // the scan's end and the screen's first re-read of the OS queue.
    mockPhase = "uploading";
    mockBackgroundJobs = 12;
    settleRunIfDrained();
    expect(mockIdle).not.toHaveBeenCalled();
    expect(maybeWithdrawPolicyOverride).not.toHaveBeenCalled();
  });

  it("settleRunIfDrained settles a queue that drained before the scan ended", () => {
    // Uploads can all finish while the scan is still running. No further
    // settle event will fire, so the orchestrator calls this directly after
    // it flips to the upload phase - otherwise the run never ends and the
    // notification stays up forever.
    mockPhase = "uploading";
    settleRunIfDrained();
    expect(mockIdle).toHaveBeenCalled();
  });
});

describe("a failing ledger write still settles the run", () => {
  it("settles (and withdraws) even when setStatus rejects on the error path", async () => {
    (setStatus as jest.Mock).mockRejectedValueOnce(new Error("database is locked"));
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_f_1", "w1", "f1");
    useUploadStore.getState().enqueue([item("bk_f_1")]);
    useUploadStore.getState().patch("bk_f_1", { status: "error", error: "boom" });
    await flush();
    // Without a finally, the throw skipped this: the card stayed "Backing up"
    // and the mobile-data permission was never handed back.
    expect(maybeWithdrawPolicyOverride).toHaveBeenCalled();
  });

  it("settles when the success path's ledger write rejects too", async () => {
    (setStatus as jest.Mock).mockRejectedValueOnce(new Error("database is locked"));
    ensureBackupCompletionSubscribed();
    registerBackupUpload("bk_f_2", "w1", "f2");
    useUploadStore.getState().enqueue([item("bk_f_2")]);
    useUploadStore.getState().patch("bk_f_2", { status: "done", progress: 1, fileId: "file_f2" });
    await flush();
    expect(maybeWithdrawPolicyOverride).toHaveBeenCalled();
  });
});
