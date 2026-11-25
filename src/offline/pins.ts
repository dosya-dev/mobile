import type { FileDetail, FileItem, FolderItem } from "@/files/types";
import { beginSession, cancelTasksFor, currentSession, endSession, withCommit, type OfflineSession } from "./session";
import { addMembers, closeOfflineDb, deleteFileRows, deletePin, listFiles, upsertMeta, upsertPin } from "./db";
import { removeFileBytes, wipeAccount } from "./store";
import { folderFiles } from "./remote";
import { lockDenies } from "./plan";
import { runOfflineSync } from "./sync";
import { useOfflineStore } from "./offlineStore";

/**
 * Making something available offline, and taking it back.
 *
 * Unpin and Remove all are local and immediate: they free the space on the
 * spot, with or without a connection, and a sync running at the time cannot
 * bring anything back (its publish re-checks inside the same commit lock).
 */

/** Pinning a folder that would add more than this asks first. */
export const LARGE_FOLDER_BYTES = 1024 ** 3;

/**
 * Whether an item may be pinned at all. Only an unrestricted file or folder
 * qualifies - the same rule as the byte cache's mayPersistBytes. A full_lock
 * file the user has unlocked is still refused: the server's download gate
 * refuses it too, so a pin could never fill.
 */
export function canPin(item: { lock_mode: string }, ctx: { inVault: boolean }): { ok: true } | { ok: false; reason: "restricted" | "vault" } {
  if (ctx.inVault) return { ok: false, reason: "vault" };
  if (item.lock_mode !== "none") return { ok: false, reason: "restricted" };
  return { ok: true };
}

function requireSession(): OfflineSession {
  const s = currentSession();
  if (!s) throw new Error("offline: no session");
  return s;
}

/**
 * What pinning a folder would cost: how many files we would keep and how many
 * bytes that adds beyond what is already saved. Rejects when the folder cannot
 * be read in full, so the caller never shows a confirm built on half an answer.
 */
export async function estimateFolder(workspaceId: string, folderId: string): Promise<{ files: number; additionalBytes: number }> {
  const files = await folderFiles(workspaceId, folderId);
  if (!files) throw new Error("offline: folder could not be read");
  const s = currentSession();
  const saved = new Map<string, number | null>();
  if (s) for (const r of await listFiles(s).catch(() => [])) saved.set(r.file_id, r.saved_version);
  let count = 0;
  let additionalBytes = 0;
  for (const f of files) {
    if (lockDenies(f.lock_mode) || f.lock_mode !== "none") continue;
    count += 1;
    if (saved.get(f.file_id) !== f.current_version) additionalBytes += f.size_bytes;
  }
  return { files: count, additionalBytes };
}

/** Pin one file. It is covered at once (so it shows as pending), and a sync starts. */
export async function pinFile(file: FileItem, workspaceId: string): Promise<void> {
  if (!canPin(file, { inVault: false }).ok) throw new Error("offline: file cannot be pinned");
  const s = requireSession();
  await withCommit(s, async () => {
    // upsertPin starts the revision above anything this id ever had, so a
    // check that began before an earlier unpin cannot apply to this pin.
    await upsertPin(s, { id: file.id, kind: "file", workspace_id: workspaceId, name: file.name, created_at: Date.now() });
    await upsertMeta(s, [{
      file_id: file.id, workspace_id: workspaceId, folder_id: (file as FileDetail).folder_id ?? null, name: file.name,
      extension: file.extension, mime_type: file.mime_type, size_bytes: file.size_bytes,
      current_version: file.current_version, updated_at: file.updated_at, lock_mode: file.lock_mode,
    }]);
    await addMembers(s, file.id, [file.id]);
  });
  await useOfflineStore.getState().refresh();
  void runOfflineSync({ reason: "pin" });
}

/** Pin a folder. Its contents arrive with the sync this starts. */
export async function pinFolder(folder: FolderItem, workspaceId: string): Promise<void> {
  if (!canPin(folder, { inVault: false }).ok) throw new Error("offline: folder cannot be pinned");
  const s = requireSession();
  await withCommit(s, async () => {
    await upsertPin(s, { id: folder.id, kind: "folder", workspace_id: workspaceId, name: folder.name, created_at: Date.now() });
  });
  await useOfflineStore.getState().refresh();
  void runOfflineSync({ reason: "pin" });
}

/**
 * Unpin: inside one commit, remove the pin, then every file no other pin
 * covers - its running download first, then its row, then its bytes. No
 * network, so it works offline and frees the space at once.
 */
export async function unpin(pinId: string): Promise<void> {
  const s = currentSession();
  if (!s) return;
  await withCommit(s, async () => {
    const orphans = await deletePin(s, pinId);
    if (orphans.length === 0) return;
    await cancelTasksFor(orphans);
    await deleteFileRows(s, orphans);
    for (const id of orphans) await removeFileBytes(s, id);
  });
  await useOfflineStore.getState().refresh();
}

/**
 * Remove all: end the session (fencing any running sync and waiting out a
 * commit in flight), close the database, delete the account's whole offline
 * directory, and begin a fresh, empty session for the same account.
 */
export async function removeAll(): Promise<void> {
  const s = currentSession();
  if (!s) return;
  await endSession();
  await closeOfflineDb();
  await wipeAccount(s.accountId);
  beginSession(s.accountId);
  useOfflineStore.getState().reset();
  await useOfflineStore.getState().refresh();
}
