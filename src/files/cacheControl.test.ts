// A small on-disk tree: two top-level files, a subdirectory with two more, and
// an unreadable entry that must not sink the total.
const mockTree: Record<string, { dir?: boolean; size?: number; children?: string[]; throws?: boolean }> = {
  "file:///cache/": { dir: true, children: ["a.pdf", "files", "broken"] },
  "file:///cache/a.pdf": { size: 100 },
  "file:///cache/files": { dir: true, children: ["x.bin", "index.json"] },
  "file:///cache/files/x.bin": { size: 1000 },
  "file:///cache/files/index.json": { size: 20 },
  "file:///cache/broken": { throws: true },
};
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  readDirectoryAsync: jest.fn(async (dir: string) => {
    const bare = dir.endsWith("/") ? dir.slice(0, -1) : dir;
    const node = mockTree[`${bare}/`] ?? mockTree[bare];
    if (!node?.dir) throw new Error("not a directory");
    return node.children ?? [];
  }),
  getInfoAsync: jest.fn(async (path: string) => {
    const node = mockTree[path] ?? mockTree[`${path}/`];
    if (!node) return { exists: false, isDirectory: false };
    if (node.throws) throw new Error("EACCES");
    return { exists: true, isDirectory: !!node.dir, size: node.size ?? 0 };
  }),
  deleteAsync: jest.fn(async () => {}),
}));
// Referenced lazily inside the factory: babel hoists jest.mock above the
// imports, so an eager `{ Image: mockImage }` would capture `undefined`.
const mockImage = { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) };
jest.mock("expo-image", () => ({
  Image: {
    clearDiskCache: (...a: unknown[]) => mockImage.clearDiskCache(...(a as [])),
    clearMemoryCache: (...a: unknown[]) => mockImage.clearMemoryCache(...(a as [])),
  },
}));
jest.mock("./fileCache", () => ({ clearCachedFileBytes: jest.fn(async () => {}) }));
jest.mock("@/backup/livePhoto", () => ({ clearLivePhotoTemp: jest.fn(async () => {}) }));
jest.mock("./byteStore", () => ({ sweepTransient: jest.fn(async () => {}) }));
// The Vault cache module is import-light on purpose (expo-file-system plus a
// type-only import of the e2ee bundle), so boot can reach it; mocked here so
// the suite needs no file system at all.
jest.mock("@/vault/cache", () => ({ wipeVaultCache: jest.fn(async () => {}) }));

import * as FileSystem from "expo-file-system/legacy";
import { getCacheSizeBytes, clearCaches, sweepSessionCaches } from "./cacheControl";
import { clearCachedFileBytes } from "./fileCache";
import { clearLivePhotoTemp } from "@/backup/livePhoto";
import { sweepTransient } from "./byteStore";
import { wipeVaultCache } from "@/vault/cache";

beforeEach(() => jest.clearAllMocks());

describe("getCacheSizeBytes", () => {
  it("sums every file under the cache directory, recursing into subdirectories", async () => {
    await expect(getCacheSizeBytes()).resolves.toBe(1120);
  });

  it("resolves 0 rather than rejecting when the directory cannot be read", async () => {
    (FileSystem.readDirectoryAsync as jest.Mock).mockRejectedValueOnce(new Error("ENOENT"));
    await expect(getCacheSizeBytes()).resolves.toBe(0);
  });
});

describe("clearCaches", () => {
  it("drops the image caches, the Live Photo extraction dir and every cached byte", async () => {
    await clearCaches();
    expect(mockImage.clearMemoryCache).toHaveBeenCalled();
    expect(mockImage.clearDiskCache).toHaveBeenCalled();
    expect(clearLivePhotoTemp).toHaveBeenCalled();
    expect(clearCachedFileBytes).toHaveBeenCalled();
    expect(wipeVaultCache).toHaveBeenCalled();
  });

  it("keeps going when one step fails", async () => {
    mockImage.clearDiskCache.mockRejectedValueOnce(new Error("no native module"));
    await expect(clearCaches()).resolves.toBeUndefined();
    expect(clearCachedFileBytes).toHaveBeenCalled();
  });
});

describe("clearCaches - staged uploads", () => {
  it("spares the staged copies the persisted upload queue still points at", async () => {
    const keep = new Set(["file:///cache/upload-share-up_1.pdf"]);
    await clearCaches({ keep });
    expect(clearCachedFileBytes).toHaveBeenCalledWith(keep);
  });

  it("passes an empty keep set when nothing is staged", async () => {
    await clearCaches();
    expect(clearCachedFileBytes).toHaveBeenCalledWith(new Set());
  });
});

describe("sweepSessionCaches", () => {
  it("removes the transient (locked / view-only) downloads at launch", async () => {
    await sweepSessionCaches();
    expect(sweepTransient).toHaveBeenCalled();
  });

  it("removes the decrypted Vault cache at launch", async () => {
    // The Vault is always locked at boot, so anything under <cache>/vault is
    // plaintext left by a crash, a force-quit or an OS kill.
    await sweepSessionCaches();
    expect(wipeVaultCache).toHaveBeenCalled();
  });

  it("still sweeps the Vault cache when the transient sweep throws", async () => {
    (sweepTransient as jest.Mock).mockRejectedValueOnce(new Error("EACCES"));
    await expect(sweepSessionCaches()).resolves.toBeUndefined();
    expect(wipeVaultCache).toHaveBeenCalled();
  });
});
