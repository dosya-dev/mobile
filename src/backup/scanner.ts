import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";
import { assetPasses, DEFAULT_BACKUP_FILTERS, type BackupFilters } from "./filters";

// A light asset from the media-library scan - id + metadata only, NO file
// access. The file (uri + size) is materialized just-in-time by resolveAsset()
// for assets the ledger doesn't already have, so a re-scan over a huge library
// never re-downloads iCloud originals it has already backed up.
export interface ScannedAsset {
  id: string;
  filename: string;
  createdAt: number; // unix seconds
  modifiedAt: number; // unix seconds; 0 when the library reports none
  mediaType: "photo" | "video";
}

// A ScannedAsset whose file has been materialized to a readable local uri + size.
export interface ResolvedAsset extends ScannedAsset {
  uri: string;
  size: number;
}

/** An album (iOS) or device folder / MediaStore bucket (Android). */
export interface BackupAlbum {
  id: string;
  title: string;
  count: number;
}

export interface ScanOptions {
  /** Unix seconds: only scan assets created after this (incremental auto runs).
   * Omit for a full-library scan. */
  createdAfter?: number;
  /** The user's selection model. Omit for the everything shape. */
  filters?: BackupFilters;
}

/** Native media types for the query, from the user's selection. */
function nativeMediaTypes(f: BackupFilters): MediaLibrary.MediaTypeValue[] {
  return f.mediaTypes.map((t) =>
    t === "video" ? MediaLibrary.MediaType.video : MediaLibrary.MediaType.photo,
  );
}

export async function scanAssets(
  onBatch: (assets: ScannedAsset[]) => Promise<void>,
  opts: ScanOptions = {},
): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) return false;

  const filters = opts.filters ?? DEFAULT_BACKUP_FILTERS;
  // The incremental watermark and the user's date floor compose: the later of
  // the two wins, so a floor never re-opens ground the watermark already covered
  // and a watermark never drags in assets the user excluded by date.
  const floorS = Math.max(opts.createdAfter ?? 0, filters.dateFloor ?? 0);
  const mediaType = nativeMediaTypes(filters);

  // Guards against an asset that lives in two selected albums being emitted
  // twice. iOS albums overlap; Android buckets do not, so this costs nothing
  // there.
  const emitted = new Set<string>();

  // Pages one scope to exhaustion. This pass does NO file access - just ids +
  // metadata - so it stays fast even for a 1 TB / iCloud library.
  const pump = async (album?: string): Promise<void> => {
    let after: string | undefined;
    while (true) {
      const pageResult = await MediaLibrary.getAssetsAsync({
        first: 100,
        after,
        mediaType,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        // getAssetsAsync takes milliseconds; the filter runs natively, so an
        // incremental scan of a huge library touches only the new tail.
        ...(floorS > 0 ? { createdAfter: floorS * 1000 } : {}),
        ...(album ? { album } : {}),
      });
      const batch: ScannedAsset[] = [];
      for (const a of pageResult.assets) {
        if (emitted.has(a.id)) continue;
        const mapped: ScannedAsset = {
          id: a.id,
          filename: a.filename,
          createdAt: Math.floor((a.creationTime ?? 0) / 1000),
          modifiedAt: Math.floor((a.modificationTime ?? 0) / 1000),
          mediaType: a.mediaType === MediaLibrary.MediaType.video ? "video" : "photo",
        };
        // Defense in depth: the native query already narrowed by type and date,
        // but any mismatch here would silently back up excluded assets - the
        // exact failure this whole model exists to prevent.
        if (!assetPasses(mapped, filters)) continue;
        emitted.add(a.id);
        batch.push(mapped);
      }
      if (batch.length > 0) await onBatch(batch);
      if (!pageResult.hasNextPage) break;
      after = pageResult.endCursor;
    }
  };

  if (filters.albumMode === "include") {
    // An empty selection scans nothing. That is a choice the user made in the
    // folder picker, not an error, so the run still reports success.
    for (const id of filters.albumIds) await pump(id);
  } else {
    await pump();
  }
  return true;
}

/**
 * How long to wait before re-checking a file the media store reports as empty
 * (Android only). MediaStore publishes a row the moment the camera or a
 * download starts writing, so the first stat can land on a 0-byte file that
 * is complete a second later.
 */
export const ZERO_SIZE_RESTAT_MS = 1500;

async function statSize(uri: string): Promise<number> {
  const stat = await FileSystem.getInfoAsync(uri, { size: true } as never);
  const size = (stat as { size?: number }).size;
  return typeof size === "number" && Number.isFinite(size) ? size : 0;
}

/**
 * Why an asset could not be turned into bytes to upload.
 *
 * `unreadable` is transient and nobody's fault - an iCloud original that would
 * not download, or an asset outside Limited Photos access - so the next run
 * simply tries again. `empty` is a file the device really does report as 0
 * bytes; the caller records THAT against the asset so it stops being re-stat'd
 * (with a 1.5s wait) on every run for the rest of time.
 */
export type ResolveFailure = "unreadable" | "empty";

export type ResolveOutcome =
  | { asset: ResolvedAsset; reason?: undefined }
  | { asset: null; reason: ResolveFailure };

/**
 * Materialize an asset's file just before it's backed up: download the original
 * from iCloud if needed (shouldDownloadFromNetwork) and read its size. Returns
 * null if it can't be resolved to a readable file:// - an iOS Photos "ph://"
 * URI can't be uploaded, and an iCloud asset may fail to download / be behind
 * Limited Photos access; the caller skips it and a later run retries.
 *
 * A file that stats at 0 bytes is never handed back either. Uploading it would
 * record an empty "backup" of a real photo, which is worse than no backup: the
 * ledger marks it uploaded and never looks again. On Android the stat is
 * repeated once after ZERO_SIZE_RESTAT_MS, because MediaStore reports files
 * that are still being written; if it is still empty, or on iOS at all, the
 * asset is skipped for this run and retried by the next one.
 */
export async function resolveAsset(a: ScannedAsset): Promise<ResolveOutcome> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(a.id, { shouldDownloadFromNetwork: true });
    const uri = info.localUri ?? "";
    if (!uri || uri.startsWith("ph://") || uri.startsWith("assets-library://")) return { asset: null, reason: "unreadable" };
    let size = await statSize(uri);
    if (size <= 0 && Platform.OS === "android") {
      await new Promise<void>((r) => setTimeout(r, ZERO_SIZE_RESTAT_MS));
      size = await statSize(uri);
    }
    if (size <= 0) return { asset: null, reason: "empty" };
    return { asset: { ...a, uri, size } };
  } catch {
    return { asset: null, reason: "unreadable" };
  }
}

/**
 * Whether media access has ALREADY been granted, WITHOUT asking for it.
 *
 * scanAssets requests permission itself, so any UI that can reach runBackup
 * can fire the OS dialog cold - and iOS only ever shows it once per install.
 * A screen that wants to show a rationale first has to be able to ask this
 * question without answering it. Returns false on any error, so an unreadable
 * permission state routes to the rationale rather than to a cold prompt.
 */
export async function hasPhotoAccess(): Promise<boolean> {
  try {
    return (await MediaLibrary.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * True when the app only has partial photo access, so the scan sees just the
 * user-selected assets and the UI should nudge toward full access.
 *
 * Both platforms report this. iOS calls it "Limited"; Android 14 calls it
 * "Select photos", and expo-media-library normalizes it to the same
 * accessPrivileges value (it overwrites `granted` to true for that case, see
 * MediaLibraryPermissionPromiseWrapper.kt). Returns false on any error.
 */
export async function isPhotoAccessLimited(): Promise<boolean> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    return perm.granted && perm.accessPrivileges === "limited";
  } catch {
    return false;
  }
}

/**
 * Albums for the folder picker, biggest first. On Android these are MediaStore
 * buckets, which are disjoint - so the picker's running total is exact rather
 * than an estimate. On iOS they overlap and an asset can belong to none, which
 * is why iOS stays on albumMode "all" unless the user opts in.
 *
 * Empty albums are dropped: they are noise in a picker whose whole job is
 * showing where the volume is.
 */
export async function listBackupAlbums(): Promise<BackupAlbum[]> {
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    return albums
      .map((a) => ({ id: a.id, title: a.title, count: a.assetCount ?? 0 }))
      .filter((a) => a.count > 0)
      .sort((x, y) => y.count - x.count);
  } catch {
    return [];
  }
}

/**
 * How many items are ELIGIBLE under the given filters (no file access - a
 * single metadata page carries totalCount). Powers the dashboard's
 * "X of Y protected" coverage line, so the denominator must respect the
 * filters or the line counts items the user deliberately excluded. Null
 * without permission.
 */
export async function countLibraryAssets(filters?: BackupFilters): Promise<number | null> {
  const f = filters ?? DEFAULT_BACKUP_FILTERS;
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) return null;
    const mediaType = nativeMediaTypes(f);
    const floorS = f.dateFloor ?? 0;
    const one = async (album?: string): Promise<number> => {
      const pageResult = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType,
        ...(floorS > 0 ? { createdAfter: floorS * 1000 } : {}),
        ...(album ? { album } : {}),
      });
      return pageResult.totalCount;
    };
    if (f.albumMode === "include") {
      let total = 0;
      for (const id of f.albumIds) total += await one(id);
      return total;
    }
    return await one();
  } catch {
    return null;
  }
}
