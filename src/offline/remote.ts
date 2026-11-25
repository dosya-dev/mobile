import { EDGE_CHALLENGE_CODE } from "@/api/client";
import { offlineRequest } from "./http";
import { ApiError } from "@/api/errors";
import type { FileDetail } from "@/files/types";
import type { AccessCheck, MembershipCheck } from "./plan";
import type { DesiredFile, OfflineFolderRow, PinRow } from "./types";

/**
 * The check phase: what each pin covers (membership) and whether this account
 * may still download each file (access). Network only - nothing here touches the
 * offline store, so it runs outside the commit lock on any connection.
 *
 * Every failure is classified, never guessed. Only a pin's OWN 403/404 makes it
 * `gone`; only a coded workspace refusal from download-check is a denial.
 * Everything else - offline, 401, 429, 5xx, the edge's challenge page - leaves
 * things as they were.
 */

/** Files per snapshot page: the server's default, well inside its cap. */
export const SNAPSHOT_PAGE = 5000;
/** download-check's own limit per request. */
export const ACCESS_CHUNK = 500;
const FILE_PIN_CONCURRENCY = 4;

interface SnapshotFile {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string | null;
  folder_id: string | null; updated_at: number; current_version: number; lock_mode?: unknown;
}
interface SnapshotPage {
  ok: true;
  files: SnapshotFile[];
  folders: { id: string; name: string; parent_id: string | null }[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A pin's own 403/404: the folder or file is no longer this account's to see. */
function isGone(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404) && e.code !== EDGE_CHALLENGE_CODE;
}

/**
 * Straight from the row. An older cached snapshot has no lock_mode at all; that
 * becomes "" so the planner keeps the copy but starts no transfer - it must
 * never be read as "none".
 */
function lockOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function desiredFromSnapshot(f: SnapshotFile, workspaceId: string): DesiredFile {
  return {
    file_id: f.id, workspace_id: workspaceId, folder_id: f.folder_id, name: f.name, extension: f.extension,
    mime_type: f.mime_type, size_bytes: f.size_bytes, current_version: f.current_version, updated_at: f.updated_at,
    lock_mode: lockOf(f.lock_mode),
  };
}

interface Snapshot {
  workspaceId: string;
  rootId: string;
  files: DesiredFile[];
  /** Every folder under the root (not the root itself), as the server sent them. */
  folders: { id: string; name: string; parent_id: string | null }[];
}

/** Every page, or null when any page failed. Throws only for the root's own 403/404. */
async function fetchSnapshot(workspaceId: string, folderId: string): Promise<Snapshot | null> {
  const files: DesiredFile[] = [];
  let folders: Snapshot["folders"] = [];
  let cursor: string | null = null;
  for (let page = 0; ; page += 1) {
    const qs = new URLSearchParams({ workspace_id: workspaceId, folder_id: folderId, limit: String(SNAPSHOT_PAGE) });
    if (cursor) qs.set("cursor", cursor);
    let res: SnapshotPage;
    try {
      res = await offlineRequest<SnapshotPage>(`/api/sync/snapshot?${qs.toString()}`);
    } catch (e) {
      // The root's refusal is only meaningful on the first page; a later 403
      // is as likely a hiccup as a revocation, and access is download-check's
      // question anyway.
      if (page === 0 && isGone(e)) throw new GoneError();
      return null;
    }
    // A 200 without a file list is a broken answer, not an empty folder:
    // reading it as empty would count a miss against every file in the pin.
    if (!res || !Array.isArray(res.files)) return null;
    if (page === 0) folders = Array.isArray(res.folders) ? res.folders : [];
    for (const f of res.files) files.push(desiredFromSnapshot(f, workspaceId));
    if (!res.hasMore) break;
    if (!res.nextCursor || res.nextCursor === cursor) return null; // a server that stops advancing is a failed run, not a short folder
    cursor = res.nextCursor;
  }
  return { workspaceId, rootId: folderId, files, folders };
}

class GoneError extends Error {}

/**
 * Every file under a folder, all pages, for sizing a pin before it is made.
 * Null when any page failed or the folder is not ours to read.
 */
export async function folderFiles(workspaceId: string, folderId: string): Promise<DesiredFile[] | null> {
  try {
    return (await fetchSnapshot(workspaceId, folderId))?.files ?? null;
  } catch {
    return null;
  }
}

/** The part of a snapshot under `folderId`, as a check for that pin. */
function subtree(snap: Snapshot, pin: PinRow): MembershipCheck & { outcome: "ok" } {
  const children = new Map<string, Snapshot["folders"]>();
  for (const f of snap.folders) {
    const key = f.parent_id ?? "";
    const list = children.get(key);
    if (list) list.push(f);
    else children.set(key, [f]);
  }
  const self = snap.folders.find((f) => f.id === pin.id);
  const rows: OfflineFolderRow[] = [{
    id: pin.id, workspace_id: pin.workspace_id, parent_id: self ? self.parent_id : null,
    name: self ? self.name : pin.name, pin_id: pin.id,
  }];
  const inside = new Set([pin.id]);
  const queue = [pin.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const c of children.get(id) ?? []) {
      if (inside.has(c.id)) continue;
      inside.add(c.id);
      queue.push(c.id);
      rows.push({ id: c.id, workspace_id: pin.workspace_id, parent_id: c.parent_id, name: c.name, pin_id: pin.id });
    }
  }
  const files = snap.files.filter((f) => f.folder_id != null && inside.has(f.folder_id));
  return { pinId: pin.id, revision: pin.revision, outcome: "ok", files, folders: rows };
}

async function checkFolderPins(pins: PinRow[], stored: OfflineFolderRow[]): Promise<MembershipCheck[]> {
  // Likely ancestors first: a pin that last run sat inside another pin's tree
  // goes after it, so its contents can be read from the ancestor's snapshot.
  const nestedLastRun = new Set(
    pins.filter((p) => stored.some((f) => f.id === p.id && f.pin_id !== p.id && f.workspace_id === p.workspace_id)).map((p) => p.id),
  );
  const ordered = [...pins.filter((p) => !nestedLastRun.has(p.id)), ...pins.filter((p) => nestedLastRun.has(p.id))];

  const fetched: Snapshot[] = [];
  const out: MembershipCheck[] = [];
  for (const pin of ordered) {
    // Captured now, before any await: the revision this check began with.
    const revision = pin.revision;
    const pinAtStart = { ...pin, revision };
    const ancestor = fetched.find((s) => s.workspaceId === pin.workspace_id && s.folders.some((f) => f.id === pin.id));
    if (ancestor) {
      out.push(subtree(ancestor, pinAtStart));
      continue;
    }
    try {
      const snap = await fetchSnapshot(pin.workspace_id, pin.id);
      if (!snap) {
        out.push({ pinId: pin.id, revision, outcome: "skipped" });
        continue;
      }
      fetched.push(snap);
      out.push(subtree(snap, pinAtStart));
    } catch (e) {
      out.push({ pinId: pin.id, revision, outcome: e instanceof GoneError ? "gone" : "skipped" });
    }
  }
  return out;
}

async function checkFilePin(pin: PinRow): Promise<MembershipCheck> {
  const revision = pin.revision;
  try {
    const res = await offlineRequest<{ ok: true; file?: FileDetail }>(`/api/files/${encodeURIComponent(pin.id)}`);
    const f = res?.file;
    // No record in a 200 is a broken answer: skipped, never "absent".
    if (!f || typeof f !== "object") return { pinId: pin.id, revision, outcome: "skipped" };
    // A trashed file is absent from the pin, not a refusal: two misses drop it,
    // and download-check settles whether the bytes may stay meanwhile.
    if (f.deleted_at) return { pinId: pin.id, revision, outcome: "ok", files: [], folders: [] };
    return {
      pinId: pin.id, revision, outcome: "ok", folders: [],
      files: [{
        file_id: f.id, workspace_id: pin.workspace_id, folder_id: f.folder_id ?? null, name: f.name,
        extension: f.extension, mime_type: f.mime_type, size_bytes: f.size_bytes, current_version: f.current_version,
        updated_at: f.updated_at, lock_mode: lockOf(f.lock_mode),
      }],
    };
  } catch (e) {
    return { pinId: pin.id, revision, outcome: isGone(e) ? "gone" : "skipped" };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * What each pin covers now. `folders` is the stored tree from the last run,
 * used only to order folder pins so nested ones read from their ancestor's
 * snapshot instead of making a request of their own.
 */
export async function checkMembership(pins: PinRow[], folders: OfflineFolderRow[]): Promise<MembershipCheck[]> {
  const folderPins = pins.filter((p) => p.kind === "folder");
  const filePins = pins.filter((p) => p.kind === "file");
  const [a, b] = await Promise.all([
    checkFolderPins(folderPins, folders),
    pool(filePins, FILE_PIN_CONCURRENCY, checkFilePin),
  ]);
  return [...a, ...b];
}

const WORKSPACE_REFUSALS = new Set(["not_member", "no_download_permission"]);

async function checkWorkspace(workspaceId: string, ids: string[]): Promise<AccessCheck> {
  const allowed = new Set<string>();
  const denied = new Set<string>();
  for (let i = 0; i < ids.length; i += ACCESS_CHUNK) {
    const chunk = ids.slice(i, i + ACCESS_CHUNK);
    try {
      const res = await offlineRequest<{ ok: true; decisions?: Record<string, unknown> }>("/api/sync/download-check", {
        method: "POST",
        body: { workspace_id: workspaceId, file_ids: chunk },
      });
      const decisions = res?.decisions;
      // A 200 without decisions answers nothing: unknown, like any failure.
      if (!decisions || typeof decisions !== "object") return { workspaceId, outcome: "unknown" };
      for (const id of chunk) {
        if (decisions[id] === "allowed") allowed.add(id);
        else if (decisions[id] === "denied") denied.add(id);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && e.code && WORKSPACE_REFUSALS.has(e.code)) {
        return { workspaceId, outcome: "workspace_denied" };
      }
      // No partial verdicts: half a workspace judged and half not would let a
      // later chunk's silence read as permission for the earlier ones' files.
      return { workspaceId, outcome: "unknown" };
    }
  }
  return { workspaceId, outcome: "ok", allowed, denied };
}

/** POST /api/sync/download-check for every workspace, 500 ids per call. */
export async function checkAccess(ids: Map<string, string[]>): Promise<AccessCheck[]> {
  const out: AccessCheck[] = [];
  for (const [ws, list] of ids) out.push(await checkWorkspace(ws, list));
  return out;
}
