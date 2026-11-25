import type { FileItem, FolderItem, SearchResults } from "./types";

/** Mirrors web's search tabs, minus the two mobile doesn't fetch (shared, file requests). */
export type SearchTab = "all" | "files" | "folders";

/**
 * A subset of FileSort: /api/search takes no sort argument, so this is applied client-side
 * over the page it returned. Size is left out - folders have no size to compare.
 */
export type SearchSort = "name_asc" | "name_desc" | "newest" | "oldest";

export type SearchRow = { type: "folder"; item: FolderItem } | { type: "file"; item: FileItem };

type Sortable = { name: string; created_at: number };

function compare(sort: SearchSort) {
  return (a: Sortable, b: Sortable): number => {
    switch (sort) {
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "newest":
        return b.created_at - a.created_at;
      case "oldest":
        return a.created_at - b.created_at;
    }
  };
}

/**
 * Folders stay ahead of files rather than interleaving, which keeps the grouping web gets
 * from rendering them as separate sections; the sort applies within each group.
 */
export function searchRows(results: SearchResults | undefined, tab: SearchTab, sort: SearchSort): SearchRow[] {
  if (!results) return [];
  const folders = tab === "files" ? [] : [...results.folders].sort(compare(sort));
  const files = tab === "folders" ? [] : [...results.files].sort(compare(sort));
  return [
    ...folders.map((item) => ({ type: "folder" as const, item })),
    ...files.map((item) => ({ type: "file" as const, item })),
  ];
}
