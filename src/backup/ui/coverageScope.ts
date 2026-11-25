import type { BackupFilters } from "@/backup/filters";
import { byteCount, formatDateWith } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

/** A calendar day, no time: "17 Sep 2025" in the current language. */
export function formatDay(unixSeconds: number): string {
  return formatDateWith(unixSeconds, { day: "numeric", month: "short", year: "numeric" });
}

/** True when the filters narrow the library by media type, folders or start date. */
function isNarrowed(filters: BackupFilters): boolean {
  const photos = filters.mediaTypes.includes("photo");
  const videos = filters.mediaTypes.includes("video");
  return photos !== videos || filters.albumMode === "include" || filters.dateFloor != null;
}

/**
 * The arguments of the narrowing phrase ("photos only, 3 folders, since
 * 17 Sep 2025"), which is one ICU message (select on the media type, on
 * whether folders and a date apply) so each language orders and joins the parts
 * its own way. Only render it when isNarrowed(filters) is true.
 */
function narrowingArgs(filters: BackupFilters): Record<string, string | number> {
  const photos = filters.mediaTypes.includes("photo");
  const videos = filters.mediaTypes.includes("video");
  return {
    media: photos !== videos ? (photos ? "photos" : "videos") : "other",
    hasFolders: String(filters.albumMode === "include"),
    count: filters.albumIds.length,
    hasDate: String(filters.dateFloor != null),
    date: filters.dateFloor != null ? formatDay(filters.dateFloor) : "",
  };
}

/** Items on the phone the filters leave out; 0 when either count is unknown. */
function excludedCount(libraryAll: number | null, libraryTotal: number | null): number {
  // Two separate metadata reads can race a new photo; never report a negative.
  return libraryAll != null && libraryTotal != null ? Math.max(0, libraryAll - libraryTotal) : 0;
}

/**
 * The ring's denominator, qualified, in one short line under the headline:
 * "Since 17 Sep 2025", "3 folders", "Photos only". Null when the filters cover
 * everything. The count of what is left out belongs to coverageWarning, so
 * the same figure is not printed twice on one screen; this line only carries
 * it when no setting explains the shortfall.
 */
export function coverageScope(
  filters: BackupFilters,
  /** Every photo and video on the device, or null when it could not be counted. */
  libraryAll: number | null,
  /** The eligible items under `filters`, or null when it could not be counted. */
  libraryTotal: number | null,
): string | null {
  if (isNarrowed(filters)) return t("backup.label.media", narrowingArgs(filters));
  const excluded = excludedCount(libraryAll, libraryTotal);
  return excluded > 0 ? t("backup.label.excludedMoreOnThisPhoneNotIncluded", { excluded: byteCount(excluded) }) : null;
}

export interface CoverageWarning {
  title: string;
  detail: string;
  /** Where the tap goes: the folder picker, or Backup settings for everything else. */
  target: "settings" | "folders";
}

/**
 * The warning a user needs when the ring's total is smaller than their phone:
 * "1366 of 1380 protected" beside ten thousand photos reads as nine thousand
 * lost unless something says the 1380 is the last twelve months, that the
 * older ones were never in scope, and where to change that. Null when nothing
 * is left out or the counts are unknown.
 */
export function coverageWarning(
  filters: BackupFilters,
  libraryAll: number | null,
  libraryTotal: number | null,
): CoverageWarning | null {
  const excluded = excludedCount(libraryAll, libraryTotal);
  if (excluded === 0) return null;

  const photos = filters.mediaTypes.includes("photo");
  const videos = filters.mediaTypes.includes("video");
  const mediaOnly = photos !== videos;
  const folders = filters.albumMode === "include";
  const dated = filters.dateFloor != null;
  const causes = Number(mediaOnly) + Number(folders) + Number(dated);

  const count = byteCount(excluded);
  if (causes === 1 && dated) {
    return {
      title: t("backup.heading.onlyPhotosAndVideosSinceDayAreBackedUp", { day: formatDay(filters.dateFloor!) }),
      detail: t("backup.description.backupWasSetToStartFromThatDateExcludedOlderPhotosAndVideosOn", { excluded: count }),
      target: "settings",
    };
  }
  if (causes === 1 && folders) {
    return {
      title: t("backup.heading.onlyNFolderNPluralOneIsOtherSAreBackedUp", { n: filters.albumIds.length }),
      detail: t("backup.description.excludedPhotosAndVideosInOtherFoldersOnThisPhoneAreNotBackedUp", { excluded: count }),
      target: "folders",
    };
  }
  if (causes === 1 && mediaOnly) {
    return photos
      ? {
          title: t("backup.heading.videosAreNotBackedUp"),
          detail: t("backup.description.excludedVideosOnThisPhoneAreNotBackedUpTapToIncludeThem", { excluded: count }),
          target: "settings",
        }
      : {
          title: t("backup.heading.photosAreNotBackedUp"),
          detail: t("backup.description.excludedPhotosOnThisPhoneAreNotBackedUpTapToIncludeThem", { excluded: count }),
          target: "settings",
        };
  }
  if (causes > 1) {
    return {
      title: t("backup.heading.notEverythingOnThisPhoneIsBackedUp"),
      detail: t("backup.description.backupIsLimitedToMedia", { ...narrowingArgs(filters), excluded: count }),
      target: "settings",
    };
  }
  return {
    title: t("backup.heading.notEverythingOnThisPhoneIsBackedUp"),
    detail: t("backup.description.excludedPhotosAndVideosOnThisPhoneAreNotIncludedInTheBackupTap", { excluded: count }),
    target: "settings",
  };
}
