import { foldersFromPages, filesFromPages } from "./file-list-view";
import type { FileListPage, FolderItem, FileItem } from "./types";

const folder = (id: string, name: string, created_at: number) =>
  ({ id, name, created_at, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none" }) as FolderItem;

const file = (id: string, name: string) =>
  ({ id, name, created_at: 1, updated_at: 1, size_bytes: 1, mime_type: "text/plain", extension: "txt",
     lock_mode: "none", share_count: 0, comment_count: 0, current_version: 1 }) as unknown as FileItem;

const page = (folders: FolderItem[], files: FileItem[]): FileListPage =>
  ({ folders, files, breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });

const FOLDERS = [folder("f1", "beta", 200), folder("f2", "alpha", 100)];
const names = (fs: FolderItem[]) => fs.map((f) => f.name);

describe("foldersFromPages", () => {
  it("returns each folder once even though every page repeats the whole folder list", () => {
    // /api/files has no LIMIT on its folder query, so page 2 carries the same folders as
    // page 1; flattening naively showed every folder twice once a folder paginated.
    const pages = [page(FOLDERS, []), page(FOLDERS, [])];
    expect(foldersFromPages(pages, "name_asc")).toHaveLength(2);
    expect(names(foldersFromPages(pages, "name_asc"))).toEqual(["alpha", "beta"]);
  });

  it("applies the chosen sort, which the server never does for folders", () => {
    const pages = [page(FOLDERS, [])];
    expect(names(foldersFromPages(pages, "name_asc"))).toEqual(["alpha", "beta"]);
    expect(names(foldersFromPages(pages, "name_desc"))).toEqual(["beta", "alpha"]);
    expect(names(foldersFromPages(pages, "newest"))).toEqual(["beta", "alpha"]);
    expect(names(foldersFromPages(pages, "oldest"))).toEqual(["alpha", "beta"]);
  });

  it("falls back to name A-Z for size sorts, which a folder has no value for", () => {
    const pages = [page(FOLDERS, [])];
    expect(names(foldersFromPages(pages, "largest"))).toEqual(["alpha", "beta"]);
    expect(names(foldersFromPages(pages, "smallest"))).toEqual(["alpha", "beta"]);
  });

  it("handles no pages loaded yet", () => {
    expect(foldersFromPages([], "newest")).toEqual([]);
  });
});

describe("filesFromPages", () => {
  it("keeps the server's order and dedupes rows that straddle a page boundary", () => {
    const pages = [page([], [file("a", "one"), file("b", "two")]), page([], [file("b", "two"), file("c", "three")])];
    expect(filesFromPages(pages).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});
