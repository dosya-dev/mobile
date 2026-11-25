import { translateExternal } from "@/lib/external-text";
import { apiRequest } from "@/api";
import type { PurgeResponse } from "./folderPurge";
import {
  validateFileName, validateFolderName, validateFolderPath,
} from "@/lib/validationPolicy.generated";

/**
 * Name rules run HERE rather than in each sheet.
 *
 * This module is the single funnel every rename and folder-create goes through
 * (see mutationHooks.ts and the sheets that call it), so one check covers every
 * caller instead of relying on each new screen to remember. The thrown Error's
 * message is what `onError` in mutationHooks.ts toasts, and it is the same
 * sentence the API would have returned - the rules are generated from
 * packages/shared/src/validation/policy.ts, which is also what the server runs.
 *
 * Before this, mobile posted whatever was typed: a name with a slash in it cost
 * a round trip and came back as a bare "Name contains invalid characters" with
 * no indication which part of the app had refused it.
 */
function reject(message: string): never {
  throw new Error(translateExternal(message));
}

export const renameFile = (id: string, name: string) => {
  const problem = validateFileName(name);
  if (problem) reject(problem);
  return apiRequest<{ ok: true }>(`/api/files/${id}/rename`, { method: "PUT", body: { name } });
};

export const moveFile = (id: string, folderId: string | null) =>
  apiRequest<{ ok: true }>(`/api/files/${id}/move`, { method: "PUT", body: { folder_id: folderId } });

export const copyFile = (id: string, folderId?: string) =>
  apiRequest<{ ok: true }>(`/api/files/${id}/copy`, { method: "POST", body: folderId ? { folder_id: folderId } : {} });

export const deleteFile = (id: string) =>
  apiRequest<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" });

export const restoreFile = (id: string) =>
  apiRequest<{ ok: true }>(`/api/files/${id}`, { method: "PUT" });

/**
 * Restore a trashed folder (a trash root only; the server answers 400 for a
 * folder that went to the trash as part of another). `name` is the name the
 * server actually used (a clash gets a suffix); `restored_to_root` says its
 * original parent is in the trash too, so it came back at the workspace root.
 */
export const restoreFolder = (id: string) =>
  apiRequest<{ ok: true; name?: string; restored_to_root?: boolean }>(`/api/folders/${id}`, { method: "PUT" });

export const batchDelete = (ids: string[], workspaceId: string) =>
  apiRequest<{ ok: true }>(`/api/files/batch-delete`, { method: "POST", body: { workspace_id: workspaceId, file_ids: ids } });

/** `name` may be a path - the route splits it and creates the missing segments. */
export const createFolder = (workspaceId: string, parentId: string | null, name: string) => {
  const problem = validateFolderPath(name);
  if (problem) reject(problem);
  return apiRequest<{ ok: true }>(`/api/folders`, { method: "POST", body: { workspace_id: workspaceId, parent_id: parentId, name } });
};

export const renameFolder = (id: string, name: string) => {
  const problem = validateFolderName(name);
  if (problem) reject(problem);
  return apiRequest<{ ok: true }>(`/api/folders/${id}/rename`, { method: "PUT", body: { name } });
};

/**
 * One pass of the folder delete.
 *
 * The first call trashes the folder and answers a plain `{ ok: true }`. A
 * second call on an already-trashed folder is the permanent purge, which is
 * BOUNDED: it answers 202 `{ complete: false, remaining, files_affected }`
 * when its round-trip budget ran out. Callers must not read that as "deleted" -
 * see files/folderPurge.ts, which loops this until it reports complete.
 */
export const deleteFolder = (id: string) =>
  apiRequest<PurgeResponse>(`/api/folders/${id}`, { method: "DELETE" });

/** null = move to the workspace root. The server rejects moving a folder into itself. */
export const moveFolder = (id: string, parentId: string | null) =>
  apiRequest<{ ok: true }>(`/api/folders/${id}/move`, { method: "PUT", body: { parent_id: parentId } });

export type LockMode = "none" | "view_only" | "full_lock";

/** `password` is only meaningful for full_lock; "none" clears the lock. */
export const setFolderLock = (id: string, lockMode: LockMode, password?: string) =>
  apiRequest<{ ok: true }>(`/api/folders/${id}/lock`, {
    method: "POST",
    body: password ? { lock_mode: lockMode, password } : { lock_mode: lockMode },
  });

export async function unlockFolder(id: string, password: string): Promise<string> {
  const res = await apiRequest<{ ok: true; unlock_token: string }>(`/api/folders/${id}/unlock`, {
    method: "POST",
    body: { password },
  });
  return res.unlock_token;
}

/** File equivalent of setFolderLock. Same contract: password only for full_lock. */
export const setFileLock = (id: string, lockMode: LockMode, password?: string) =>
  apiRequest<{ ok: true }>(`/api/files/${id}/lock`, {
    method: "POST",
    body: password ? { lock_mode: lockMode, password } : { lock_mode: lockMode },
  });

export type HiddenMode = "none" | "everyone" | "users" | "roles";

/**
 * File equivalent of setFolderHidden, minus `targets`.
 *
 * The server accepts targets for the users/roles modes, but mobile has no
 * member or role picker so it only ever sends "none" or "everyone" - see
 * isHiddenModeSettable in ./protection. Omitting the parameter here makes that
 * a type-level guarantee rather than a convention someone can break later.
 */
export const setFileHidden = (id: string, hiddenMode: "none" | "everyone") =>
  apiRequest<{ ok: true }>(`/api/files/${id}/hide`, {
    method: "POST",
    body: { hidden_mode: hiddenMode },
  });

/** `targets` are user or role ids, required by the server for the users/roles modes. */
export const setFolderHidden = (id: string, hiddenMode: HiddenMode, targets?: string[]) =>
  apiRequest<{ ok: true }>(`/api/folders/${id}/hide`, {
    method: "POST",
    body: targets?.length ? { hidden_mode: hiddenMode, targets } : { hidden_mode: hiddenMode },
  });

export const addFavourite = (workspaceId: string, target: { fileId?: string; folderId?: string }) =>
  apiRequest<{ ok: true; id: string }>(`/api/favourites`, {
    method: "POST",
    body: { workspace_id: workspaceId, ...(target.fileId ? { file_id: target.fileId } : { folder_id: target.folderId }) },
  });

export const removeFavourite = (workspaceId: string, target: { fileId?: string; folderId?: string }) => {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  if (target.fileId) qs.set("file_id", target.fileId);
  else if (target.folderId) qs.set("folder_id", target.folderId);
  return apiRequest<{ ok: true }>(`/api/favourites?${qs.toString()}`, { method: "DELETE" });
};

export const restoreVersion = (id: string, versionNumber: number) =>
  apiRequest<{ ok: true }>(`/api/files/${id}/versions/restore`, { method: "POST", body: { version_number: versionNumber } });

export async function unlockFile(id: string, password: string): Promise<string> {
  const res = await apiRequest<{ ok: true; unlock_token: string }>(`/api/files/${id}/unlock`, { method: "POST", body: { password } });
  return res.unlock_token;
}
