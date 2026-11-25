import * as MediaLibrary from "expo-media-library";
import { countLibraryAssets } from "@/backup/scanner";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BackupFilters, BackupMediaType } from "@/backup/filters";

/**
 * How many assets to measure per media type, IN TOTAL - not per album. Big
 * enough that one outlier does not dominate the mean, small enough that step
 * 3 does not visibly stall. A per-album budget would multiply this bound by
 * however many albums the user selected, so a multi-album filter divides this
 * one budget across the selected albums instead of spending it per album.
 * Tune against a real device before trusting the number.
 */
export const SAMPLE_SIZE = 50;

export interface LibraryEstimate {
  photos: number;
  videos: number;
  /** Extrapolated from a sample. Null when nothing could be measured. */
  estimatedBytes: number | null;
}

const native = (t: BackupMediaType) =>
  t === "video" ? MediaLibrary.MediaType.video : MediaLibrary.MediaType.photo;

/**
 * Up to SAMPLE_SIZE assets of one media type, respecting the same album
 * scope countLibraryAssets uses - so the sample describes the same
 * population the count (and thus the extrapolation) does. Sampling from the
 * whole library while the count is album-restricted would let an excluded
 * album (e.g. a Screenshots album full of tiny PNGs) skew the mean applied
 * to a count that never included it, producing a confidently wrong total.
 *
 * "include" with no albums selected mirrors countLibraryAssets: nothing to
 * sample - never a silent fallback to the whole library.
 *
 * Never throws: a failed request or a resolved-but-malformed response is
 * treated as "nothing sampled" for that call, since this feeds a soft
 * estimate during onboarding - an unhandled rejection there is a worse
 * failure than an absent or partial number.
 */
async function sampleAssets(
  type: BackupMediaType,
  filters: BackupFilters,
): Promise<{ id: string }[]> {
  const floorS = filters.dateFloor ?? 0;
  const dateArgs = floorS > 0 ? { createdAfter: floorS * 1000 } : {};
  const mediaType = [native(type)];

  try {
    if (filters.albumMode === "include") {
      if (filters.albumIds.length === 0) return [];

      // Divide the ONE total budget across the selected albums, splitting
      // whatever remains evenly over the albums not yet drawn from - so an
      // album that runs out early doesn't shrink the overall sample, and no
      // single album can dominate it either.
      const assets: { id: string }[] = [];
      let remaining = SAMPLE_SIZE;
      for (let i = 0; i < filters.albumIds.length && remaining > 0; i++) {
        const albumsLeft = filters.albumIds.length - i;
        const quota = Math.ceil(remaining / albumsLeft);
        const page = await MediaLibrary.getAssetsAsync({
          first: quota,
          mediaType,
          album: filters.albumIds[i],
          ...dateArgs,
        });
        assets.push(...page.assets);
        remaining -= page.assets.length;
      }
      return assets;
    }

    const page = await MediaLibrary.getAssetsAsync({ first: SAMPLE_SIZE, mediaType, ...dateArgs });
    return page.assets;
  } catch {
    return [];
  }
}

/**
 * Mean bytes for one media type, from a bounded, album-scoped sample.
 *
 * Deliberately NOT resolveAsset(): that passes shouldDownloadFromNetwork:true
 * and would pull up to SAMPLE_SIZE iCloud originals over the network purely to
 * weigh them. An asset whose size is unavailable locally is skipped, not
 * counted as zero - zero would drag the mean down and understate the library.
 */
async function meanSize(type: BackupMediaType, filters: BackupFilters): Promise<number | null> {
  const assets = await sampleAssets(type, filters);

  let total = 0;
  let measured = 0;
  for (const a of assets) {
    try {
      const info = (await MediaLibrary.getAssetInfoAsync(a.id, {
        shouldDownloadFromNetwork: false,
      })) as { fileSize?: number };
      if (typeof info.fileSize === "number" && info.fileSize > 0) {
        total += info.fileSize;
        measured++;
      }
    } catch {
      // Unreadable locally (iCloud-only, or Limited access): skip it.
    }
  }
  return measured > 0 ? total / measured : null;
}

async function countOf(type: BackupMediaType, filters: BackupFilters): Promise<number | null> {
  if (!filters.mediaTypes.includes(type)) return 0;
  return countLibraryAssets({ ...filters, mediaTypes: [type] });
}

/**
 * Exact counts, estimated bytes. Null overall means no photo permission.
 */
export async function estimateLibrary(filters: BackupFilters): Promise<LibraryEstimate | null> {
  const photos = await countOf("photo", filters);
  const videos = await countOf("video", filters);
  if (photos === null || videos === null) return null;

  let bytes = 0;
  let any = false;
  for (const [type, count] of [["photo", photos], ["video", videos]] as const) {
    if (count === 0) continue;
    // meanSize already guards its own failures, but a thrown error escaping
    // from here would surface as an unhandled rejection during onboarding -
    // a worse outcome than simply treating this media type as unmeasured.
    let mean: number | null;
    try {
      mean = await meanSize(type, filters);
    } catch {
      mean = null;
    }
    if (mean === null) continue;
    bytes += mean * count;
    any = true;
  }
  return { photos, videos, estimatedBytes: any ? Math.round(bytes) : null };
}

/**
 * Renders a sampled figure with an explicit hedge. Counts are facts and are
 * printed bare; sizes are estimates and must never look like measurements.
 *
 * The conversion is the app's shared one (src/lib/format), which is BINARY -
 * the same base packages/shared/src/constants.ts uses for plan sizes
 * (GB = 1_073_741_824). This module used to carry a third, DECIMAL formatBytes
 * of its own, so onboarding printed "5.4 GB" for the same plan StorageBar,
 * WorkspaceSwitcher and the pricing page all called 5 GB - a wrong-looking
 * number inside the one warning whose whole job is to be believed. There is no
 * local copy any more: for a plan size (a known figure, not a sample) call
 * formatBytes from @/lib/format directly, so the wording never implies a
 * measurement is a guess.
 */
export function formatEstimate(bytes: number | null): string {
  if (bytes === null) return "";
  return t("onboarding.label.aboutSize", { size: formatBytes(bytes) });
}
