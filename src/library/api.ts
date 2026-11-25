import { apiRequest } from "@/api";
import type { FileFilter, FileItem } from "@/files/types";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import type { T } from "@/i18n/translator";

export type LibrarySort = "taken_desc" | "taken_asc" | "uploaded_desc";
export const LIBRARY_PAGE_SIZE = 60;

export type LibraryKind = "photos" | "videos" | "documents";

/** The filter chips that open the library; every other filter is the folder listing. */
export function kindForFilter(filter: FileFilter): LibraryKind | null {
  if (filter === "images") return "photos";
  if (filter === "videos") return "videos";
  if (filter === "documents") return "documents";
  return null;
}

/**
 * The catalog keys of each kind's text. The table holds keys, never text: the
 * words are produced at render, in the language chosen at that moment.
 */
export const KIND_KEYS = {
  photos: {
    title: "files.heading.photos", emptyTitle: "files.empty.noPhotosYet", emptyDescription: "files.label.photosYouUploadOrSyncToAnyFolderWill",
    date: "files.label.dateTaken",
    count: "files.label.countPluralOnePhotoOtherPhotos", allLoaded: "files.description.thatSAllCountPluralOnePhotoOtherPhotos",
    showing: "files.label.showingLoadedOfTotalPhotos", loadError: "files.error.couldnTLoadPhotos",
  },
  videos: {
    title: "files.heading.videos", emptyTitle: "files.empty.noVideosYet", emptyDescription: "files.label.videosYouUploadOrSyncToAnyFolderWill",
    date: "files.label.dateCreated",
    count: "files.label.countPluralOneVideoOtherVideos", allLoaded: "files.description.thatSAllCountPluralOneVideoOtherVideos",
    showing: "files.label.showingLoadedOfTotalVideos", loadError: "files.error.couldnTLoadVideos",
  },
  documents: {
    title: "files.heading.documents", emptyTitle: "files.empty.noDocumentsYet", emptyDescription: "files.label.documentsYouUploadOrSyncToAnyFolderWill",
    date: "files.label.dateCreated",
    count: "files.label.countPluralOneDocumentOtherDocuments", allLoaded: "files.description.thatSAllCountPluralOneDocumentOtherDocuments",
    showing: "files.label.showingLoadedOfTotalDocuments", loadError: "files.error.couldnTLoadDocuments",
  },
} as const satisfies Record<LibraryKind, Record<string, MessageKey>>;

// Same kinds as web's KIND_COPY (apps/web/src/lib/library-request.ts). `title`,
// `emptyTitle` and `emptyDescription` are getters over the module `t`, so they
// read in the language chosen at the time they are read; a screen that reads
// them re-renders on a language change through useT().
// TODO(catalog): noun, nounPlural, searchPlaceholder and primaryDateLabel have no
// catalog entry and no caller on mobile; they stay English.
export const KIND_COPY: Record<LibraryKind, {
  readonly title: string; noun: string; nounPlural: string; searchPlaceholder: string; readonly emptyTitle: string; readonly emptyDescription: string; primaryDateLabel: string;
}> = {
  photos: { get title() { return t(KIND_KEYS.photos.title); }, noun: "photo", nounPlural: "photos", searchPlaceholder: "Search photos...", get emptyTitle() { return t(KIND_KEYS.photos.emptyTitle); }, get emptyDescription() { return t(KIND_KEYS.photos.emptyDescription); }, primaryDateLabel: "Date taken" },
  videos: { get title() { return t(KIND_KEYS.videos.title); }, noun: "video", nounPlural: "videos", searchPlaceholder: "Search videos...", get emptyTitle() { return t(KIND_KEYS.videos.emptyTitle); }, get emptyDescription() { return t(KIND_KEYS.videos.emptyDescription); }, primaryDateLabel: "Date created" },
  documents: { get title() { return t(KIND_KEYS.documents.title); }, noun: "document", nounPlural: "documents", searchPlaceholder: "Search documents...", get emptyTitle() { return t(KIND_KEYS.documents.emptyTitle); }, get emptyDescription() { return t(KIND_KEYS.documents.emptyDescription); }, primaryDateLabel: "Date created" },
};

/** Web's library sorts (sortOptionsFor): the same values for every kind; only the name of the main date differs. */
export function librarySortOptions(kind: LibraryKind, tr: T = t): { value: LibrarySort; label: string }[] {
  const d = tr(KIND_KEYS[kind].date);
  return [
    { value: "taken_desc", label: tr("files.label.dNewest", { d }) },
    { value: "taken_asc", label: tr("files.label.dOldest", { d }) },
    { value: "uploaded_desc", label: tr("files.label.dateUploadedNewest") },
  ];
}

/** "23 photos", "1 video": one ICU plural per kind, in the language chosen now. */
export function plural(kind: LibraryKind, n: number, tr: T = t): string {
  return tr(KIND_KEYS[kind].count, { count: n });
}

/** A listing row plus what GET /api/library adds. Assignable to FileItem, so the viewer and the actions sheet accept it. */
export interface LibraryItem extends FileItem {
  folder_id: string | null;
  /** Effective date, unix seconds: photos EXIF → source date → upload; videos and documents source date → upload. */
  taken_at: number;
  region?: string | null;
  uploader_name?: string | null;
}

export interface LibraryPage {
  kind?: LibraryKind;
  months: { key: string; label: string; files: LibraryItem[] }[];
  next_cursor: string | null;
  /** First page only. */
  counts?: Record<string, number>;
  /** First page only. */
  total?: number;
  can_lock?: boolean;
  can_hide?: boolean;
}

export async function listLibrary(p: { workspaceId: string; kind: LibraryKind; cursor?: string | null; sort?: LibrarySort; q?: string }): Promise<LibraryPage> {
  const qs = new URLSearchParams();
  qs.set("workspace_id", p.workspaceId);
  qs.set("kind", p.kind);
  qs.set("limit", String(LIBRARY_PAGE_SIZE));
  qs.set("sort", p.sort ?? "taken_desc");
  // Minutes EAST of UTC (getTimezoneOffset is west, hence the sign flip), so
  // the server buckets months in the device's local time. Without it a photo
  // taken at 01:00 on the 1st in Istanbul listed under the previous month.
  qs.set("tz_offset", String(-new Date().getTimezoneOffset()));
  if (p.q) qs.set("q", p.q);
  if (p.cursor) qs.set("cursor", p.cursor);
  return apiRequest<{ ok: true } & LibraryPage>(`/api/library?${qs.toString()}`);
}
