import { t } from "@/lib/i18n";
import { create } from "zustand";
import type { FileItem } from "@/files/types";
import { collapseLiveTwins } from "@/files/livePhotos";
import { localDigits } from "@/lib/format-locale";

/**
 * The list the viewer is paging through.
 *
 * Swiping between files needs the neighbours of the file you tapped, and the
 * only place that knows them is the screen you tapped from. Passing a whole
 * list through route params is not an option - expo-router serialises params
 * into the URL, and a folder of 200 files would be a URL of 200 ids.
 *
 * So the list is handed over out of band: the browser calls `setViewerList`
 * immediately before it navigates, and the route reads it back. This is
 * deliberately a plain hand-off and NOT a cache. It is authoritative only when
 * it actually contains the file being viewed; see `resolveContext`.
 */
export interface ViewerContext {
  /** The files that were on screen, in the order they were shown. */
  files: FileItem[];
  /** Folder name, or the workspace name at the root - the audio hand-off needs it. */
  sourceName: string;
}

interface ViewerListState extends ViewerContext {
  setViewerList: (files: FileItem[], sourceName: string) => void;
  clearViewerList: () => void;
}

export const useViewerList = create<ViewerListState>((set) => ({
  files: [],
  sourceName: "dosya",
  setViewerList: (files, sourceName) => set({ files, sourceName }),
  clearViewerList: () => set({ files: [], sourceName: "dosya" }),
}));

export interface ResolvedContext {
  /** What the pager renders. Always contains at least the current file. */
  files: FileItem[];
  index: number;
  sourceName: string;
  /** False when there are no neighbours, so the counter and pager stay hidden. */
  paged: boolean;
}

/**
 * Reconcile the handed-over list with the file the route was actually asked
 * for, and fall back cleanly when they disagree.
 *
 * They disagree more often than they agree in the cases that matter: a push
 * notification, a deep link, a cold start onto a /file/:id URL, or simply
 * navigating back into the viewer after the store was cleared. In every one of
 * those the store is stale or empty, and paging through some other folder's
 * files would be worse than not paging at all.
 *
 * `current` is the file the route resolved, used both as the single-file
 * fallback and to fill in a list entry that is thinner than the detail row
 * (a search hit carries no lock_mode, so paging onto it from a listing would
 * otherwise lose the lock badge).
 */
export function resolveContext(
  ctx: ViewerContext,
  fileId: string,
  current: FileItem | null,
): ResolvedContext {
  // A Live Photo is one page: the twin leaves the pager when its still is in
  // the list. Opened directly (search, list view) the twin still pages as a video.
  const collapsed = collapseLiveTwins(ctx.files);
  const list = collapsed.some((f) => f.id === fileId) ? collapsed : ctx.files;
  const index = list.findIndex((f) => f.id === fileId);

  if (index === -1) {
    return {
      files: current ? [current] : [],
      index: 0,
      sourceName: ctx.sourceName,
      paged: false,
    };
  }

  // Prefer the freshly-fetched detail row for the file being viewed - it is
  // the only one in the list guaranteed to carry every column.
  //
  // Guarded on the id, not just on presence: mid-swipe the detail query is
  // still returning the PREVIOUS file (a new query key has no data until it
  // resolves), and overlaying that onto the new slot would put the old file's
  // name and lock mode on the new file for as long as the fetch takes.
  const overlay = current && current.id === fileId ? current : null;
  const files = overlay ? list.map((f, i) => (i === index ? { ...f, ...overlay } : f)) : list;

  return { files, index, sourceName: ctx.sourceName, paged: files.length > 1 };
}

/** "4 of 27", or null when there is nothing to page through. */
export function positionLabel(ctx: ResolvedContext): string | null {
  if (!ctx.paged) return null;
  return t("common.label.sentOfTotal", { sent: localDigits(ctx.index + 1), total: localDigits(ctx.files.length) });
}
