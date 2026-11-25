import { searchRows } from "./search-view";
import type { SearchResults } from "./types";

const folder = (name: string, created_at: number) =>
  ({ id: name, name, created_at, lock_mode: "none", file_count: 0, is_synced: 0 }) as SearchResults["folders"][number];

const file = (name: string, created_at: number) =>
  ({
    id: name, name, created_at, updated_at: created_at, size_bytes: 1, mime_type: "text/plain",
    extension: "txt", lock_mode: "none", share_count: 0, comment_count: 0, current_version: 1,
  }) as unknown as SearchResults["files"][number];

const results: SearchResults = {
  folders: [folder("beta", 200), folder("alpha", 100)],
  files: [file("zeta", 400), file("gamma", 300)],
};

const names = (rows: ReturnType<typeof searchRows>) => rows.map((r) => r.item.name);

describe("searchRows", () => {
  it("returns nothing before results arrive", () => {
    expect(searchRows(undefined, "all", "name_asc")).toEqual([]);
  });

  it("keeps folders ahead of files rather than interleaving by name", () => {
    // 'alpha'/'beta' are folders and sort before the files even though 'gamma' < 'zeta'
    // would otherwise mix them together.
    expect(names(searchRows(results, "all", "name_asc"))).toEqual(["alpha", "beta", "gamma", "zeta"]);
  });

  it("filters to one kind", () => {
    expect(names(searchRows(results, "folders", "name_asc"))).toEqual(["alpha", "beta"]);
    expect(names(searchRows(results, "files", "name_asc"))).toEqual(["gamma", "zeta"]);
  });

  it("sorts within each group", () => {
    expect(names(searchRows(results, "all", "name_desc"))).toEqual(["beta", "alpha", "zeta", "gamma"]);
    expect(names(searchRows(results, "all", "newest"))).toEqual(["beta", "alpha", "zeta", "gamma"]);
    expect(names(searchRows(results, "all", "oldest"))).toEqual(["alpha", "beta", "gamma", "zeta"]);
  });

  it("does not mutate the query cache's arrays", () => {
    // The results object comes straight from react-query; sorting in place would reorder
    // the cached value and make the list jump on the next render.
    const before = results.folders.map((f) => f.name);
    searchRows(results, "all", "name_desc");
    expect(results.folders.map((f) => f.name)).toEqual(before);
  });
});
