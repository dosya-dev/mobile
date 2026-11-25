import { positionLabel, resolveContext, useViewerList, type ViewerContext } from "./viewerStore";
import type { FileItem } from "@/files/types";

function file(id: string, over: Partial<FileItem> = {}): FileItem {
  return {
    id,
    name: `${id}.jpg`,
    size_bytes: 100,
    mime_type: "image/jpeg",
    extension: ".jpg",
    created_at: 1_754_200_000,
    updated_at: 1_754_200_000,
    current_version: 1,
    lock_mode: "none",
    share_count: 0,
    comment_count: 0,
    ...over,
  };
}

const ctx = (files: FileItem[]): ViewerContext => ({ files, sourceName: "Trip" });

describe("useViewerList", () => {
  afterEach(() => useViewerList.getState().clearViewerList());

  it("hands a list over and takes it back", () => {
    useViewerList.getState().setViewerList([file("a"), file("b")], "Trip");
    expect(useViewerList.getState().files).toHaveLength(2);
    expect(useViewerList.getState().sourceName).toBe("Trip");

    useViewerList.getState().clearViewerList();
    expect(useViewerList.getState().files).toEqual([]);
  });
});

describe("resolveContext", () => {
  it("pages through the handed-over list when the file is in it", () => {
    const files = [file("a"), file("b"), file("c")];
    const r = resolveContext(ctx(files), "b", file("b"));
    expect(r.index).toBe(1);
    expect(r.files).toHaveLength(3);
    expect(r.paged).toBe(true);
    expect(r.sourceName).toBe("Trip");
  });

  // A deep link, a notification tap, or a cold start onto /file/:id all arrive
  // with an empty or unrelated store. Paging through someone else's folder
  // would be worse than not paging.
  it("falls back to a single file when the store knows nothing about it", () => {
    const r = resolveContext(ctx([file("a"), file("b")]), "zzz", file("zzz"));
    expect(r.files.map((f) => f.id)).toEqual(["zzz"]);
    expect(r.index).toBe(0);
    expect(r.paged).toBe(false);
  });

  it("survives an empty store with the file still loading", () => {
    const r = resolveContext(ctx([]), "a", null);
    expect(r.files).toEqual([]);
    expect(r.paged).toBe(false);
  });

  it("does not page a folder of one", () => {
    expect(resolveContext(ctx([file("a")]), "a", file("a")).paged).toBe(false);
  });

  // GET /api/search omits lock_mode, so a listing built from search results
  // carries "none" for every hit. The detail row is the one that knows.
  it("overlays the freshly fetched row onto its slot in the list", () => {
    const thin = file("b", { lock_mode: "none", current_version: 1 });
    const fat = file("b", { lock_mode: "view_only", current_version: 4 });
    const r = resolveContext(ctx([file("a"), thin]), "b", fat);
    expect(r.files[1].lock_mode).toBe("view_only");
    expect(r.files[1].current_version).toBe(4);
    expect(r.files[0].lock_mode).toBe("none");
  });

  // Mid-swipe the detail query still holds the PREVIOUS file - a new query key
  // has no data until it resolves. Overlaying that would show the old file's
  // name and lock mode on the new one for the length of the fetch.
  it("ignores a detail row that belongs to a different file", () => {
    const r = resolveContext(ctx([file("a"), file("b")]), "b", file("a", { lock_mode: "full_lock" }));
    expect(r.files[1].id).toBe("b");
    expect(r.files[1].lock_mode).toBe("none");
  });

  it("leaves the neighbours untouched", () => {
    const files = [file("a"), file("b")];
    const r = resolveContext(ctx(files), "a", file("a", { current_version: 9 }));
    expect(r.files[1]).toEqual(files[1]);
  });

  it("pages over a Live Photo as one stop", () => {
    const still = { id: "s", name: "IMG_1.HEIC", live_video_id: "v" } as FileItem;
    const twin = { id: "v", name: "IMG_1.MOV", live_photo_id: "s" } as FileItem;
    const other = { id: "o", name: "b.jpg" } as FileItem;
    const r = resolveContext({ files: [still, twin, other], sourceName: "Folder" }, "s", null);
    expect(r.files.map((f) => f.id)).toEqual(["s", "o"]);
    expect(positionLabel(r)).toBe("1 of 2");
  });
});

describe("positionLabel", () => {
  it("counts from one", () => {
    const r = resolveContext(ctx([file("a"), file("b"), file("c")]), "c", file("c"));
    expect(positionLabel(r)).toBe("3 of 3");
  });

  it("says nothing when there is nowhere to swipe", () => {
    expect(positionLabel(resolveContext(ctx([file("a")]), "a", file("a")))).toBeNull();
  });
});
