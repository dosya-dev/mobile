import * as FileSystem from "expo-file-system/legacy";
import { t } from "@/lib/i18n";
import { ApiError } from "@/api/errors";
import { mayPersistBytes } from "@/files/cachePolicy";
import { ensureLocal, storePath } from "@/files/byteStore";

export interface BookFileMeta {
  id: string;
  current_version: number;
  extension: string | null;
  name: string;
  size_bytes: number;
  lock_mode: string;
}

/**
 * Books the reader is holding open but may not keep.
 *
 * foliate-js and react-native-pdf both read from a path - a book cannot be
 * streamed the way an image or a video can - so opening a view-only book means
 * writing its bytes to disk. That collided head-on with `mayPersistBytes`,
 * which exists precisely to stop a restricted file leaving a copy behind: the
 * reader was putting view-only books in the ordinary cache, where they outlived
 * the session, the app being closed, and the reader being shut.
 *
 * The reconciliation is scope, not principle. Restricted books land here, this
 * directory is emptied when the reader closes, and it is emptied again before
 * the next book opens - so a book killed mid-read by the app being force-quit
 * is cleared at the start of the next read rather than lingering. Unrestricted
 * books go to the shared byte store and are kept, which is the whole point of
 * that store.
 */
const TEMP_DIR = `${FileSystem.cacheDirectory}books-open/`;

/** Where `bookCache` used to keep every book, restricted ones included. */
const LEGACY_DIR = `${FileSystem.cacheDirectory}books/`;

let legacySwept = false;

function extFor(file: BookFileMeta): string {
  const fromMeta = (file.extension || "").toLowerCase().replace(/^\./, "");
  if (/^[a-z0-9]{1,8}$/.test(fromMeta)) return fromMeta;
  const m = /\.([a-z0-9]{1,8})$/i.exec(file.name);
  return m ? m[1].toLowerCase() : "bin";
}

/** Where a book being held open, but not kept, is written. */
export function bookTempPath(file: BookFileMeta): string {
  return `${TEMP_DIR}${file.id}-v${file.current_version}.${extFor(file)}`;
}

/** Where a book's bytes are, whether they are kept or only held. */
export function bookCachePath(file: BookFileMeta): string {
  return mayPersistBytes(file) ? storePath(file) : bookTempPath(file);
}

/** Empty the held-open directory. Safe to call when it does not exist. */
export async function releaseOpenBooks(): Promise<void> {
  const names = await FileSystem.readDirectoryAsync(TEMP_DIR).catch(() => [] as string[]);
  for (const name of names) {
    await FileSystem.deleteAsync(`${TEMP_DIR}${name}`, { idempotent: true }).catch(() => {});
  }
}

/**
 * Drop the directory the old cache used.
 *
 * It has no index and no cap, and on an existing install it still holds every
 * book ever opened - including view-only ones that should never have been
 * written there. Once per session is enough.
 */
async function sweepLegacyDir(): Promise<void> {
  if (legacySwept) return;
  legacySwept = true;
  await FileSystem.deleteAsync(LEGACY_DIR, { idempotent: true }).catch(() => {});
}

/** Download a restricted book into the held-open directory, replacing whatever was there. */
async function holdOpen(
  file: BookFileMeta,
  getUrl: () => Promise<string>,
  onProgress?: (written: number, total: number) => void,
  headers?: Record<string, string>,
): Promise<string> {
  // Before, not after: clearing the directory once this book has landed would
  // delete the book being opened.
  await releaseOpenBooks();
  await FileSystem.makeDirectoryAsync(TEMP_DIR, { intermediates: true }).catch(() => {});

  const dest = bookTempPath(file);
  const url = await getUrl();
  const job = FileSystem.createDownloadResumable(url, dest, headers ? { headers } : {}, (p) =>
    onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite),
  );
  const res = await job.downloadAsync();
  if (!res) throw new ApiError(t("common.error.downloadDidNotComplete"), 0);
  // downloadAsync writes HTTP error bodies to disk instead of rejecting.
  if (res.status >= 400) {
    await FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
    throw new ApiError(t("common.error.downloadFailedStatus", { status: String(res.status) }), res.status);
  }
  return res.uri;
}

/**
 * A local copy of the book to read from.
 *
 * Unrestricted books go through the shared byte store, which downloads once per
 * (file, version), reuses the copy on the next open, and evicts under a cap -
 * this used to be hand-rolled here, without the cap, so the directory grew
 * forever. Restricted books are held open only for as long as the reader is.
 */
export async function ensureBookCached(
  file: BookFileMeta,
  getUrl: () => Promise<string>,
  onProgress?: (written: number, total: number) => void,
  headers?: Record<string, string>,
): Promise<string> {
  if (!mayPersistBytes(file)) return holdOpen(file, getUrl, onProgress, headers);

  void sweepLegacyDir();
  const kept = await ensureLocal(file, getUrl, { headers, onProgress });
  // Null here means the store declined to keep it - a book bigger than the
  // whole cache budget. It still has to be readable now, so hold it open.
  return kept ?? holdOpen(file, getUrl, onProgress, headers);
}

export function _resetForTests(): void {
  legacySwept = false;
}
