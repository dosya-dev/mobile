jest.mock("expo-media-library", () => ({
  MediaType: { photo: "photo", video: "video" },
  getAssetsAsync: jest.fn(),
  getAssetInfoAsync: jest.fn(),
}));
jest.mock("@/backup/scanner", () => ({ countLibraryAssets: jest.fn() }));

import * as MediaLibrary from "expo-media-library";
import { countLibraryAssets } from "@/backup/scanner";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";
import { estimateLibrary, formatEstimate, SAMPLE_SIZE } from "./librarySize";

const photosOnly = { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo" as const] };
const videosOnly = { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["video" as const] };

beforeEach(() => jest.clearAllMocks());

describe("estimateLibrary", () => {
  it("returns null without permission", async () => {
    (countLibraryAssets as jest.Mock).mockResolvedValue(null);
    expect(await estimateLibrary(DEFAULT_BACKUP_FILTERS)).toBeNull();
  });

  it("reports zero counts and no estimate for an empty library", async () => {
    (countLibraryAssets as jest.Mock).mockResolvedValue(0);
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ assets: [], totalCount: 0 });
    expect(await estimateLibrary(DEFAULT_BACKUP_FILTERS)).toEqual({
      photos: 0, videos: 0, estimatedBytes: null,
    });
  });

  it("extrapolates the mean sample size across the whole library", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 100 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({
      assets: [{ id: "a" }, { id: "b" }], totalCount: 100,
    });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ fileSize: 1000 });
    const r = await estimateLibrary(photosOnly);
    expect(r).toEqual({ photos: 100, videos: 0, estimatedBytes: 100_000 });
  });

  it("estimates photos and videos separately, since their sizes differ by an order of magnitude", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 10 : 2,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockImplementation(async (o: { mediaType: string[] }) =>
      o.mediaType[0] === "photo"
        ? { assets: [{ id: "p" }], totalCount: 10 }
        : { assets: [{ id: "v" }], totalCount: 2 },
    );
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation(async (id: string) =>
      id === "p" ? { fileSize: 100 } : { fileSize: 10_000 },
    );
    const r = await estimateLibrary(DEFAULT_BACKUP_FILTERS);
    expect(r).toEqual({ photos: 10, videos: 2, estimatedBytes: 10 * 100 + 2 * 10_000 });
  });

  it("ignores assets whose size cannot be read rather than counting them as zero", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 10 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({
      assets: [{ id: "a" }, { id: "b" }], totalCount: 10,
    });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockImplementation(async (id: string) =>
      id === "a" ? { fileSize: 500 } : {},
    );
    const r = await estimateLibrary(photosOnly);
    expect(r?.estimatedBytes).toBe(5000); // mean of the ONE readable asset
  });

  it("returns a null estimate, never a fabricated number, when no sample is readable", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 10 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ assets: [{ id: "a" }], totalCount: 10 });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockRejectedValue(new Error("nope"));
    expect((await estimateLibrary(photosOnly))?.estimatedBytes).toBeNull();
  });

  it("never downloads iCloud originals to measure them", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "video" ? 3 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ assets: [{ id: "v" }], totalCount: 3 });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ fileSize: 1 });
    await estimateLibrary(videosOnly);
    expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalledWith("v", { shouldDownloadFromNetwork: false });
  });

  it("caps the sample so a huge library does not stall the step", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 500_000 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ assets: [], totalCount: 500_000 });
    await estimateLibrary(photosOnly);
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ first: SAMPLE_SIZE }),
    );
  });

  it("samples only the selected albums when albumMode is include, not the whole library", async () => {
    const filters = {
      ...DEFAULT_BACKUP_FILTERS,
      mediaTypes: ["photo" as const],
      albumMode: "include" as const,
      albumIds: ["alb-1", "alb-2"],
    };
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 20 : 0,
    );
    (MediaLibrary.getAssetsAsync as jest.Mock).mockImplementation(async (o: { album?: string }) => {
      if (o.album === "alb-1") return { assets: [{ id: "from-alb-1" }], totalCount: 10 };
      if (o.album === "alb-2") return { assets: [{ id: "from-alb-2" }], totalCount: 10 };
      // No `album` means "the whole library" - the exact leak this test guards against.
      return { assets: [{ id: "from-whole-library" }], totalCount: 999 };
    });
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ fileSize: 100 });

    await estimateLibrary(filters);

    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalledWith(
      "from-whole-library",
      expect.anything(),
    );
    const calls = (MediaLibrary.getAssetsAsync as jest.Mock).mock.calls.map(
      ([o]) => o as { album?: string },
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((o) => o.album === "alb-1" || o.album === "alb-2")).toBe(true);
  });

  it("splits the SAMPLE_SIZE budget across selected albums rather than sampling SAMPLE_SIZE per album", async () => {
    const filters = {
      ...DEFAULT_BACKUP_FILTERS,
      mediaTypes: ["photo" as const],
      albumMode: "include" as const,
      albumIds: ["alb-1", "alb-2"],
    };
    (countLibraryAssets as jest.Mock).mockResolvedValue(1000);
    (MediaLibrary.getAssetsAsync as jest.Mock).mockImplementation(
      async (o: { first: number; album?: string }) => ({
        assets: Array.from({ length: o.first }, (_, i) => ({ id: `${o.album}-${i}` })),
        totalCount: 1000,
      }),
    );
    (MediaLibrary.getAssetInfoAsync as jest.Mock).mockResolvedValue({ fileSize: 1 });

    await estimateLibrary(filters);

    const calls = (MediaLibrary.getAssetsAsync as jest.Mock).mock.calls.map(
      ([o]) => o as { first: number },
    );
    const totalRequested = calls.reduce((sum, o) => sum + o.first, 0);
    expect(totalRequested).toBe(SAMPLE_SIZE);
    expect(calls.every((o) => o.first <= SAMPLE_SIZE)).toBe(true);
  });

  it("does not fall back to the whole library when albumMode is include with nothing selected", async () => {
    const filters = {
      ...DEFAULT_BACKUP_FILTERS,
      mediaTypes: ["photo" as const],
      albumMode: "include" as const,
      albumIds: [] as string[],
    };
    // Forces a non-zero count via the mock, in isolation from
    // countLibraryAssets's own (already-correct) empty-albumIds handling, to
    // prove the sampling path carries its own guard rather than relying on
    // the count always being zero here.
    (countLibraryAssets as jest.Mock).mockResolvedValue(10);
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({
      assets: [{ id: "leak" }],
      totalCount: 999,
    });

    const r = await estimateLibrary(filters);

    expect(MediaLibrary.getAssetsAsync).not.toHaveBeenCalled();
    expect(r?.estimatedBytes).toBeNull();
  });

  it("never throws out of estimateLibrary even when a resolved response is malformed", async () => {
    (countLibraryAssets as jest.Mock).mockImplementation(async (f) =>
      f.mediaTypes[0] === "photo" ? 5 : 0,
    );
    // No `assets` field - simulates a malformed/unexpected resolved response.
    (MediaLibrary.getAssetsAsync as jest.Mock).mockResolvedValue({ totalCount: 5 } as never);

    await expect(estimateLibrary(photosOnly)).resolves.toEqual({
      photos: 5, videos: 0, estimatedBytes: null,
    });
  });
});

describe("formatEstimate", () => {
  it("hedges every derived size, because it is a sample not a measurement", () => {
    // Binary, like every other size in the app and like the plan sizes in
    // packages/shared (GB = 1_073_741_824). A decimal conversion here printed
    // 61.2 GB for the same bytes the rest of the product calls 57.0 GB.
    expect(formatEstimate(61_200_000_000)).toBe("about 57.0 GB");
    expect(formatEstimate(64_424_509_440)).toBe("about 60.0 GB"); // exactly 60 GiB
  });
  it("says nothing when there is nothing to say", () => {
    expect(formatEstimate(null)).toBe("");
  });
  it("uses MB below a gigabyte", () => {
    expect(formatEstimate(340_000_000)).toBe("about 324.2 MB");
  });

  // There is no formatBytes in this module any more - it delegates to the
  // app's shared one. Three functions of that name (here, src/lib/format,
  // src/files/format) already cost this branch one opaque test crash, and the
  // one that lived here was the odd one out on top of that: decimal, where
  // plan sizes and every other size in the app are binary.
  it("is the app's shared formatter, not a private copy", () => {
    const shared = jest.requireActual("@/lib/format") as { formatBytes: (n: number) => string };
    expect(formatEstimate(5 * 1_073_741_824)).toBe(`about ${shared.formatBytes(5 * 1_073_741_824)}`);
    expect((jest.requireActual("./librarySize") as Record<string, unknown>).formatBytes).toBeUndefined();
  });
});
