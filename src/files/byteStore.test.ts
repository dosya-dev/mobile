import type { StorableFile } from "./byteStore";
import * as FileSystem from "expo-file-system/legacy";

// In-memory expo-file-system/legacy, same shape as player/cache.test.ts.
// `sizes` is separate from `files` so a test can simulate a truncated download:
// the path exists, but its size disagrees with the file's real byte count.
const mockState = {
  files: new Map<string, string>(),
  sizes: new Map<string, number>(),
  downloadImpl: {
    fn: async (_url: string, dest: string): Promise<{ status: number; uri: string } | undefined> => {
      mockState.files.set(dest, "bytes");
      return { status: 200, uri: dest };
    },
  },
  downloads: [] as string[],
  cancelled: [] as string[],
};

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: mockState.files.has(path),
    size: mockState.sizes.get(path) ?? 100,
  })),
  readDirectoryAsync: jest.fn(async (dir: string) =>
    [...mockState.files.keys()].filter((p) => p.startsWith(dir)).map((p) => p.slice(dir.length)),
  ),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockState.files.has(path)) throw new Error("ENOENT");
    return mockState.files.get(path) as string;
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => { mockState.files.set(path, data); }),
  deleteAsync: jest.fn(async (path: string) => { mockState.files.delete(path); mockState.sizes.delete(path); }),
  createDownloadResumable: jest.fn((url: string, dest: string) => ({
    downloadAsync: () => { mockState.downloads.push(dest); return mockState.downloadImpl.fn(url, dest); },
    cancelAsync: async () => { mockState.cancelled.push(dest); },
  })),
}));

import {
  CAP_BYTES, ensureLocal, forget, localUri, selectEvictions, storePath, _resetForTests,
  storeTransient, sweepTransient, TRANSIENT_DIR, __setTransientCapForTests,
  type StoreEntry,
} from "./byteStore";

const file = (id: string, over: Partial<StorableFile> = {}): StorableFile => ({
  id,
  current_version: 1,
  extension: ".docx",
  name: `${id}.docx`,
  size_bytes: 100,
  lock_mode: "none",
  ...over,
});

const INDEX = "file:///cache/files/index.json";
const readIndex = (): StoreEntry[] => JSON.parse(mockState.files.get(INDEX) ?? "[]");
const url = async () => "https://api.dosya.dev/raw";

beforeEach(() => {
  mockState.files.clear();
  mockState.sizes.clear();
  mockState.downloads.length = 0;
  mockState.downloadImpl.fn = async (_u, dest) => { mockState.files.set(dest, "bytes"); return { status: 200, uri: dest }; };
  _resetForTests();
  jest.clearAllMocks();
});

describe("selectEvictions", () => {
  const entry = (fileId: string, sizeBytes: number, lastUsedAt: number): StoreEntry =>
    ({ fileId, version: 1, ext: "docx", sizeBytes, lastUsedAt });

  it("keeps everything when the total is under the cap", () => {
    expect(selectEvictions([entry("a", 10, 1), entry("b", 10, 2)], 100)).toEqual([]);
  });

  it("drops least-recently-used first, and only as far as the cap needs", () => {
    const entries = [entry("new", 60, 300), entry("old", 60, 100), entry("mid", 60, 200)];
    expect(selectEvictions(entries, 130)).toEqual(["old"]);
  });

  it("can empty the store when one file alone is over the cap", () => {
    expect(selectEvictions([entry("huge", 500, 1)], 100)).toEqual(["huge"]);
  });
});

describe("storePath", () => {
  it("keys on the version, so an edited file cannot serve its old bytes", () => {
    expect(storePath(file("f1", { current_version: 2 }))).not.toBe(storePath(file("f1", { current_version: 1 })));
  });

  it("falls back to the name's extension, then to bin", () => {
    expect(storePath(file("f1", { extension: null, name: "report.pptx" }))).toMatch(/\.pptx$/);
    expect(storePath(file("f1", { extension: null, name: "noext" }))).toMatch(/\.bin$/);
  });
});

describe("localUri", () => {
  it("is null before anything is stored", async () => {
    expect(await localUri(file("f1"))).toBeNull();
  });

  it("returns the path once the bytes are there", async () => {
    await ensureLocal(file("f1"), url);
    expect(await localUri(file("f1"))).toBe(storePath(file("f1")));
  });

  it("is null for a newer version of a file already stored", async () => {
    await ensureLocal(file("f1"), url);
    expect(await localUri(file("f1", { current_version: 2 }))).toBeNull();
  });

  it("rejects a half-written file rather than serving a truncated document", async () => {
    await ensureLocal(file("f1"), url);
    mockState.sizes.set(storePath(file("f1")), 7); // killed mid-transfer
    expect(await localUri(file("f1"))).toBeNull();
  });
});

describe("ensureLocal", () => {
  it("downloads once and reuses the copy on the next open", async () => {
    await ensureLocal(file("f1"), url);
    await ensureLocal(file("f1"), url);
    expect(mockState.downloads).toHaveLength(1);
  });

  it("downloads once when two stages open the same file at the same time", async () => {
    // Two viewer stages mounting together must not each pull the whole file.
    await Promise.all([ensureLocal(file("f1"), url), ensureLocal(file("f1"), url)]);
    expect(mockState.downloads).toHaveLength(1);
  });

  it("re-downloads after the file is edited on the server", async () => {
    await ensureLocal(file("f1"), url);
    await ensureLocal(file("f1", { current_version: 2 }), url);
    expect(mockState.downloads).toHaveLength(2);
  });

  it("deletes the previous version's bytes instead of keeping both", async () => {
    await ensureLocal(file("f1"), url);
    await ensureLocal(file("f1", { current_version: 2 }), url);
    expect(mockState.files.has(storePath(file("f1", { current_version: 1 })))).toBe(false);
  });

  it("throws and leaves nothing behind when the server refuses", async () => {
    // downloadAsync writes the error body to disk rather than rejecting, so a
    // 403 would otherwise be cached as if it were the document.
    mockState.downloadImpl.fn = async (_u, dest) => { mockState.files.set(dest, '{"ok":false}'); return { status: 403, uri: dest }; };
    await expect(ensureLocal(file("f1"), url)).rejects.toThrow();
    expect(mockState.files.has(storePath(file("f1")))).toBe(false);
    expect(await localUri(file("f1"))).toBeNull();
  });

  it("evicts the least recently used file to stay under the cap", async () => {
    const big = Math.floor(CAP_BYTES / 2) + 1;
    await ensureLocal(file("a", { size_bytes: big }), url);
    await ensureLocal(file("b", { size_bytes: big }), url);
    expect(readIndex().map((e) => e.fileId)).toEqual(["b"]);
    expect(mockState.files.has(storePath(file("a", { size_bytes: big })))).toBe(false);
  });
});

describe("restricted files", () => {
  // cachePolicy.mayPersistBytes is a product decision: a view-only file's bytes
  // must not survive the session. A local copy is precisely what the mode
  // exists to prevent, so the store refuses rather than quietly obliging.
  it("refuses to write a view_only file to disk", async () => {
    await expect(ensureLocal(file("f1", { lock_mode: "view_only" }), url)).resolves.toBeNull();
    expect(mockState.downloads).toHaveLength(0);
  });

  it("refuses to write a full_lock file to disk", async () => {
    await expect(ensureLocal(file("f1", { lock_mode: "full_lock" }), url)).resolves.toBeNull();
    expect(mockState.downloads).toHaveLength(0);
  });

  it("never reports a local copy for a restricted file", async () => {
    expect(await localUri(file("f1", { lock_mode: "view_only" }))).toBeNull();
  });
});

describe("renditions", () => {
  // An office document previews as a server-converted PDF. Both it and the
  // original .docx are "file f1, version 1", so without a variant in the key
  // they overwrite each other and a PDF viewer gets handed a docx.
  // No sizeBytes: the size of a server-converted PDF is not known until it
  // lands, which is exactly why the store records a rendition's own size.
  const pdf = { variant: "pdf", ext: "pdf" };

  it("stores a rendition alongside the original, not on top of it", async () => {
    await ensureLocal(file("f1"), url);
    await ensureLocal(file("f1"), url, pdf);
    expect(mockState.downloads).toHaveLength(2);
    expect(await localUri(file("f1"))).toBe(storePath(file("f1")));
    expect(await localUri(file("f1"), pdf)).toBe(storePath(file("f1"), pdf));
    expect(storePath(file("f1"), pdf)).not.toBe(storePath(file("f1")));
  });

  it("gives the rendition its own path ending in its own extension", async () => {
    expect(storePath(file("f1"), pdf)).toMatch(/\.pdf$/);
  });

  it("does not report a rendition as present just because the original is", async () => {
    await ensureLocal(file("f1"), url);
    expect(await localUri(file("f1"), pdf)).toBeNull();
  });

  it("re-fetches a rendition after the file is edited", async () => {
    await ensureLocal(file("f1"), url, pdf);
    await ensureLocal(file("f1", { current_version: 2 }), url, pdf);
    expect(mockState.downloads).toHaveLength(2);
    expect(await localUri(file("f1", { current_version: 2 }), pdf)).toBeTruthy();
  });
});

describe("forget", () => {
  it("removes the bytes and the index entry", async () => {
    await ensureLocal(file("f1"), url);
    await forget("f1");
    expect(await localUri(file("f1"))).toBeNull();
    expect(readIndex()).toEqual([]);
  });
});

describe("failure handling", () => {
  it("reports a miss rather than throwing when the index is corrupt", async () => {
    mockState.files.set(INDEX, "not json{");
    expect(await localUri(file("f1"))).toBeNull();
  });
});

describe("cancelling a transfer", () => {
  // A progress bar with no way out is a trap on a 512MB cellular download.
  // The caller cannot reach the resumable task otherwise - it is created deep
  // inside the job - so the store hands it out the moment it exists.
  it("hands the caller a way to stop the download it just started", async () => {
    let stop: (() => Promise<void>) | null = null;
    await ensureLocal(file("f1"), url, { onTask: (t) => { stop = () => t.cancelAsync(); } });
    expect(stop).not.toBeNull();
    await stop!();
    expect(mockState.cancelled).toContain(storePath(file("f1")));
  });

  it("does not require one, so every other caller is unaffected", async () => {
    await expect(ensureLocal(file("f2"), url)).resolves.toBeTruthy();
  });
});

describe("transient store (locked / view-only downloads)", () => {
  const TINDEX = `${TRANSIENT_DIR}index.json`;
  afterEach(() => __setTransientCapForTests(null));

  it("writes under files/transient/ and evicts the least recently used once over its own cap", async () => {
    __setTransientCapForTests(250); // every mock file is 100 bytes
    const a = await storeTransient("https://r2/a", "a.pdf");
    const b = await storeTransient("https://r2/b", "b.pdf");
    const c = await storeTransient("https://r2/c", "c.pdf");
    expect([a, b, c]).toEqual([`${TRANSIENT_DIR}a.pdf`, `${TRANSIENT_DIR}b.pdf`, `${TRANSIENT_DIR}c.pdf`]);
    expect(mockState.files.has(a)).toBe(false); // oldest went
    expect(mockState.files.has(b)).toBe(true);
    expect(mockState.files.has(c)).toBe(true);
    const idx = JSON.parse(mockState.files.get(TINDEX) as string) as StoreEntry[];
    expect(idx.map((e) => e.fileId).sort()).toEqual(["transient:b.pdf", "transient:c.pdf"]);
  });

  it("never evicts the file it just wrote, even when it alone is over the cap", async () => {
    __setTransientCapForTests(50);
    const a = await storeTransient("https://r2/a", "a.pdf");
    expect(mockState.files.has(a)).toBe(true);
  });

  it("sanitizes the filename into a single path segment", async () => {
    const p = await storeTransient("https://r2/x", "../weird name?.pdf");
    expect(p).toBe(`${TRANSIENT_DIR}.._weird_name_.pdf`);
  });

  it("keeps the byte store's own files out of the transient index and vice versa", async () => {
    await storeTransient("https://r2/a", "a.pdf");
    await ensureLocal(file("doc1"), url);
    expect(readIndex().map((e) => e.fileId)).toEqual(["doc1"]);
    const tidx = JSON.parse(mockState.files.get(TINDEX) as string) as StoreEntry[];
    expect(tidx.map((e) => e.fileId)).toEqual(["transient:a.pdf"]);
  });

  it("sweepTransient removes the whole area", async () => {
    await storeTransient("https://r2/a", "a.pdf");
    await sweepTransient();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(TRANSIENT_DIR, { idempotent: true });
  });
});
