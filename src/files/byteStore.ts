import * as FileSystem from "expo-file-system/legacy";
import { ApiError } from "@/api/errors";
import { t } from "@/lib/i18n";
import { mayPersistBytes } from "./cachePolicy";

/**
 * The device's copy of a file's bytes.
 *
 * Opening a document used to fetch it from the server every single time: the
 * viewer resolved a fresh presigned URL per open, so a 30MB deck was 30MB again
 * on the way back from lunch. Music and books already kept a local copy;
 * everything else did not, and the explicit Download wrote bytes that nothing
 * ever read back.
 *
 * This is that copy, for every kind of file. It is modelled on
 * `player/cache.ts`, which is the mature version of this idea, and it takes
 * over what `reader/bookCache.ts` did by hand - including the one thing that
 * file was missing, a cap. Anything here is reconstructible from the server, it
 * lives in the cache directory, and sign-out wipes it (`clearCachedFileBytes`).
 *
 * A cache failure must never fail an open. Every path here degrades to "no
 * local copy", and the caller streams as it always did.
 */

export interface StorableFile {
  id: string;
  current_version: number;
  extension: string | null;
  name: string;
  size_bytes: number;
  lock_mode: string;
}

export interface StoreEntry {
  /** `<fileId>` for the file's own bytes, `<fileId>:<variant>` for a rendition. */
  fileId: string;
  version: number;
  ext: string;
  sizeBytes: number;
  lastUsedAt: number;
}

/**
 * Which bytes of a file these are.
 *
 * An office document previews as a PDF the server converted for us, not as the
 * .docx itself - no PDF viewer reads a docx. Both are "file X, version N", so
 * without a variant in the key the converted PDF and the original would take
 * turns overwriting each other, and whichever lost would be served to a viewer
 * that cannot read it.
 */
export interface StoreOpts {
  variant?: string;
  /** Extension for the stored bytes when the variant is not the original (e.g. "pdf"). */
  ext?: string;
  headers?: Record<string, string>;
  onProgress?: (written: number, total: number) => void;
  /**
   * Handed the live download the moment it exists, so the caller can stop it.
   * The task is created deep inside the job and is unreachable otherwise, which
   * is why a running download used to be uncancellable: the only affordance was
   * a spinner, and the user's only option was to wait out a half-gigabyte
   * transfer they had started by accident.
   */
  onTask?: (task: DownloadTask) => void;
  /** Byte count of the stored bytes, when the variant's size differs from the file's. */
  sizeBytes?: number;
}

export interface DownloadTask {
  cancelAsync: () => Promise<void>;
}

/**
 * 1GB, kept separate from the audio cache's 500MB rather than pooled.
 *
 * One shared budget would let a morning of opening documents evict the album
 * the player is halfway through, which is the one eviction a listener would
 * actually notice.
 */
export const CAP_BYTES = 1024 * 1024 * 1024;

const DIR = `${FileSystem.cacheDirectory}files/`;
const INDEX = `${DIR}index.json`;

/**
 * Where view-only and locked files land when the viewer has to fetch their
 * bytes to disk (see download.ts). They may not persist under mayPersistBytes,
 * so they get their own area: a smaller cap, LRU-evicted, and wiped at every
 * launch (cacheControl.sweepSessionCaches). Before this they were written loose
 * into the cache root, where nothing ever evicted them - the one class of file
 * that must not linger was the one that lingered longest.
 */
export const TRANSIENT_DIR = `${DIR}transient/`;
const TRANSIENT_INDEX = `${TRANSIENT_DIR}index.json`;
export const TRANSIENT_CAP_BYTES = 256 * 1024 * 1024;
let transientCap = TRANSIENT_CAP_BYTES;

/** Test hook: shrink the transient cap. `null` restores the default. */
export function __setTransientCapForTests(bytes: number | null): void {
  transientCap = bytes ?? TRANSIENT_CAP_BYTES;
}

/** Sanitize a filename for use as a single cache path segment. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Downloads in flight, so two stages opening one file fetch it once. */
const inFlight = new Map<string, Promise<string | null>>();

function extFor(file: StorableFile): string {
  const fromMeta = (file.extension || "").toLowerCase().replace(/^\./, "");
  if (/^[a-z0-9]{1,8}$/.test(fromMeta)) return fromMeta;
  const m = /\.([a-z0-9]{1,8})$/i.exec(file.name);
  return m ? m[1].toLowerCase() : "bin";
}

/** The index key for a file, or for one of its renditions. */
function keyFor(file: StorableFile, opts?: StoreOpts): string {
  return opts?.variant ? `${file.id}:${opts.variant}` : file.id;
}

/**
 * Where a file's bytes live. The version is in the name on purpose: an edit on
 * the server changes the path, so a stale copy can never be served and there is
 * no cache to bust.
 */
export function storePath(file: StorableFile, opts?: StoreOpts): string {
  const variant = opts?.variant ? `-${opts.variant}` : "";
  return `${DIR}${file.id}-v${file.current_version}${variant}.${opts?.ext ?? extFor(file)}`;
}

/** The byte count to expect on disk - a rendition's own size when it has one. */
function expectedSize(file: StorableFile, opts?: StoreOpts): number | null {
  return opts?.sizeBytes ?? (opts?.variant ? null : file.size_bytes);
}

/** Pure LRU pick: which fileIds to drop so the total stays within the cap. */
export function selectEvictions(entries: StoreEntry[], capBytes: number): string[] {
  let total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const oldestFirst = [...entries].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const evict: string[] = [];
  for (const e of oldestFirst) {
    if (total <= capBytes) break;
    evict.push(e.fileId);
    total -= e.sizeBytes;
  }
  return evict;
}

async function readIndex(): Promise<StoreEntry[]> {
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(INDEX));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing or corrupt: an unreadable index means "nothing is cached", never
    // an error the viewer has to handle.
    return [];
  }
}

async function writeIndex(entries: StoreEntry[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(entries)).catch(() => {});
}

function pathFor(entry: StoreEntry): string {
  return `${DIR}${entry.fileId}-v${entry.version}.${entry.ext}`;
}

async function dropEntries(entries: StoreEntry[], fileIds: Set<string>): Promise<StoreEntry[]> {
  for (const e of entries) {
    if (fileIds.has(e.fileId)) await FileSystem.deleteAsync(pathFor(e), { idempotent: true }).catch(() => {});
  }
  return entries.filter((e) => !fileIds.has(e.fileId));
}

/**
 * The local path for a file, or null when it has to come from the server.
 *
 * Null covers every miss the caller does not care to distinguish: never stored,
 * stored at an older version, evicted, or half-written.
 */
export async function localUri(file: StorableFile, opts?: StoreOpts): Promise<string | null> {
  if (!mayPersistBytes(file)) return null;

  const key = keyFor(file, opts);
  const entries = await readIndex();
  const entry = entries.find((e) => e.fileId === key);
  if (!entry) return null;

  if (entry.version !== file.current_version) {
    await writeIndex(await dropEntries(entries, new Set([key])));
    return null;
  }

  const path = storePath(file, opts);
  const info = await FileSystem.getInfoAsync(path);
  // A path that exists at the wrong size is a download that was killed
  // mid-transfer. Trusting `exists` alone serves that truncated file forever.
  // A rendition has no size known up front, so its recorded size is the check.
  const expect = expectedSize(file, opts) ?? entry.sizeBytes;
  const truncated = info.exists && typeof info.size === "number" && info.size !== expect;
  if (!info.exists || truncated) {
    await writeIndex(await dropEntries(entries, new Set([key])));
    return null;
  }

  entry.lastUsedAt = Date.now();
  await writeIndex(entries);
  return path;
}

/**
 * The local path for a file, fetching it once if it is not already here.
 *
 * Returns null - rather than throwing - for a file that may not be persisted,
 * so callers can treat "no local copy" uniformly and stream instead.
 */
export async function ensureLocal(
  file: StorableFile,
  getUrl: () => Promise<string>,
  opts?: StoreOpts,
): Promise<string | null> {
  if (!mayPersistBytes(file)) return null;

  const key = keyFor(file, opts);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    const hit = await localUri(file, opts);
    if (hit) return hit;

    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const dest = storePath(file, opts);
    // Any other version of this file is now dead weight - drop it before
    // writing, so a file edited repeatedly cannot leave a copy per version.
    // Matched on the variant too, or caching the PDF rendition would delete
    // the original's bytes and vice versa.
    const variantTag = opts?.variant ? `-${opts.variant}.` : ".";
    const keep = dest.slice(DIR.length);
    const stale = (await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]))
      .filter((n) => n.startsWith(`${file.id}-v`) && n.includes(variantTag) && n !== keep)
      .filter((n) => (opts?.variant ? true : !/-v\d+-[a-z0-9]+\./i.test(n)));
    for (const name of stale) {
      await FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true }).catch(() => {});
    }

    const url = await getUrl();
    const dl = FileSystem.createDownloadResumable(
      url,
      dest,
      opts?.headers ? { headers: opts.headers } : {},
      opts?.onProgress ? (p) => opts.onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite) : undefined,
    );
    opts?.onTask?.(dl);
    const res = await dl.downloadAsync();
    if (!res) throw new ApiError(t("common.error.downloadDidNotComplete"), 0);
    // downloadAsync does NOT reject on an HTTP error - it writes the error
    // body to disk. Without this, a 403 is cached as though it were the file.
    if (res.status >= 400) {
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      throw new ApiError(t("common.error.downloadFailedStatus", { status: String(res.status) }), res.status);
    }

    // A rendition's size is only known once it has landed.
    const written = await FileSystem.getInfoAsync(dest);
    const writtenSize = written.exists && typeof written.size === "number" ? written.size : 0;
    const entries = (await readIndex()).filter((e) => e.fileId !== key);
    entries.push({
      fileId: key,
      version: file.current_version,
      ext: opts?.ext ?? extFor(file),
      sizeBytes: expectedSize(file, opts) ?? writtenSize,
      lastUsedAt: Date.now(),
    });
    const evicted = new Set(selectEvictions(entries, CAP_BYTES));
    await writeIndex(await dropEntries(entries, evicted));
    // The file just written can itself be the thing evicted, when one file is
    // larger than the whole cap. Say so rather than hand back a deleted path.
    return evicted.has(key) ? null : dest;
  })();

  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

/** Drop a file's bytes and its index entry. */
export async function forget(fileId: string): Promise<void> {
  const entries = await readIndex();
  await writeIndex(await dropEntries(entries, new Set([fileId])));
}

async function readTransientIndex(): Promise<StoreEntry[]> {
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(TRANSIENT_INDEX));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeTransientIndex(entries: StoreEntry[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(TRANSIENT_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(TRANSIENT_INDEX, JSON.stringify(entries)).catch(() => {});
}

/** The transient index keys entries by `transient:<name>`; the path is the name. */
function transientPath(entry: StoreEntry): string {
  return `${TRANSIENT_DIR}${entry.fileId.slice("transient:".length)}`;
}

export interface TransientOpts {
  headers?: Record<string, string>;
  onProgress?: (written: number, total: number) => void;
  onTask?: (task: DownloadTask) => void;
}

/**
 * Fetch a file's bytes into the transient area and return the local path.
 *
 * Same download mechanics as ensureLocal (resumable, progress, cancel handle,
 * HTTP errors rejected rather than written to disk as if they were the file),
 * but keyed by filename rather than by file id + version, because the callers
 * hand over a display name and a URL - the share page has no file record at
 * all. The new file is registered in the LRU, older entries are evicted past
 * the cap, and the file just written is never the one evicted.
 */
export async function storeTransient(url: string, filename: string, opts?: TransientOpts): Promise<string> {
  await FileSystem.makeDirectoryAsync(TRANSIENT_DIR, { intermediates: true }).catch(() => {});
  const name = safeName(filename);
  const key = `transient:${name}`;
  const dest = `${TRANSIENT_DIR}${name}`;

  const dl = FileSystem.createDownloadResumable(
    url,
    dest,
    opts?.headers ? { headers: opts.headers } : {},
    opts?.onProgress ? (p) => opts.onProgress?.(p.totalBytesWritten, p.totalBytesExpectedToWrite) : undefined,
  );
  opts?.onTask?.(dl);
  const res = await dl.downloadAsync();
  // A cancelled resumable download resolves undefined rather than rejecting.
  if (!res) throw new ApiError(t("common.error.downloadWasCancelled"), 0);
  // downloadAsync does NOT reject on HTTP error statuses - it happily writes
  // the error-response body (e.g. `{"ok":false,...}`) to disk. Guard against
  // silently "succeeding" with a corrupt file for protected/expired/locked
  // downloads (403/410/etc).
  if (res.status >= 400) {
    await FileSystem.deleteAsync(res.uri || dest, { idempotent: true }).catch(() => {});
    throw new ApiError(t("common.error.downloadFailedStatus", { status: String(res.status) }), res.status);
  }

  const written = await FileSystem.getInfoAsync(dest).catch(() => null);
  const sizeBytes = written && written.exists && typeof written.size === "number" ? written.size : 0;
  const entries = (await readTransientIndex()).filter((e) => e.fileId !== key);
  entries.push({ fileId: key, version: 0, ext: "", sizeBytes, lastUsedAt: Date.now() });
  const evicted = new Set(selectEvictions(entries, transientCap));
  evicted.delete(key); // the bytes the caller is about to open stay
  for (const e of entries) {
    if (evicted.has(e.fileId)) await FileSystem.deleteAsync(transientPath(e), { idempotent: true }).catch(() => {});
  }
  await writeTransientIndex(entries.filter((e) => !evicted.has(e.fileId)));
  return res.uri || dest;
}

/** Remove the transient area wholesale (launch, cache clear, sign-out). */
export async function sweepTransient(): Promise<void> {
  await FileSystem.deleteAsync(TRANSIENT_DIR, { idempotent: true }).catch(() => {});
}

export function _resetForTests(): void {
  inFlight.clear();
}
