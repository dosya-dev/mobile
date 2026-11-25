import { useUploadStore } from "./store";
import { startUploads, retryItem, __setUploadRetryDelay, capBackoffMs } from "./controller";
import type { UploadItem } from "./types";

// Named with a `mock` prefix: babel-plugin-jest-hoist only allows a
// jest.mock() factory to reference out-of-scope variables that are either
// "pure" (e.g. object/array literals) or explicitly escape-hatched via a
// `mock`-prefixed name - `jest.fn()` is a call expression, so it isn't
// considered pure and needs the naming convention (see runner.test.ts for
// the same mechanism applied to a different case).
const mockUploadOne = jest.fn();
jest.mock("./runner", () => ({ uploadOne: (...a: any[]) => mockUploadOne(...a) }));
jest.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));
const mockDeleteAsync = jest.fn(async (..._a: any[]) => {});
jest.mock("expo-file-system/legacy", () => ({ deleteAsync: (...a: any[]) => mockDeleteAsync(...a) }));
import { queryClient } from "@/lib/queryClient";
import { useUploadBlock } from "./uploadBlock";
import { usePacing } from "./pacing";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";

const mk = (id: string, workspaceId = "w1"): UploadItem => ({ id, name: id, uri: "file://" + id, size: 1, mime: "image/jpeg", folderId: null, workspaceId, status: "queued", progress: 0 });

beforeEach(() => {
  useUploadStore.setState({ items: [] });
  useUploadBlock.setState({ reason: null });
  usePacing.setState({ thermal: "nominal", charging: true, connected: true, onWifi: true, policyOverride: { wifi: false, charging: false } });
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  jest.clearAllMocks();
});

describe("controller", () => {
  it("uploads all queued items and marks them done + invalidates files", async () => {
    mockUploadOne.mockImplementation(async (_item, _ws, onP) => { onP(1); return { fileId: "file_x", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a"), mk("b")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    const items = useUploadStore.getState().items;
    expect(items.every((i) => i.status === "done")).toBe(true);
    expect(items.every((i) => i.fileId === "file_x")).toBe(true);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["files"] });
    // The Library tab is its own query root, so a photo that just uploaded is
    // only visible there if this fires too.
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["library"] });
  });

  it("marks a failing item as error with the message", async () => {
    mockUploadOne.mockRejectedValue(new Error("nope"));
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    const item = useUploadStore.getState().items[0];
    expect(item.status).toBe("error");
    expect(item.error).toBe("nope");
  });

  it("uploads each item against its own stamped workspace, even when they differ", async () => {
    mockUploadOne.mockImplementation(async (_item, _ws, onP) => { onP(1); return { fileId: "file_x", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a", "w1"), mk("b", "w2")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    const calledWorkspaces = mockUploadOne.mock.calls.map((c) => c[1]).sort();
    expect(calledWorkspaces).toEqual(["w1", "w2"]);
  });

  it("retryItem requeues an errored item and drains it without a workspace argument", async () => {
    mockUploadOne.mockRejectedValueOnce(new Error("nope")).mockImplementation(async (_item, _ws, onP) => { onP(1); return { fileId: "file_y", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items[0].status).toBe("error");
    retryItem("a");
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items[0].status).toBe("done");
    expect(useUploadStore.getState().items[0].fileId).toBe("file_y");
  });

  it("backs off and requeues (not errors) on the concurrency cap, then retries to done", async () => {
    __setUploadRetryDelay(5);
    mockUploadOne
      .mockRejectedValueOnce(new Error("You have 5 uploads in progress. Wait for them to finish before starting more."))
      .mockImplementation(async (_i: any, _w: any, onP: any) => { onP(1); return { fileId: "file_z", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 60));
    // Requeued + retried rather than hard-failing -> ends "done", not "error".
    expect(useUploadStore.getState().items[0].status).toBe("done");
    expect(useUploadStore.getState().items[0].fileId).toBe("file_z");
    __setUploadRetryDelay(5000);
  });

  /**
   * The cap used to be retried forever at a flat delay. A slot that never
   * frees kept the phone re-asking every 5s for the rest of the session.
   */
  it("backs off exponentially on repeated cap answers and gives up as a retryable error", async () => {
    __setUploadRetryDelay(1);
    mockUploadOne.mockRejectedValue(new Error("You have 5 uploads in progress. Wait for them to finish before starting more."));
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    // 40 attempts: 1+2+4+8 then 12ms x 36 = ~450ms of backoff in total.
    await new Promise((r) => setTimeout(r, 1500));
    expect(mockUploadOne).toHaveBeenCalledTimes(41);
    expect(useUploadStore.getState().items[0].status).toBe("error");
    expect(useUploadStore.getState().items[0].error).toMatch(/uploads in progress/);
    // A manual retry starts the count over rather than failing on the spot.
    mockUploadOne.mockClear();
    mockUploadOne
      .mockRejectedValueOnce(new Error("You have 5 uploads in progress."))
      .mockImplementation(async (_i: any, _w: any, onP: any) => { onP(1); return { fileId: "file_c", sizeBytes: null }; });
    retryItem("a");
    await new Promise((r) => setTimeout(r, 60));
    expect(useUploadStore.getState().items[0].status).toBe("done");
    __setUploadRetryDelay(5000);
  });

  it("doubles the cap backoff from the base delay and caps it at 12x", () => {
    expect(capBackoffMs(1, 5000)).toBe(5000);
    expect(capBackoffMs(2, 5000)).toBe(10000);
    expect(capBackoffMs(4, 5000)).toBe(40000);
    expect(capBackoffMs(5, 5000)).toBe(60000);
    expect(capBackoffMs(40, 5000)).toBe(60000);
  });

  it("retries a transient network error (bounded), then succeeds", async () => {
    __setUploadRetryDelay(5);
    mockUploadOne
      .mockRejectedValueOnce(new Error("Error Domain=NSURLErrorDomain Code=-1009 offline"))
      .mockImplementation(async (_i: any, _w: any, onP: any) => { onP(1); return { fileId: "file_n", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 60));
    expect(useUploadStore.getState().items[0].status).toBe("done");
    __setUploadRetryDelay(5000);
  });

  it("aborts the whole batch on a fatal (quota) error - queued files are never attempted", async () => {
    mockUploadOne.mockRejectedValue(new Error("Storage limit reached (5 GB of 5 GB used). Upgrade to get more space."));
    useUploadStore.getState().enqueue([mk("a"), mk("b"), mk("c"), mk("d")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 40));
    const items = useUploadStore.getState().items;
    expect(items.every((i) => i.status === "error")).toBe(true);
    expect(items.every((i) => /Storage limit/.test(i.error ?? ""))).toBe(true);
    // "d" was queued when the first fatal hit -> aborted, never uploaded (concurrency 3).
    expect(mockUploadOne.mock.calls.length).toBeLessThanOrEqual(3);
    // The fatal error also pauses auto-backups until a manual retry.
    expect(useUploadBlock.getState().reason).toMatch(/Storage limit/);
  });

  it("keeps draining the queue even if an item vanishes from the store mid-flight", async () => {
    mockUploadOne.mockImplementation(async (_item, _ws, onP) => { onP(1); return { fileId: "file_x", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a"), mk("b"), mk("c")]);
    // Remove "b" the instant it's picked up (still "uploading"), simulating the
    // near-unreachable not-found branch in runItem - the pump must not stall.
    const unsub = useUploadStore.subscribe((s) => {
      const b = s.items.find((i) => i.id === "b");
      if (b && b.status === "uploading") useUploadStore.getState().remove("b");
    });
    startUploads();
    await new Promise((r) => setTimeout(r, 30));
    unsub();
    const remaining = useUploadStore.getState().items;
    expect(remaining.map((i) => i.id).sort()).toEqual(["a", "c"]);
    expect(remaining.every((i) => i.status === "done")).toBe(true);
  });
});

describe("isFatalUploadError", () => {
  const { isFatalUploadError } = require("./controller");
  it("classifies workspace-fatal errors", () => {
    expect(isFatalUploadError("Storage limit reached for this workspace")).toBe(true);
    expect(isFatalUploadError("You are not a member of this workspace")).toBe(true);
  });
  it("does not classify transient/hard errors as fatal", () => {
    expect(isFatalUploadError("network dropped")).toBe(false);
    expect(isFatalUploadError("Upload failed (500)")).toBe(false);
  });
});

describe("adaptive concurrency", () => {
  it("respects the pacing cap (1 while warm on battery), still drains the queue", async () => {
    const { usePacing } = require("./pacing");
    usePacing.setState({ thermal: "fair", charging: false });
    let inFlight = 0;
    let peak = 0;
    mockUploadOne.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { fileId: "file_x", sizeBytes: null };
    });
    useUploadStore.getState().enqueue([mk("c1"), mk("c2"), mk("c3")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 100));
    expect(useUploadStore.getState().items.every((i) => i.status === "done")).toBe(true);
    expect(peak).toBe(1);
    usePacing.setState({ thermal: "nominal", charging: true });
  });

  it("starts nothing while cooling (cap 0)", async () => {
    const { usePacing } = require("./pacing");
    usePacing.setState({ thermal: "serious", charging: true });
    mockUploadOne.mockImplementation(async () => "file_x");
    useUploadStore.getState().enqueue([mk("h1")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items[0].status).toBe("queued");
    usePacing.setState({ thermal: "nominal", charging: true });
  });
});

describe("coalesced file-list invalidation", () => {
  it("refreshes once immediately, then coalesces a burst into one trailing refresh", async () => {
    const { __setInvalidateWindow } = require("./controller");
    __setInvalidateWindow(40);
    mockUploadOne.mockImplementation(async () => "file_x");
    useUploadStore.getState().enqueue([mk("i1"), mk("i2"), mk("i3"), mk("i4")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 15)); // all four settle inside the window
    // Two calls per invalidation, one per query root - what is coalesced is the
    // ROUND, not the roots inside it.
    const keys = () => (queryClient.invalidateQueries as jest.Mock).mock.calls.map(([a]) => a);
    expect(keys()).toEqual([{ queryKey: ["files"] }, { queryKey: ["library"] }]);
    await new Promise((r) => setTimeout(r, 60)); // trailing invalidation fires
    expect(keys()).toEqual([
      { queryKey: ["files"] }, { queryKey: ["library"] },
      { queryKey: ["files"] }, { queryKey: ["library"] },
    ]);
    __setInvalidateWindow(5000);
  });
});

describe("the server's byte count reaches the store", () => {
  it("records uploadedBytes so the backup completion handler can verify the upload", async () => {
    mockUploadOne.mockImplementation(async (_i, _w, onP) => { onP(1); return { fileId: "file_v", sizeBytes: 4096 }; });
    useUploadStore.getState().enqueue([mk("bk_a_1")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items[0]).toMatchObject({ status: "done", fileId: "file_v", uploadedBytes: 4096 });
  });

  it("leaves it unset when the server reported none, so nothing is compared against a guess", async () => {
    mockUploadOne.mockImplementation(async (_i, _w, onP) => { onP(1); return { fileId: "file_v", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("bk_b_1")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items[0].uploadedBytes).toBeUndefined();
  });
});

describe("Live Photo temp cleanup", () => {
  it("deletes the extracted video's cache copy once its upload is done", async () => {
    mockUploadOne.mockImplementation(async (_i, _w, onP) => { onP(1); return { fileId: "file_v", sizeBytes: null }; });
    useUploadStore.getState().enqueue([{ ...mk("a"), pairedTempUri: "file:///cache/dosya-live-photos/a.mov" }]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///cache/dosya-live-photos/a.mov", { idempotent: true });
  });

  it("touches nothing for an ordinary upload with no paired video", async () => {
    mockUploadOne.mockImplementation(async (_i, _w, onP) => { onP(1); return { fileId: "file_v", sizeBytes: null }; });
    useUploadStore.getState().enqueue([mk("a")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockDeleteAsync).not.toHaveBeenCalled();
  });
});

describe("policy hold on backup items", () => {
  it("leaves bk_ items queued while held (cellular + wifiOnly) but still drains the user's own uploads", async () => {
    mockUploadOne.mockImplementation(async (_item, _ws, onP) => { onP(1); return { fileId: "file_h", sizeBytes: null }; });
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    usePacing.setState({ connected: true, onWifi: false });
    useUploadStore.getState().enqueue([mk("bk_photo_1"), mk("up_doc_1")]);
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    const byId = Object.fromEntries(useUploadStore.getState().items.map((i) => [i.id, i.status]));
    expect(byId).toEqual({ bk_photo_1: "queued", up_doc_1: "done" });
    expect(mockUploadOne).toHaveBeenCalledTimes(1);

    // Wi-Fi returns: the pump picks the backup item up.
    usePacing.setState({ onWifi: true });
    startUploads();
    await new Promise((r) => setTimeout(r, 20));
    expect(useUploadStore.getState().items.find((i) => i.id === "bk_photo_1")?.status).toBe("done");
  });
});
