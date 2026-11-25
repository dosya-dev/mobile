import { assetPasses, coverageSummary, DEFAULT_BACKUP_FILTERS, type BackupFilters } from "./filters";

const f = (o: Partial<BackupFilters> = {}): BackupFilters => ({ ...DEFAULT_BACKUP_FILTERS, ...o });

describe("assetPasses", () => {
  it("passes everything under the defaults", () => {
    expect(assetPasses({ mediaType: "photo", createdAt: 0 }, f())).toBe(true);
    expect(assetPasses({ mediaType: "video", createdAt: 0 }, f())).toBe(true);
  });

  it("rejects a media type that is not selected", () => {
    expect(assetPasses({ mediaType: "video", createdAt: 0 }, f({ mediaTypes: ["photo"] }))).toBe(false);
    expect(assetPasses({ mediaType: "photo", createdAt: 0 }, f({ mediaTypes: ["photo"] }))).toBe(true);
  });

  it("rejects assets created before the date floor", () => {
    const filters = f({ dateFloor: 1_000 });
    expect(assetPasses({ mediaType: "photo", createdAt: 999 }, filters)).toBe(false);
    expect(assetPasses({ mediaType: "photo", createdAt: 1_000 }, filters)).toBe(true);
  });

  it("rejects assets over the size cap but lets unsized assets through", () => {
    const filters = f({ maxBytes: 100 });
    expect(assetPasses({ mediaType: "photo", createdAt: 0, size: 101 }, filters)).toBe(false);
    expect(assetPasses({ mediaType: "photo", createdAt: 0, size: 100 }, filters)).toBe(true);
    // Size is unknown until resolveAsset - the caller re-checks after resolution.
    expect(assetPasses({ mediaType: "photo", createdAt: 0 }, filters)).toBe(true);
  });

  it("defaults to backing everything up, so an upgrade changes nothing", () => {
    expect(DEFAULT_BACKUP_FILTERS).toEqual({
      mediaTypes: ["photo", "video"],
      albumMode: "all",
      albumIds: [],
      dateFloor: null,
      maxBytes: null,
    });
  });
});

describe("coverageSummary", () => {
  it("states both media types and the whole library by default", () => {
    expect(coverageSummary(DEFAULT_BACKUP_FILTERS)).toBe("Photos and videos from every folder");
  });
  it("counts selected folders, singular and plural", () => {
    expect(coverageSummary({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a"] }))
      .toBe("Photos and videos from 1 folder");
    expect(coverageSummary({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a", "b"] }))
      .toBe("Photos and videos from 2 folders");
  });
  it("says plainly when the selection covers nothing", () => {
    expect(coverageSummary({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] }))
      .toBe("Photos and videos - no folders selected");
  });
  it("narrows the media wording when only one type is on", () => {
    expect(coverageSummary({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] })).toBe("Photos from every folder");
    expect(coverageSummary({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["video"] })).toBe("Videos from every folder");
  });
});
