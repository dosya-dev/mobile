import { listFiles } from "@/files/api";
import { fileKind } from "@/files/format";
import { filesFromPages } from "@/files/file-list-view";
import type { FileFilter, FileItem, FileListPage, FileSort } from "@/files/types";
import type { PlayerTrack } from "./types";

export const QUEUE_CAP = 500;

export function trackTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function buildTracks(files: FileItem[], sourceName: string): PlayerTrack[] {
  return files
    .filter((f) => fileKind(f.mime_type, f.extension) === "audio" && f.lock_mode === "none")
    .map((f) => ({
      fileId: f.id,
      title: trackTitle(f.name),
      artist: sourceName,
      extension: f.extension,
      sizeBytes: f.size_bytes,
      modifiedAt: f.updated_at,
    }));
}

export interface FetchQueueParams {
  workspaceId: string;
  folderId: string | null;
  filter: FileFilter;
  sort: FileSort;
  loadedPages: FileListPage[];
  sourceName: string;
}

/**
 * The listing is paginated and the queue wants the whole folder: fetch the
 * remaining pages (same filter/sort, so order matches what the user sees),
 * stopping early once the cap is reached - a 10k-file folder must not trigger
 * 100 fetches for a queue that keeps 500.
 */
export async function fetchAllAudioTracks(p: FetchQueueParams): Promise<{ tracks: PlayerTrack[]; truncated: boolean }> {
  const pages = [...p.loadedPages];
  const last = pages[pages.length - 1];
  let page = last ? last.pagination.page + 1 : 1;
  let totalPages = last ? last.pagination.total_pages : 1;
  let audioCount = buildTracks(filesFromPages(pages), p.sourceName).length;
  while (page <= totalPages && audioCount < QUEUE_CAP) {
    const next = await listFiles({ workspaceId: p.workspaceId, folderId: p.folderId, filter: p.filter, sort: p.sort, page });
    pages.push(next);
    totalPages = next.pagination.total_pages;
    page += 1;
    audioCount = buildTracks(filesFromPages(pages), p.sourceName).length;
  }
  const all = buildTracks(filesFromPages(pages), p.sourceName);
  return { tracks: all.slice(0, QUEUE_CAP), truncated: all.length > QUEUE_CAP || page <= totalPages };
}
