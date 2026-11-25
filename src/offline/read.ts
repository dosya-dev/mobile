import * as FileSystem from "expo-file-system/legacy";
import { ApiError } from "@/api/errors";
import { t } from "@/lib/i18n";
import { fileKind } from "@/files/format";
import type { FileDetail, FileFilter, FileItem, FileListPage, FileSort, FolderItem } from "@/files/types";
import { currentSession } from "./session";
import { getFileRow, getFolder, listChildren, listFilesIn } from "./db";
import { savedPath } from "./store";
import { isOnlineNow } from "./network";
import { runOfflineSync } from "./sync";
import type { OfflineFileRow, RenditionState } from "./types";

/**
 * Reading pinned files without a network.
 *
 * The rule for every read path (localFirst): offline, answer from the phone at
 * once; online, ask the server and fall back to the phone only when the
 * TRANSPORT failed. A refusal (403, 404) is never masked by a saved copy - it
 * asks for a sync instead, and the sync's access check (G1) decides whether the
 * copy may stay.
 *
 * Every function here degrades to null. A broken offline store must never fail
 * an open or a listing that the server could have answered.
 */

/** A local read slower than this is treated as "nothing saved", so it can never hold up a screen. */
const LOCAL_READ_TIMEOUT_MS = 3000;

async function bounded<T>(p: Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p.catch(() => null),
      new Promise<null>((r) => { timer = setTimeout(() => r(null), LOCAL_READ_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SavedCopy { uri: string; version: number; rendition: RenditionState }

/** The saved bytes of a file (or its office PDF), if they are on the phone right now. */
export async function savedCopy(fileId: string, opts?: { variant?: "pdf" }): Promise<SavedCopy | null> {
  const s = currentSession();
  if (!s) return null;
  return bounded((async () => {
    const row = await getFileRow(s, fileId);
    if (!row || row.saved_version == null) return null;
    if (opts?.variant === "pdf" && (row.rendition !== "ready" || row.rendition_version !== row.saved_version)) return null;
    const uri = savedPath(s, row, opts?.variant);
    if (!uri) return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return { uri, version: row.saved_version, rendition: row.rendition };
  })());
}

const EXPORT_DIR = `${FileSystem.cacheDirectory ?? ""}offline-export/`;

/**
 * A saved original, ready to hand to Save, Share or another app: copied into
 * the cache under the file's own name (the saved bytes are named by id and
 * version). Null when there is no saved copy, the file is restricted, or we
 * are online and the server has a newer version - then the caller fetches
 * that as it always did.
 */
export async function savedOriginalForExport(
  file: { id: string; name: string; current_version: number; lock_mode: string },
): Promise<string | null> {
  if (file.lock_mode !== "none") return null;
  const saved = await savedCopy(file.id);
  if (!saved) return null;
  if (saved.version !== file.current_version && isOnlineNow() !== false) return null;
  try {
    const name = file.name.replace(/[/\\]/g, "_") || "file";
    // A folder per file: two files can share a name, and one export must never
    // replace the other while it is still being shared.
    const dir = `${EXPORT_DIR}${file.id.replace(/[^a-zA-Z0-9_-]/g, "_")}/`;
    const dest = `${dir}${name}`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    await FileSystem.copyAsync({ from: saved.uri, to: dest });
    return dest;
  } catch {
    return null;
  }
}

function asFileItem(r: OfflineFileRow): FileDetail {
  return {
    id: r.file_id, name: r.name, size_bytes: r.size_bytes, mime_type: r.mime_type, extension: r.extension,
    created_at: r.updated_at, updated_at: r.updated_at,
    // The server's version as last checked, not the saved one: the viewer
    // compares the two to say "update pending".
    current_version: r.remote_version,
    // Only unrestricted files are ever stored, and a file that became
    // restricted is removed by the next successful check.
    lock_mode: "none",
    share_count: 0, comment_count: 0, folder_id: r.folder_id, workspace_id: r.workspace_id,
  };
}

/** A covered file's record, from the offline store. */
export async function offlineFile(fileId: string): Promise<FileDetail | null> {
  const s = currentSession();
  if (!s) return null;
  return bounded(getFileRow(s, fileId).then((r) => (r ? asFileItem(r) : null)));
}

function passes(f: FileItem, filter: FileFilter): boolean {
  const kind = fileKind(f.mime_type, f.extension);
  if (filter === "images") return kind === "image";
  if (filter === "videos") return kind === "video";
  if (filter === "documents") return kind === "pdf" || kind === "office" || kind === "text" || kind === "book";
  return true;
}

function sorter(sort: FileSort): (a: FileItem, b: FileItem) => number {
  const byName = (a: FileItem, b: FileItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  switch (sort) {
    case "oldest": return (a, b) => a.updated_at - b.updated_at || byName(a, b);
    case "name_asc": return byName;
    case "name_desc": return (a, b) => byName(b, a);
    case "largest": return (a, b) => b.size_bytes - a.size_bytes || byName(a, b);
    case "smallest": return (a, b) => a.size_bytes - b.size_bytes || byName(a, b);
    default: return (a, b) => b.updated_at - a.updated_at || byName(a, b);
  }
}

/**
 * A pinned folder's contents, shaped like GET /api/files. Null for anything no
 * pin holds (including the workspace root), and for the filters the phone
 * cannot answer (shared, hidden) - those need the server.
 */
export async function offlineListing(
  workspaceId: string,
  folderId: string | null,
  opts: { filter?: FileFilter; sort?: FileSort } = {},
): Promise<FileListPage | null> {
  const s = currentSession();
  if (!s || !folderId) return null;
  const filter = opts.filter ?? "all";
  if (filter === "shared" || filter === "hidden") return null;
  return bounded((async () => {
    const self = await getFolder(s, folderId);
    if (!self || self.workspace_id !== workspaceId) return null;

    const crumbs: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (let f: typeof self | null = self; f && !seen.has(f.id); f = f.parent_id ? await getFolder(s, f.parent_id) : null) {
      seen.add(f.id);
      crumbs.unshift({ id: f.id, name: f.name });
    }

    const folders: FolderItem[] = (await listChildren(s, workspaceId, folderId)).map((f) => ({
      id: f.id, name: f.name, created_at: 0, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none",
    }));
    const files = (await listFilesIn(s, workspaceId, folderId))
      .map(asFileItem)
      .filter((f) => passes(f, filter))
      .sort(sorter(opts.sort ?? "newest"));
    return {
      folders, files, breadcrumbs: crumbs,
      pagination: { page: 1, per_page: files.length, total_files: files.length, total_pages: 1 },
    };
  })());
}

/** How long a server answer may take before a saved copy is shown instead. */
let remoteGraceMs = 8_000;
/** A 403/404 asks for a sync at most this often per item. */
const REFUSAL_SYNC_THROTTLE_MS = 10 * 60_000;
const lastRefusalSync = new Map<string, number>();

/** Test hooks. */
export function __setRemoteGraceForTests(ms: number | null): void {
  remoteGraceMs = ms ?? 8_000;
}
export function __resetReadForTests(): void {
  remoteGraceMs = 8_000;
  lastRefusalSync.clear();
}

/**
 * Answer from the server when we can, from the phone when we cannot.
 *
 *  - known offline: the phone, at once; nothing saved is an immediate network
 *    error (no waiting on a request that cannot succeed);
 *  - otherwise: the server. A transport failure (status 0 - including a 401 the
 *    client could not refresh, which it reports as one) falls back to the phone.
 *    So does a server that has not answered within a few seconds when a copy
 *    is saved: a captive portal looks online and answers nothing.
 *  - A 403/404 is rethrown as is, and asks for a sync when something is saved
 *    (once per `key` in ten minutes, so a screen that refetches does not
 *    start a sync on every render).
 */
export async function localFirst<T>(remote: () => Promise<T>, local: () => Promise<T | null>, key = "*"): Promise<T> {
  if (isOnlineNow() === false) {
    const l = await bounded(local());
    if (l != null) return l;
    throw new ApiError(t("common.error.networkRequestFailed"), 0);
  }
  const remoteP = remote();
  // Observed so a late rejection after we served the saved copy is not unhandled.
  remoteP.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const slow = new Promise<"slow">((r) => { timer = setTimeout(() => r("slow"), remoteGraceMs); });
  try {
    const first = await Promise.race([remoteP.then((v) => ({ v })), slow]);
    if (first !== "slow") return first.v;
    const l = await bounded(local());
    if (l != null) return l;
    return await remoteP;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const l = await bounded(local());
      if (l != null) return l;
    } else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      if ((await bounded(local())) != null) {
        const now = Date.now();
        const last = lastRefusalSync.get(key);
        if (last === undefined || now - last >= REFUSAL_SYNC_THROTTLE_MS) {
          lastRefusalSync.set(key, now);
          void runOfflineSync({ reason: "manual" });
        }
      }
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ViewerSource = { kind: "saved"; uri: string; version: number; newer: boolean } | { kind: "stream" };

/**
 * Which bytes the viewer shows - the plan's "Viewer behaviour" table.
 *
 * A saved copy is always preferred and never replaced behind the user's back.
 * The only way to the server's newer version is the user asking for it, from
 * Files (not the Offline screen), while online. Unknown connectivity counts as
 * online here: asking costs nothing if it turns out to be offline.
 */
export function chooseSource(i: {
  saved: { uri: string; version: number } | null;
  serverVersion: number | null;
  online: boolean | null;
  origin: "offline-screen" | "files";
  userAskedNewer: boolean;
}): ViewerSource {
  if (!i.saved) return { kind: "stream" };
  const newer = i.serverVersion != null && i.serverVersion !== i.saved.version;
  if (newer && i.userAskedNewer && i.origin === "files" && i.online !== false) return { kind: "stream" };
  return { kind: "saved", uri: i.saved.uri, version: i.saved.version, newer };
}
