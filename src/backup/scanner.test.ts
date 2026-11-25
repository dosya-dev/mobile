const mockDefaultGetAssets = async ({ after }: any) =>
  after
    ? { assets: [], endCursor: "end", hasNextPage: false, totalCount: 1 }
    : { assets: [{ id: "a1", filename: "IMG.jpg", uri: "ph://a1", mediaType: "photo", creationTime: 5000, modificationTime: 6000 }], endCursor: "c1", hasNextPage: true, totalCount: 1 };

jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getAssetsAsync: jest.fn(mockDefaultGetAssets),
  getAssetInfoAsync: jest.fn(async (id: string) => ({ localUri: id === "icloud" ? null : "file://" + id })),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, accessPrivileges: "limited" })),
  getAlbumsAsync: jest.fn(async () => []),
  MediaType: { photo: "photo", video: "video" },
  SortBy: { creationTime: "creationTime" },
}));
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: jest.fn(async () => ({ exists: true, size: 200 })) }));

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { scanAssets, resolveAsset, isPhotoAccessLimited, listBackupAlbums, countLibraryAssets, ZERO_SIZE_RESTAT_MS } from "./scanner";
import { DEFAULT_BACKUP_FILTERS } from "./filters";
import * as MediaLibrary from "expo-media-library";

const mockGetInfo = FileSystem.getInfoAsync as jest.Mock;

const mockGetAssets = MediaLibrary.getAssetsAsync as jest.Mock;
const mockGetAlbums = MediaLibrary.getAlbumsAsync as jest.Mock;
const mockGetPerms = MediaLibrary.getPermissionsAsync as jest.Mock;

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  id, filename: `${id}.jpg`, mediaType: "photo", creationTime: 5000, ...over,
});
const page = (assets: unknown[]) => ({ assets, endCursor: "c", hasNextPage: false, totalCount: assets.length });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetInfo.mockReset();
  mockGetInfo.mockResolvedValue({ exists: true, size: 200 });
  mockGetAssets.mockImplementation(mockDefaultGetAssets);
  mockGetAlbums.mockResolvedValue([]);
  mockGetPerms.mockResolvedValue({ granted: true, accessPrivileges: "limited" });
});

describe("scanAssets", () => {
  it("pages LIGHT assets (id + metadata only - no file access / download)", async () => {
    const seen: any[] = [];
    const ok = await scanAssets(async (batch) => { seen.push(...batch); });
    expect(ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: "a1", filename: "IMG.jpg", createdAt: 5, modifiedAt: 6, mediaType: "photo" });
    expect(seen[0].uri).toBeUndefined();
    expect(seen[0].size).toBeUndefined();
  });

  it("asks the library only for the selected media types", async () => {
    mockGetAssets.mockResolvedValue(page([]));
    await scanAssets(async () => {}, { filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] } });
    expect(mockGetAssets).toHaveBeenCalledWith(expect.objectContaining({ mediaType: ["photo"] }));
  });

  it("uses the later of the watermark and the user's date floor", async () => {
    mockGetAssets.mockResolvedValue(page([]));
    await scanAssets(async () => {}, {
      createdAfter: 1_000,
      filters: { ...DEFAULT_BACKUP_FILTERS, dateFloor: 5_000 },
    });
    // Milliseconds at the native boundary.
    expect(mockGetAssets).toHaveBeenCalledWith(expect.objectContaining({ createdAfter: 5_000_000 }));
  });

  it("keeps the watermark when it is later than the date floor", async () => {
    mockGetAssets.mockResolvedValue(page([]));
    await scanAssets(async () => {}, {
      createdAfter: 9_000,
      filters: { ...DEFAULT_BACKUP_FILTERS, dateFloor: 5_000 },
    });
    expect(mockGetAssets).toHaveBeenCalledWith(expect.objectContaining({ createdAfter: 9_000_000 }));
  });

  it("scans each selected album and dedupes assets that appear in two", async () => {
    mockGetAssets
      .mockResolvedValueOnce(page([asset("a"), asset("b")]))
      .mockResolvedValueOnce(page([asset("b"), asset("c")]));
    const seen: string[] = [];
    await scanAssets(async (batch) => { seen.push(...batch.map((a) => a.id)); }, {
      filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["A1", "A2"] },
    });
    expect(mockGetAssets).toHaveBeenCalledTimes(2);
    expect(mockGetAssets).toHaveBeenNthCalledWith(1, expect.objectContaining({ album: "A1" }));
    expect(mockGetAssets).toHaveBeenNthCalledWith(2, expect.objectContaining({ album: "A2" }));
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("scans nothing when the user has deselected every album", async () => {
    const onBatch = jest.fn();
    const ok = await scanAssets(onBatch, {
      filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] },
    });
    // Not an error - the user chose this.
    expect(ok).toBe(true);
    expect(onBatch).not.toHaveBeenCalled();
    expect(mockGetAssets).not.toHaveBeenCalled();
  });

  it("passes no album at all when the mode is 'all'", async () => {
    mockGetAssets.mockResolvedValue(page([]));
    await scanAssets(async () => {}, { filters: { ...DEFAULT_BACKUP_FILTERS } });
    expect(mockGetAssets).toHaveBeenCalledWith(expect.not.objectContaining({ album: expect.anything() }));
  });

  it("drops assets the predicate rejects even if the native query returned them", async () => {
    mockGetAssets.mockResolvedValue(page([
      asset("old", { creationTime: 1_000 }),
      asset("new", { creationTime: 9_000_000 }),
    ]));
    const seen: string[] = [];
    await scanAssets(async (batch) => { seen.push(...batch.map((a) => a.id)); }, {
      filters: { ...DEFAULT_BACKUP_FILTERS, dateFloor: 5_000 },
    });
    expect(seen).toEqual(["new"]);
  });

  it("returns false without permission", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    expect(await scanAssets(async () => {})).toBe(false);
  });
});

describe("listBackupAlbums", () => {
  it("lists albums with their counts, biggest first, skipping empties", async () => {
    mockGetAlbums.mockResolvedValue([
      { id: "A2", title: "Screenshots", assetCount: 5400 },
      { id: "A3", title: "Empty", assetCount: 0 },
      { id: "A1", title: "Camera", assetCount: 6100 },
    ]);
    await expect(listBackupAlbums()).resolves.toEqual([
      { id: "A1", title: "Camera", count: 6100 },
      { id: "A2", title: "Screenshots", count: 5400 },
    ]);
  });

  it("returns an empty list rather than throwing when the library is unavailable", async () => {
    mockGetAlbums.mockRejectedValue(new Error("no permission"));
    await expect(listBackupAlbums()).resolves.toEqual([]);
  });
});

describe("countLibraryAssets", () => {
  it("counts the whole library under the default filters", async () => {
    mockGetAssets.mockResolvedValue(page(new Array(12).fill(null)));
    await expect(countLibraryAssets()).resolves.toBe(12);
  });

  it("counts only the selected albums when the user narrowed the scope", async () => {
    mockGetAssets
      .mockResolvedValueOnce({ assets: [], endCursor: "c", hasNextPage: false, totalCount: 6100 })
      .mockResolvedValueOnce({ assets: [], endCursor: "c", hasNextPage: false, totalCount: 840 });
    await expect(
      countLibraryAssets({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["A1", "A2"] }),
    ).resolves.toBe(6940);
  });

  it("counts zero when every album is deselected", async () => {
    await expect(
      countLibraryAssets({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] }),
    ).resolves.toBe(0);
    expect(mockGetAssets).not.toHaveBeenCalled();
  });

  it("is null without permission", async () => {
    mockGetPerms.mockResolvedValue({ granted: false });
    await expect(countLibraryAssets()).resolves.toBeNull();
  });
});

describe("resolveAsset - zero-size guard", () => {
  const light = { id: "z1", filename: "Z.jpg", createdAt: 5, modifiedAt: 6, mediaType: "photo" as const };
  const setOS = (os: string) => { (Platform as unknown as { OS: string }).OS = os; };
  const originalOS = Platform.OS;

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); setOS(originalOS); });

  it("on Android re-stats once 1500 ms later and resolves when the file has finished being written", async () => {
    setOS("android");
    mockGetInfo.mockResolvedValueOnce({ exists: true, size: 0 }).mockResolvedValueOnce({ exists: true, size: 512 });
    const p = resolveAsset(light);
    await jest.advanceTimersByTimeAsync(1499);
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ asset: { ...light, uri: "file://z1", size: 512 } });
    expect(mockGetInfo).toHaveBeenCalledTimes(2);
  });

  it("on Android reports `empty` when the re-stat still reports an empty file", async () => {
    setOS("android");
    mockGetInfo.mockResolvedValue({ exists: true, size: 0 });
    const p = resolveAsset(light);
    await jest.advanceTimersByTimeAsync(ZERO_SIZE_RESTAT_MS);
    await expect(p).resolves.toEqual({ asset: null, reason: "empty" });
    expect(mockGetInfo).toHaveBeenCalledTimes(2);
  });

  it("on iOS reports `empty` without waiting", async () => {
    setOS("ios");
    mockGetInfo.mockResolvedValue({ exists: true, size: 0 });
    await expect(resolveAsset(light)).resolves.toEqual({ asset: null, reason: "empty" });
    expect(mockGetInfo).toHaveBeenCalledTimes(1);
  });

  it("treats a missing size the same as zero", async () => {
    setOS("ios");
    mockGetInfo.mockResolvedValue({ exists: true });
    await expect(resolveAsset(light)).resolves.toEqual({ asset: null, reason: "empty" });
  });

  it("distinguishes an unreadable asset (iCloud / Limited access) from an empty one", async () => {
    setOS("ios");
    await expect(resolveAsset({ ...light, id: "icloud" })).resolves.toEqual({ asset: null, reason: "unreadable" });
  });
});

describe("resolveAsset", () => {
  it("materializes a readable file:// uri + real size", async () => {
    const r = await resolveAsset({ id: "a1", filename: "IMG.jpg", createdAt: 5, modifiedAt: 6, mediaType: "photo" });
    expect(r).toEqual({ asset: { id: "a1", filename: "IMG.jpg", createdAt: 5, modifiedAt: 6, mediaType: "photo", uri: "file://a1", size: 200 } });
  });
  it("reports `unreadable` when the asset can't be resolved to a file (iCloud / ph://)", async () => {
    const r = await resolveAsset({ id: "icloud", filename: "X.jpg", createdAt: 5, modifiedAt: 6, mediaType: "photo" });
    expect(r).toEqual({ asset: null, reason: "unreadable" });
  });
});

describe("isPhotoAccessLimited", () => {
  it("is true for partial access, false for full", async () => {
    expect(await isPhotoAccessLimited()).toBe(true);
    mockGetPerms.mockResolvedValueOnce({ granted: true, accessPrivileges: "all" });
    expect(await isPhotoAccessLimited()).toBe(false);
  });
});
