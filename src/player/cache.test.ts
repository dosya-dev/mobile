import type { PlayerTrack } from "./types";

// In-memory expo-file-system/legacy. downloadAsync behavior is settable per test.
const mockState = {
  files: new Map<string, string>(),
  downloadImpl: { fn: async (_url: string, dest: string): Promise<{ status: number; uri: string } | undefined> => { mockState.files.set(dest, "audio-bytes"); return { status: 200, uri: dest }; } },
  cancelled: [] as string[],
};

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockState.files.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => {
    if (!mockState.files.has(path)) throw new Error("ENOENT");
    return mockState.files.get(path) as string;
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => { mockState.files.set(path, data); }),
  deleteAsync: jest.fn(async (path: string) => { mockState.files.delete(path); }),
  createDownloadResumable: jest.fn((url: string, dest: string) => ({
    downloadAsync: () => mockState.downloadImpl.fn(url, dest),
    cancelAsync: jest.fn(async () => { mockState.cancelled.push(dest); }),
  })),
}));

import { CACHE_CAP_BYTES, cacheTrack, cancelCachingExcept, getCachedUri, markPlayed, selectEvictions, _resetForTests } from "./cache";
import type { CacheEntry } from "./cache";

const track = (fileId: string, over: Partial<PlayerTrack> = {}): PlayerTrack =>
  ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1000, modifiedAt: 5, ...over });

const INDEX = "file:///cache/audio-cache/index.json";
const readIndex = (): CacheEntry[] => JSON.parse(mockState.files.get(INDEX) ?? "[]");

beforeEach(() => {
  mockState.files.clear();
  mockState.cancelled.length = 0;
  mockState.downloadImpl.fn = async (_url, dest) => { mockState.files.set(dest, "audio-bytes"); return { status: 200, uri: dest }; };
  _resetForTests();
  jest.clearAllMocks();
});

describe("selectEvictions", () => {
  const entry = (fileId: string, sizeBytes: number, lastPlayedAt: number): CacheEntry =>
    ({ fileId, extension: "mp3", sizeBytes, modifiedAt: 1, lastPlayedAt });

  it("evicts nothing while under the cap", () => {
    expect(selectEvictions([entry("a", 100, 1)], 1000)).toEqual([]);
  });

  it("evicts least-recently-played first until under the cap", () => {
    const entries = [entry("newest", 400, 30), entry("oldest", 400, 10), entry("middle", 400, 20)];
    expect(selectEvictions(entries, 900)).toEqual(["oldest"]);
    expect(selectEvictions(entries, 500)).toEqual(["oldest", "middle"]);
  });
});

describe("cacheTrack + getCachedUri", () => {
  it("round-trips: cached track resolves to its file uri", async () => {
    await cacheTrack(track("a1"), "https://r2/a1");
    expect(await getCachedUri(track("a1"))).toBe("file:///cache/audio-cache/a1.mp3");
  });

  it("misses when size or modified changed, and drops the stale entry", async () => {
    await cacheTrack(track("a1"), "https://r2/a1");
    expect(await getCachedUri(track("a1", { modifiedAt: 99 }))).toBeNull();
    expect(readIndex()).toEqual([]);
  });

  it("does not index an HTTP-error download (expired presign writes an error body)", async () => {
    mockState.downloadImpl.fn = async (_url, dest) => { mockState.files.set(dest, '{"ok":false}'); return { status: 403, uri: dest }; };
    await cacheTrack(track("a1"), "https://r2/a1");
    expect(await getCachedUri(track("a1"))).toBeNull();
  });

  it("evicts LRU entries once the cap is exceeded", async () => {
    await cacheTrack(track("big1", { sizeBytes: CACHE_CAP_BYTES - 500 }), "https://r2/big1");
    await markPlayed("big1");
    await cacheTrack(track("big2", { sizeBytes: 1000 }), "https://r2/big2");
    expect(await getCachedUri(track("big1", { sizeBytes: CACHE_CAP_BYTES - 500 }))).toBeNull();
    expect(await getCachedUri(track("big2", { sizeBytes: 1000 }))).toBe("file:///cache/audio-cache/big2.mp3");
  });

  it("stands down after three consecutive failures instead of failing playback", async () => {
    mockState.downloadImpl.fn = async () => { throw new Error("ENOSPC"); };
    await cacheTrack(track("a1"), "u");
    await cacheTrack(track("a2"), "u");
    await cacheTrack(track("a3"), "u");
    mockState.downloadImpl.fn = jest.fn(async (_url, dest) => { mockState.files.set(dest, "x"); return { status: 200, uri: dest }; });
    await cacheTrack(track("a4"), "u");
    expect(mockState.downloadImpl.fn).not.toHaveBeenCalled();
  });

  it("prevents concurrent downloads of the same fileId (TOCTOU guard)", async () => {
    let release1: () => void = () => {};
    mockState.downloadImpl.fn = (_url, dest) => new Promise((resolve) => { release1 = () => resolve({ status: 200, uri: dest }); });
    const pending1 = cacheTrack(track("a1"), "https://r2/a1");
    const pending2 = cacheTrack(track("a1"), "https://r2/a1");
    await new Promise((resolve) => setImmediate(resolve));
    const FileSystem = jest.mocked(require("expo-file-system/legacy"));
    expect(FileSystem.createDownloadResumable.mock.calls.length).toBe(1);
    release1();
    await pending1;
    await pending2;
  });
});

describe("cancelCachingExcept", () => {
  it("cancels in-flight downloads not in the keep set", async () => {
    let release: () => void = () => {};
    mockState.downloadImpl.fn = (_url, dest) => new Promise((resolve) => { release = () => resolve({ status: 200, uri: dest }); });
    const pending = cacheTrack(track("a1"), "https://r2/a1");
    await new Promise((resolve) => setImmediate(resolve));
    cancelCachingExcept(new Set());
    expect(mockState.cancelled).toEqual(["file:///cache/audio-cache/a1.mp3"]);
    release();
    await pending;
  });

  it("does not index a cancelled download that resolves to undefined", async () => {
    let release: () => void = () => {};
    mockState.downloadImpl.fn = (_url, dest) => new Promise((resolve) => { release = () => resolve(undefined); });
    const pending = cacheTrack(track("a1"), "https://r2/a1");
    await new Promise((resolve) => setImmediate(resolve));
    cancelCachingExcept(new Set());
    release();
    await pending;
    expect(await getCachedUri(track("a1"))).toBeNull();
    expect(readIndex()).toEqual([]);
  });
});
