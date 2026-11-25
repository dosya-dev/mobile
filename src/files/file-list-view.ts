import type { FileItem, FileListPage, FileSort, FolderItem } from "./types";

/**
 * Collect the folders across the loaded pages.
 *
 * /api/files repeats the *whole* folder list on every page - that query has no LIMIT and
 * isn't gated on the page number - so flattening the pages yields each folder once per
 * page fetched. Dedupe by id, keeping the first copy.
 *
 * The sort param only reaches the file query server-side (folders come back ORDER BY name
 * ASC whatever you ask for), so the chosen order has to be applied here. Because the API
 * sends every folder each time, this sorts the complete set rather than a page of it.
 *
 * largest/smallest have no meaning for a folder - there's no size to compare - so they
 * fall back to name A-Z instead of leaving the order arbitrary.
 */
export function foldersFromPages(pages: FileListPage[], sort: FileSort): FolderItem[] {
  const seen = new Map<string, FolderItem>();
  for (const page of pages) {
    for (const folder of page.folders) {
      if (!seen.has(folder.id)) seen.set(folder.id, folder);
    }
  }
  const folders = [...seen.values()];
  switch (sort) {
    case "newest":
      return folders.sort((a, b) => b.created_at - a.created_at);
    case "oldest":
      return folders.sort((a, b) => a.created_at - b.created_at);
    case "name_desc":
      return folders.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return folders.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Files are already sorted and paginated by the server, so they only need flattening.
 * Dedupe defensively anyway: a file created between two page fetches shifts the offset
 * window and can surface the same row twice, which would collide on key.
 */
export function filesFromPages(pages: FileListPage[]): FileItem[] {
  const seen = new Map<string, FileItem>();
  for (const page of pages) {
    for (const file of page.files) {
      if (!seen.has(file.id)) seen.set(file.id, file);
    }
  }
  return [...seen.values()];
}
