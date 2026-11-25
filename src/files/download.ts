import * as Sharing from "expo-sharing";
import { storeTransient, type DownloadTask } from "./byteStore";
import { t } from "@/lib/i18n";

export interface CacheDownloadOpts {
  /**
   * For the authenticated /raw route, which is the only way to read a view-only
   * file's bytes - it cannot be presigned (download-url refuses view_only
   * outright). Presigned URLs carry their own credential in the query string
   * and pass nothing here.
   */
  headers?: Record<string, string>;
  /** Bytes on disk so far, and bytes expected. Fires before the promise settles. */
  onProgress?: (written: number, total: number) => void;
  /** Handed the live download so the caller can stop it. See byteStore's StoreOpts. */
  onTask?: (task: DownloadTask) => void;
}

/**
 * Fetch a file's bytes to disk for one viewing.
 *
 * This is the path taken for view-only and locked files - the ones the byte
 * store declines to keep - and for the share page, which has no file record.
 * They used to be written loose into the cache root, where nothing evicted
 * them; now they go into the byte store's transient area, which is capped,
 * LRU-evicted, and wiped at every launch (see byteStore.storeTransient).
 *
 * Runs on `createDownloadResumable` rather than `downloadAsync` for one reason:
 * `downloadAsync` has no progress callback at all, so exactly these files would
 * otherwise be the ones left with an indeterminate spinner.
 */
export async function downloadToCache(
  url: string,
  filename: string,
  opts?: CacheDownloadOpts,
): Promise<string> {
  return storeTransient(url, filename, opts);
}

/** `opts` names the type for a file the app wrote itself (an .ics event), so the sheet offers apps that open it. */
export async function shareFile(localUri: string, opts?: Sharing.SharingOptions): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(t("common.label.sharingIsNotAvailableOnThisDevice"));
  }
  await (opts ? Sharing.shareAsync(localUri, opts) : Sharing.shareAsync(localUri));
}
