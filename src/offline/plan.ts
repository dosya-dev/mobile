import type { DesiredFile, OfflineFileRow, OfflineFolderRow, PinMember } from "./types";

/**
 * The offline planner: given what this run learned, what changes.
 *
 * Two questions, kept apart on purpose (the plan's "Membership vs access"):
 *  - MEMBERSHIP, does pin P still cover file X? From snapshots and file records.
 *    It only ever adds or drops memberships. A file leaves the phone through it
 *    only when no pin covers it at all, and that is decided after every pin's
 *    changes are written, never here.
 *  - ACCESS, may this account download X? From download-check and a snapshot's
 *    lock_mode. A confirmed "no" deletes X whatever pins cover it.
 *
 * Unknown is never no. An answer we did not get (a failed page, a 401, a 429, a
 * 5xx, a missing lock_mode from an older cached response) changes nothing and
 * starts nothing - a phone must never be emptied by a server that was briefly
 * unreachable or a rollback that dropped a field.
 *
 * Pure: no I/O, so every rule is tested as a table.
 */

export type MembershipCheck = { pinId: string; revision: number } & (
  /** Every page OK. `files` are what the pin covers now; `folders` its subtree. */
  | { outcome: "ok"; files: DesiredFile[]; folders: OfflineFolderRow[] }
  /** The pin's own folder or file answered 403/404. */
  | { outcome: "gone" }
  /** Anything else: this pin is left exactly as it was. */
  | { outcome: "skipped" }
);

export type AccessCheck =
  | { workspaceId: string; outcome: "ok"; allowed: Set<string>; denied: Set<string> }
  | { workspaceId: string; outcome: "workspace_denied" }
  | { workspaceId: string; outcome: "unknown" };

export interface SyncPlan {
  goneByPin: string[];
  membership: { pinId: string; present: string[]; missing: string[] }[];
  folders: { pinId: string; rows: OfflineFolderRow[] }[];
  /** Delete now, whatever pins cover them. */
  denied: string[];
  upsertMeta: DesiredFile[];
  /** Covered, allowed this run, and not saved at the server's version. */
  transfer: DesiredFile[];
}

/** The only lock modes that are a denial. Anything else, including none at all, is not. */
export function lockDenies(lockMode: string | null | undefined): boolean {
  return lockMode === "full_lock" || lockMode === "view_only";
}

/** Whether a file's bytes may be stored at all - exactly mayPersistBytes's rule. */
function lockAllowsStore(lockMode: string | null | undefined): boolean {
  return lockMode === "none";
}

function desiredById(m: MembershipCheck[]): Map<string, DesiredFile> {
  const out = new Map<string, DesiredFile>();
  for (const c of m) {
    if (c.outcome !== "ok") continue;
    for (const f of c.files) {
      const prev = out.get(f.file_id);
      // Two snapshots fetched moments apart can disagree on a file edited in
      // between; the newer description wins.
      if (!prev || f.current_version > prev.current_version) out.set(f.file_id, f);
    }
  }
  return out;
}

export function planSync(m: MembershipCheck[], a: AccessCheck[], local: OfflineFileRow[], members: PinMember[]): SyncPlan {
  const want = desiredById(m);
  const access = new Map(a.map((c) => [c.workspaceId, c]));

  const goneByPin: string[] = [];
  const membership: SyncPlan["membership"] = [];
  const folders: SyncPlan["folders"] = [];
  for (const c of m) {
    if (c.outcome === "gone") {
      goneByPin.push(c.pinId);
    } else if (c.outcome === "ok") {
      const present = [...new Set(c.files.map((f) => f.file_id))];
      const seen = new Set(present);
      const missing = members.filter((x) => x.pin_id === c.pinId && !seen.has(x.file_id)).map((x) => x.file_id);
      membership.push({ pinId: c.pinId, present, missing });
      folders.push({ pinId: c.pinId, rows: c.folders });
    }
  }

  // Access. Every file we hold a row for or want this run is a candidate.
  const candidates = new Map<string, string>(); // file -> workspace
  for (const r of local) candidates.set(r.file_id, r.workspace_id);
  for (const f of want.values()) candidates.set(f.file_id, f.workspace_id);

  const denied = new Set<string>();
  for (const [fileId, ws] of candidates) {
    const verdict = access.get(ws);
    if (verdict?.outcome === "workspace_denied") denied.add(fileId);
    else if (verdict?.outcome === "ok" && verdict.denied.has(fileId)) denied.add(fileId);
    const f = want.get(fileId);
    if (f && lockDenies(f.lock_mode)) denied.add(fileId);
  }

  const savedVersion = new Map(local.map((r) => [r.file_id, r.saved_version]));
  const upsertMeta: DesiredFile[] = [];
  const transfer: DesiredFile[] = [];
  for (const f of want.values()) {
    if (denied.has(f.file_id)) continue;
    upsertMeta.push(f);
    const verdict = access.get(f.workspace_id);
    const isAllowed = verdict?.outcome === "ok" && verdict.allowed.has(f.file_id);
    if (!isAllowed || !lockAllowsStore(f.lock_mode)) continue;
    if (savedVersion.get(f.file_id) === f.current_version) continue;
    transfer.push(f);
  }

  return { goneByPin, membership, folders, denied: [...denied].sort(), upsertMeta, transfer };
}

/**
 * Which files to ask download-check about, per workspace: every file that has
 * bytes on the phone - even one with nothing to transfer, which is exactly the
 * file a revoked role must still lose - plus every file this run would download.
 */
export function accessIdsToAsk(local: OfflineFileRow[], m: MembershipCheck[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (ws: string, id: string) => {
    let set = out.get(ws);
    if (!set) {
      set = new Set();
      out.set(ws, set);
    }
    set.add(id);
  };
  const savedVersion = new Map(local.map((r) => [r.file_id, r.saved_version]));
  for (const r of local) if (r.saved_version != null) add(r.workspace_id, r.file_id);
  for (const f of desiredById(m).values()) {
    if (lockDenies(f.lock_mode)) continue;
    if (savedVersion.get(f.file_id) === f.current_version) continue;
    add(f.workspace_id, f.file_id);
  }
  return new Map([...out].map(([ws, ids]) => [ws, [...ids]]));
}
