import { mergeLibraryPages, chunkRows } from "./grouping";
import { kindForFilter, plural, KIND_COPY } from "./api";
import type { LibraryPage, LibraryItem } from "./api";

function photo(id: string, taken_at = 0): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: "image/jpeg", extension: "jpg",
    created_at: taken_at, updated_at: taken_at, current_version: 1, lock_mode: "none",
    share_count: 0, comment_count: 0, folder_id: null, taken_at,
  };
}

describe("mergeLibraryPages", () => {
  const p1: LibraryPage = {
    months: [
      { key: "2024-07", label: "July 2024", files: [photo("a", 7), photo("b", 6)] },
      { key: "2024-06", label: "June 2024", files: [photo("c", 5)] },
    ],
    next_cursor: "cur1", counts: { "2024-07": 2, "2024-06": 3 }, total: 5, can_lock: true,
  };
  const p2: LibraryPage = { months: [{ key: "2024-06", label: "June 2024", files: [photo("d", 4), photo("e", 3)] }], next_cursor: null };

  it("is empty for no pages", () => {
    expect(mergeLibraryPages([])).toEqual({ months: [], files: [], total: 0, loaded: 0, hasMore: false, canLock: false, canHide: false });
  });

  it("continues a month across pages and keeps the first-page counts", () => {
    const lib = mergeLibraryPages([p1, p2]);
    expect(lib.months.map((m) => m.key)).toEqual(["2024-07", "2024-06"]);
    expect(lib.months[1].files.map((f) => f.id)).toEqual(["c", "d", "e"]);
    expect(lib.months[1].count).toBe(3);
    expect(lib.files.map((f) => f.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(lib.total).toBe(5);
    expect(lib.hasMore).toBe(false);
    expect(lib.canLock).toBe(true);
    expect(mergeLibraryPages([p1]).hasMore).toBe(true);
  });

  it("deduplicates files that appear in multiple pages", () => {
    const p1dup: LibraryPage = {
      months: [{ key: "2024-06", label: "June 2024", files: [photo("c", 5), photo("d", 4)] }],
      next_cursor: "cur1", counts: { "2024-06": 2 }, total: 2, can_lock: false,
    };
    const p2dup: LibraryPage = {
      months: [{ key: "2024-06", label: "June 2024", files: [photo("c", 5), photo("e", 3)] }],
      next_cursor: null,
    };
    const lib = mergeLibraryPages([p1dup, p2dup]);
    expect(lib.files.map((f) => f.id)).toEqual(["c", "d", "e"]);
    expect(lib.loaded).toBe(3);
  });

  it("preserves server-reported count for a month even when only partially loaded", () => {
    const partial = mergeLibraryPages([p1]);
    expect(partial.hasMore).toBe(true);
    expect(partial.months[1].count).toBe(3);
    expect(partial.months[1].files).toHaveLength(1);
  });
});

describe("chunkRows", () => {
  it("splits into rows of n, last row short", () => {
    const rows = chunkRows([photo("a"), photo("b"), photo("c"), photo("d")], 3);
    expect(rows.map((r) => r.map((f) => f.id))).toEqual([["a", "b", "c"], ["d"]]);
  });
  it("returns no rows for no files", () => {
    expect(chunkRows([], 3)).toEqual([]);
  });
});

describe("kindForFilter", () => {
  it("maps images to photos", () => {
    expect(kindForFilter("images")).toBe("photos");
  });
  it("maps videos to videos", () => {
    expect(kindForFilter("videos")).toBe("videos");
  });
  it("maps documents to documents", () => {
    expect(kindForFilter("documents")).toBe("documents");
  });
  it("returns null for every other filter", () => {
    expect(kindForFilter("all")).toBeNull();
    expect(kindForFilter("shared")).toBeNull();
    expect(kindForFilter("hidden")).toBeNull();
  });
});

describe("plural", () => {
  it("uses the singular noun for 1", () => {
    expect(plural("documents", 1)).toBe("1 document");
  });
  it("uses the plural noun otherwise", () => {
    expect(plural("videos", 23)).toBe("23 videos");
  });
});

describe("KIND_COPY", () => {
  it("titles videos", () => {
    expect(KIND_COPY.videos.title).toBe("Videos");
  });
});
