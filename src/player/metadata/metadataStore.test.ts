const mockFiles = new Map<string, string>();
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async (p: string) => { if (!mockFiles.has(p)) throw new Error("ENOENT"); return mockFiles.get(p) as string; }),
  writeAsStringAsync: jest.fn(async (p: string, d: string) => { mockFiles.set(p, d); }),
  deleteAsync: jest.fn(async (p: string) => { mockFiles.delete(p); }),
  getInfoAsync: jest.fn(async (p: string) => ({ exists: mockFiles.has(p) })),
}));

import { getForTrack, useMetadataStore } from "./metadataStore";
import type { PlayerTrack } from "../types";

const track = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1000, modifiedAt: 5 });
const INDEX = "file:///cache/audio-meta/index.json";
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { mockFiles.clear(); useMetadataStore.getState()._resetForTests(); });

describe("metadataStore", () => {
  it("upsert persists to the index and hydrate restores it", async () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5 });
    await flush();
    expect(JSON.parse(mockFiles.get(INDEX) as string)).toHaveLength(1);
    useMetadataStore.getState()._resetForTests();
    expect(useMetadataStore.getState().entries["a"]).toBeUndefined();
    await useMetadataStore.getState().hydrate();
    expect(useMetadataStore.getState().entries["a"]?.title).toBe("Song");
  });

  it("getForTrack enforces size+modified staleness", () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5 });
    expect(getForTrack(track("a"))?.title).toBe("Song");
    expect(getForTrack({ ...track("a"), modifiedAt: 9 })).toBeNull();
    expect(getForTrack(track("zzz"))).toBeNull();
  });

  it("setDuration merges without clobbering tags and works for unknown files", async () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5 });
    useMetadataStore.getState().setDuration("a", 123);
    expect(useMetadataStore.getState().entries["a"]).toMatchObject({ title: "Song", durationSec: 123 });
    useMetadataStore.getState().setDuration("ghost", 5); // no entry -> ignored
    expect(useMetadataStore.getState().entries["ghost"]).toBeUndefined();
  });

  it("setDuration does not overwrite an existing zero duration (a real, previously-captured value)", () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5, durationSec: 0 });
    useMetadataStore.getState().setDuration("a", 999);
    expect(useMetadataStore.getState().entries["a"]?.durationSec).toBe(0);
  });

  it("setDuration fills a genuinely missing duration once", () => {
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5 });
    expect(useMetadataStore.getState().entries["a"]?.durationSec).toBeUndefined();
    useMetadataStore.getState().setDuration("a", 42);
    expect(useMetadataStore.getState().entries["a"]?.durationSec).toBe(42);
  });

  it("ensureEntry creates or refreshes a bare entry keyed to the track version", () => {
    useMetadataStore.getState().ensureEntry(track("a"));
    expect(getForTrack(track("a"))).toMatchObject({ fileId: "a" });
    useMetadataStore.getState().upsert({ fileId: "a", title: "Song", sizeBytes: 1000, modifiedAt: 5 });
    useMetadataStore.getState().ensureEntry(track("a")); // same version: no clobber
    expect(getForTrack(track("a"))?.title).toBe("Song");
  });
});
