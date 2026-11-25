// In-memory stand-in for the document directory. The queue file is the only
// thing persist.ts writes; staged upload files are only ever stat'ed.
const mockDisk = new Map<string, string>();
const mockStaged = new Set<string>();
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  readAsStringAsync: jest.fn(async (p: string) => {
    if (!mockDisk.has(p)) throw new Error("ENOENT");
    return mockDisk.get(p)!;
  }),
  writeAsStringAsync: jest.fn(async (p: string, v: string) => { mockDisk.set(p, v); }),
  deleteAsync: jest.fn(async (p: string) => { mockDisk.delete(p); }),
  getInfoAsync: jest.fn(async (p: string) => (mockStaged.has(p) ? { exists: true, isDirectory: false, size: 10 } : { exists: false, isDirectory: false })),
}));
const mockStartUploads = jest.fn();
jest.mock("./controller", () => ({ startUploads: () => mockStartUploads() }));

import { useUploadStore } from "./store";
import type { UploadItem } from "./types";
import {
  UPLOAD_QUEUE_FILE,
  persistUploadQueue,
  hydrateUploadQueue,
  resumeUploadQueue,
  startUploadQueuePersistence,
  clearPersistedUploads,
  __resetUploadQueuePersistence,
} from "./persist";
import { makeUploadId } from "./pickers";

const mk = (id: string, over: Partial<UploadItem> = {}): UploadItem => ({
  id, name: `${id}.pdf`, uri: `file:///cache/upload-share-${id}.pdf`, size: 10, mime: "application/pdf",
  folderId: "f1", workspaceId: "w1", status: "queued", progress: 0, ...over,
});

beforeEach(() => {
  mockDisk.clear();
  mockStaged.clear();
  mockStartUploads.mockClear();
  __resetUploadQueuePersistence();
  useUploadStore.setState({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } });
});

describe("upload queue persistence", () => {
  it("writes the user's unsettled uploads and never the backup engine's items", async () => {
    useUploadStore.setState({
      items: [
        mk("up_1_1000"),
        mk("up_2_2000", { status: "uploading", progress: 0.4 }),
        mk("up_3_3000", { status: "error", error: "nope" }),
        mk("up_4_4000", { status: "done", fileId: "f" }),
        mk("bk_asset_5", { status: "queued" }),
      ],
    });
    await persistUploadQueue();
    const saved = JSON.parse(mockDisk.get(UPLOAD_QUEUE_FILE)!) as { items: UploadItem[] };
    expect(saved.items.map((i) => i.id)).toEqual(["up_1_1000", "up_2_2000", "up_3_3000"]);
    // Progress is not a fact about the file; it restarts from zero.
    expect(saved.items[1]).toMatchObject({ status: "uploading", progress: 0 });
  });

  it("queued items survive a store re-hydration; an interrupted one is offered for retry rather than repeated", async () => {
    mockStaged.add("file:///cache/upload-share-up_1_1000.pdf");
    mockStaged.add("file:///cache/upload-share-up_2_2000.pdf");
    useUploadStore.setState({ items: [mk("up_1_1000"), mk("up_2_2000", { status: "uploading", progress: 0.7 })] });
    await persistUploadQueue();

    // "Relaunch": empty store, same disk.
    useUploadStore.setState({ items: [] });
    const kept = await hydrateUploadQueue();

    const items = useUploadStore.getState().items;
    // An `uploading` row may have COMPLETED server-side between the last
    // debounced write and the kill; re-queueing it would silently upload the
    // file twice. The user decides.
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["up_1_1000", "queued"],
      ["up_2_2000", "error"],
    ]);
    expect(items[1].error).toBe("Interrupted - tap to retry");
    expect(items.every((i) => i.progress === 0)).toBe(true);
    // Restoring is not sending: a signed-out launch restores the rows but must
    // not put anything on the wire until there is a session (resumeUploadQueue).
    expect(mockStartUploads).not.toHaveBeenCalled();
    resumeUploadQueue();
    expect(mockStartUploads).toHaveBeenCalledTimes(1);
    // What the launch-time cache sweep must leave alone - the retry needs the file.
    expect(kept).toEqual(new Set(["file:///cache/upload-share-up_1_1000.pdf", "file:///cache/upload-share-up_2_2000.pdf"]));
  });

  it("marks an interrupted upload whose staged file is also gone with the missing-file reason", async () => {
    useUploadStore.setState({ items: [mk("up_9_9000", { status: "uploading", progress: 0.5 })] });
    await persistUploadQueue();
    useUploadStore.setState({ items: [] });
    await hydrateUploadQueue();
    expect(useUploadStore.getState().items[0]).toMatchObject({ status: "error", error: "File is no longer on this device" });
  });

  it("turns an item whose staged file is gone into an error row instead of a doomed retry", async () => {
    mockStaged.add("file:///cache/upload-share-up_1_1000.pdf");
    useUploadStore.setState({ items: [mk("up_1_1000"), mk("up_2_2000")] });
    await persistUploadQueue();
    useUploadStore.setState({ items: [] });

    await hydrateUploadQueue();

    const byId = Object.fromEntries(useUploadStore.getState().items.map((i) => [i.id, i]));
    expect(byId.up_1_1000.status).toBe("queued");
    expect(byId.up_2_2000).toMatchObject({ status: "error", error: "File is no longer on this device" });
    resumeUploadQueue();
    expect(mockStartUploads).toHaveBeenCalledTimes(1);
  });

  it("does not pump when nothing runnable was restored", async () => {
    useUploadStore.setState({ items: [mk("up_3_3000", { status: "error", error: "nope" })] });
    await persistUploadQueue();
    useUploadStore.setState({ items: [] });
    await hydrateUploadQueue();
    expect(useUploadStore.getState().items).toHaveLength(1);
    resumeUploadQueue();
    expect(mockStartUploads).not.toHaveBeenCalled();
  });

  it("never mints an id that collides with a restored one", async () => {
    useUploadStore.setState({ items: [mk("up_7_7000")] });
    await persistUploadQueue();
    useUploadStore.setState({ items: [] });
    await hydrateUploadQueue();
    const fresh = makeUploadId();
    expect(fresh).not.toBe("up_7_7000");
    expect(Number(fresh.split("_")[1])).toBeGreaterThan(7);
  });

  it("skips items already in the store (a second hydrate is a no-op)", async () => {
    mockStaged.add("file:///cache/upload-share-up_1_1000.pdf");
    useUploadStore.setState({ items: [mk("up_1_1000")] });
    await persistUploadQueue();
    await hydrateUploadQueue();
    expect(useUploadStore.getState().items).toHaveLength(1);
  });

  it("resolves to nothing on a missing or corrupt file", async () => {
    await expect(hydrateUploadQueue()).resolves.toEqual(new Set());
    mockDisk.set(UPLOAD_QUEUE_FILE, "{not json");
    await expect(hydrateUploadQueue()).resolves.toEqual(new Set());
    expect(useUploadStore.getState().items).toEqual([]);
  });

  it("keeps the file in step with the store while the app runs, and clears it on purge", async () => {
    jest.useFakeTimers();
    try {
      startUploadQueuePersistence();
      useUploadStore.getState().enqueue([mk("up_1_1000")]);
      await jest.advanceTimersByTimeAsync(1000);
      expect(JSON.parse(mockDisk.get(UPLOAD_QUEUE_FILE)!).items).toHaveLength(1);

      useUploadStore.getState().patch("up_1_1000", { status: "done", fileId: "f" });
      await jest.advanceTimersByTimeAsync(1000);
      expect(JSON.parse(mockDisk.get(UPLOAD_QUEUE_FILE)!).items).toHaveLength(0);

      await clearPersistedUploads();
      expect(mockDisk.has(UPLOAD_QUEUE_FILE)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
