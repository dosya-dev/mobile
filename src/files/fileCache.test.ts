import * as FileSystem from "expo-file-system/legacy";
import { clearCachedFileBytes } from "./fileCache";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  readDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const readDir = FileSystem.readDirectoryAsync as jest.Mock;
const del = FileSystem.deleteAsync as jest.Mock;

describe("clearCachedFileBytes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    del.mockResolvedValue(undefined);
  });

  it("removes every cached entry, whatever wrote it", async () => {
    readDir.mockResolvedValue(["books", "audio-meta", "image_manager_disk_cache", "invoice.pdf", "upload-abc"]);
    await clearCachedFileBytes();
    expect(del).toHaveBeenCalledTimes(5);
    expect(del).toHaveBeenCalledWith("file:///cache/books", { idempotent: true });
    expect(del).toHaveBeenCalledWith("file:///cache/invoice.pdf", { idempotent: true });
    expect(del).toHaveBeenCalledWith("file:///cache/image_manager_disk_cache", { idempotent: true });
  });

  // This runs inside sign-out. One undeletable entry must not strand the rest
  // of the wipe, nor abort the sign-out around it.
  it("keeps going when one entry cannot be deleted", async () => {
    readDir.mockResolvedValue(["a", "b", "c"]);
    del.mockRejectedValueOnce(new Error("EBUSY"));
    await expect(clearCachedFileBytes()).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(3);
  });

  it("keeps the entries it is told to keep - a queued share must survive a cache clear", async () => {
    readDir.mockResolvedValue(["upload-share-up_1.pdf", "upload-share-up_2.pdf", "books"]);
    await clearCachedFileBytes(new Set(["file:///cache/upload-share-up_1.pdf"]));
    expect(del).toHaveBeenCalledWith("file:///cache/upload-share-up_2.pdf", { idempotent: true });
    expect(del).toHaveBeenCalledWith("file:///cache/books", { idempotent: true });
    expect(del).not.toHaveBeenCalledWith("file:///cache/upload-share-up_1.pdf", { idempotent: true });
  });

  it("enters a directory that holds a kept file instead of deleting it wholesale", async () => {
    // expo-document-picker stages picked files in a SUBDIRECTORY of the cache
    // (copyToCacheDirectory), so matching the keep set against top-level names
    // only still deleted a retryable upload's one and only copy.
    readDir.mockImplementation(async (dir: string) => {
      if (dir === "file:///cache/") return ["DocumentPicker", "books"];
      if (dir === "file:///cache/DocumentPicker/") return ["invoice.pdf", "stale.pdf"];
      return [];
    });
    await clearCachedFileBytes(new Set(["file:///cache/DocumentPicker/invoice.pdf"]));
    expect(del).toHaveBeenCalledWith("file:///cache/books", { idempotent: true });
    expect(del).toHaveBeenCalledWith("file:///cache/DocumentPicker/stale.pdf", { idempotent: true });
    expect(del).not.toHaveBeenCalledWith("file:///cache/DocumentPicker", { idempotent: true });
    expect(del).not.toHaveBeenCalledWith("file:///cache/DocumentPicker/invoice.pdf", { idempotent: true });
  });

  it("does not walk into subdirectories when there is nothing to keep (sign-out stays one pass)", async () => {
    readDir.mockImplementation(async (dir: string) => (dir === "file:///cache/" ? ["books", "files"] : ["x"]));
    await clearCachedFileBytes();
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith("file:///cache/books", { idempotent: true });
    expect(del).toHaveBeenCalledWith("file:///cache/files", { idempotent: true });
  });

  it("survives an unreadable cache directory", async () => {
    readDir.mockRejectedValue(new Error("ENOENT"));
    await expect(clearCachedFileBytes()).resolves.toBeUndefined();
    expect(del).not.toHaveBeenCalled();
  });

  it("does nothing when the platform reports no cache directory", async () => {
    const mod = FileSystem as unknown as { cacheDirectory: string | null };
    const original = mod.cacheDirectory;
    mod.cacheDirectory = null;
    await clearCachedFileBytes();
    expect(readDir).not.toHaveBeenCalled();
    mod.cacheDirectory = original;
  });
});
