const mockDeleteAssetsAsync = jest.fn();
mockDeleteAssetsAsync.mockResolvedValue(true);
// The wrapper forwards at call-time - a direct `{ deleteAssetsAsync: mockDeleteAssetsAsync }`
// reference is captured before the `const` above is assigned (import requires are hoisted
// above it by this project's CJS transform), same mechanism as runner.test.ts/pickers.test.ts.
jest.mock("expo-media-library", () => ({ deleteAssetsAsync: (...a: any[]) => mockDeleteAssetsAsync(...a) }));

// An in-memory "disk" for the queue file, so the tests can play a relaunch:
// forget the module's memory, keep the file, and see what comes back.
const mockDisk = new Map<string, string>();
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockDisk.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => mockDisk.get(path) ?? ""),
  writeAsStringAsync: jest.fn(async (path: string, body: string) => { mockDisk.set(path, body); }),
}));

import {
  queueDeleteAfterBackup, flushDeleteAfterBackup, clearDeleteQueue,
  DELETE_QUEUE_FILE, __resetDeleteQueueMemoryForTests,
} from "./cleanup";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "./settings";

const settle = () => new Promise((r) => setTimeout(r, 0));
const onDisk = () => JSON.parse(mockDisk.get(DELETE_QUEUE_FILE) ?? "[]");

beforeEach(() => {
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  mockDisk.clear();
  __resetDeleteQueueMemoryForTests();
  jest.clearAllMocks();
});

describe("delete-after-backup queue survives the process", () => {
  /**
   * The background transport settles uploads in a relaunch that lives for
   * seconds and never reaches a flush. With the queue in memory only, every
   * id it queued died with that process and the originals stayed on the
   * phone for good.
   */
  it("mirrors queued ids to disk and merges them back in a fresh process", async () => {
    withDeleteOn();
    queueDeleteAfterBackup("bg-1");
    queueDeleteAfterBackup("bg-2");
    await settle();
    expect(onDisk()).toEqual(["bg-1", "bg-2"]);

    __resetDeleteQueueMemoryForTests(); // the relaunch died; a foreground run starts
    queueDeleteAfterBackup("fg-1");
    await expect(flushDeleteAfterBackup()).resolves.toBe(3);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(expect.arrayContaining(["bg-1", "bg-2", "fg-1"]));
    // One prompt covered all three, and nothing is left to ask about again.
    expect(onDisk()).toEqual([]);
  });

  it("flushes what an earlier process queued even when this one queued nothing", async () => {
    withDeleteOn();
    mockDisk.set(DELETE_QUEUE_FILE, JSON.stringify(["bg-1"]));
    await expect(flushDeleteAfterBackup()).resolves.toBe(1);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(["bg-1"]);
  });

  it("clears the file with the queue when a run is stopped", async () => {
    withDeleteOn();
    mockDisk.set(DELETE_QUEUE_FILE, JSON.stringify(["old"]));
    queueDeleteAfterBackup("a");
    await settle();
    clearDeleteQueue();
    await settle();
    expect(onDisk()).toEqual([]);
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).not.toHaveBeenCalled();
  });

  it("does not resurrect ids the user already declined to delete", async () => {
    withDeleteOn();
    mockDeleteAssetsAsync.mockRejectedValueOnce(new Error("denied"));
    queueDeleteAfterBackup("a");
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(onDisk()).toEqual([]);
    __resetDeleteQueueMemoryForTests();
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledTimes(1);
  });

  it("shrugs off a corrupt file", async () => {
    withDeleteOn();
    mockDisk.set(DELETE_QUEUE_FILE, "{not json");
    queueDeleteAfterBackup("a");
    await expect(flushDeleteAfterBackup()).resolves.toBe(1);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(["a"]);
  });
});

const withDeleteOn = () =>
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, deleteAfterBackup: true } });

describe("delete-after-backup queue", () => {
  it("batches a whole run into a single OS prompt", async () => {
    withDeleteOn();
    queueDeleteAfterBackup("a");
    queueDeleteAfterBackup("b");
    queueDeleteAfterBackup("c");
    // Nothing happens until the run ends - deleting per asset meant one system
    // confirmation dialog per photo.
    expect(mockDeleteAssetsAsync).not.toHaveBeenCalled();
    await expect(flushDeleteAfterBackup()).resolves.toBe(3);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("queues nothing when the setting is off (default)", async () => {
    queueDeleteAfterBackup("a");
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).not.toHaveBeenCalled();
  });

  it("clears the queue so a second run does not re-delete", async () => {
    withDeleteOn();
    queueDeleteAfterBackup("a");
    await flushDeleteAfterBackup();
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledTimes(1);
  });

  it("never queues the same asset twice within a run", async () => {
    withDeleteOn();
    queueDeleteAfterBackup("a");
    queueDeleteAfterBackup("a");
    await expect(flushDeleteAfterBackup()).resolves.toBe(1);
    expect(mockDeleteAssetsAsync).toHaveBeenCalledWith(["a"]);
  });

  it("swallows a declined or failed deletion - the files are safely backed up", async () => {
    withDeleteOn();
    mockDeleteAssetsAsync.mockRejectedValueOnce(new Error("denied"));
    queueDeleteAfterBackup("a");
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
  });

  it("clearDeleteQueue drops pending ids without deleting (cancelled run)", async () => {
    withDeleteOn();
    queueDeleteAfterBackup("a");
    clearDeleteQueue();
    await expect(flushDeleteAfterBackup()).resolves.toBe(0);
    expect(mockDeleteAssetsAsync).not.toHaveBeenCalled();
  });
});
