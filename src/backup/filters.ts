import { t } from "@/lib/i18n";

export type BackupMediaType = "photo" | "video";

export interface BackupFilters {
  /** Never empty - an empty list would silently disable backup entirely. */
  mediaTypes: BackupMediaType[];
  /** "all" scans the whole library: the pre-filters behavior, and the iOS default. */
  albumMode: "all" | "include";
  /** Meaningful only when albumMode is "include". */
  albumIds: string[];
  /** Unix seconds. Null means the whole history. */
  dateFloor: number | null;
  /** Null means no cap. */
  maxBytes: number | null;
}

/**
 * The "everything" shape. An upgrading install receives exactly this, which is
 * what keeps its behavior identical to the pre-filters engine until the user
 * changes something.
 */
export const DEFAULT_BACKUP_FILTERS: BackupFilters = {
  mediaTypes: ["photo", "video"],
  albumMode: "all",
  albumIds: [],
  dateFloor: null,
  maxBytes: null,
};

/**
 * One-line answer to "what is this backup actually covering?", for the
 * permanent row on the Backup tab. Deliberately states the media types even
 * when both are on: the row is the standing answer to that question, and
 * "Photos and videos" reads as a promise where silence reads as an unknown.
 */
export function coverageSummary(f: BackupFilters): string {
  const both = f.mediaTypes.includes("photo") && f.mediaTypes.includes("video");
  const videos = !both && f.mediaTypes.includes("video");
  if (f.albumMode === "all") {
    return t(
      both
        ? "common.label.photosAndVideosFromEveryFolder"
        : videos
          ? "common.label.videosFromEveryFolder"
          : "common.label.photosFromEveryFolder",
    );
  }
  if (f.albumIds.length === 0) {
    return t(
      both
        ? "common.label.photosAndVideosNoFoldersSelected"
        : videos
          ? "common.label.videosNoFoldersSelected"
          : "common.label.photosNoFoldersSelected",
    );
  }
  return t(
    both
      ? "common.label.photosAndVideosFromAlbumIdsCountPluralOneFolderOtherFolders"
      : videos
        ? "common.label.videosFromAlbumIdsCountPluralOneFolderOtherFolders"
        : "common.label.photosFromAlbumIdsCountPluralOneFolderOtherFolders",
    { albumIdsCount: f.albumIds.length },
  );
}

/**
 * Whether a single asset is eligible.
 *
 * Album membership is deliberately NOT evaluated here - it is a scan-shape
 * concern handled by the scanner's album loop, never a per-asset test. The
 * media-change listener relies on that: with an album filter active it cannot
 * tell which album an inserted asset belongs to, so it abandons the targeted
 * path rather than guessing.
 *
 * `size` is absent until resolveAsset materializes the file, so an unsized
 * asset passes the cap here and is re-checked after resolution.
 */
export function assetPasses(
  a: { mediaType: BackupMediaType; createdAt: number; size?: number },
  f: BackupFilters,
): boolean {
  if (!f.mediaTypes.includes(a.mediaType)) return false;
  if (f.dateFloor != null && a.createdAt < f.dateFloor) return false;
  if (f.maxBytes != null && a.size != null && a.size > f.maxBytes) return false;
  return true;
}
