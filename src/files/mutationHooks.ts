import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/ui/toast";
import * as m from "./mutations";
import { purgeTrashedFolder } from "./folderPurge";
import type { FileItem } from "./types";
import { t } from "@/lib/i18n";

export interface RemoveWithTwinOutcome { twinDeleted: boolean | null }

/** Delete a still and, when asked, its Live Photo twin. The still's failure throws; the twin's is reported, so the caller still refreshes and leaves the deleted still. */
export async function removeWithTwin(f: { id: string; live_video_id?: string | null }, withTwin: boolean): Promise<RemoveWithTwinOutcome> {
  await m.deleteFile(f.id);
  if (!withTwin || !f.live_video_id) return { twinDeleted: null };
  try { await m.deleteFile(f.live_video_id); return { twinDeleted: true }; }
  catch { return { twinDeleted: false }; }
}

export function useFileMutations() {
  const qc = useQueryClient();
  // Every file mutation reaches the Library view too (same rows, grouped by
  // month), so the library cache is invalidated alongside the listing. Both
  // are awaited: onSuccess's return value is what makes mutateAsync settle
  // only after the caches are marked stale.
  const invalidateFiles = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["files"] }), qc.invalidateQueries({ queryKey: ["library"] })]);
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : t("common.error.somethingWentWrong"), "error");

  return {
    rename: useMutation({ mutationFn: (v: { id: string; name: string }) => m.renameFile(v.id, v.name), onSuccess: invalidateFiles, onError }),
    move: useMutation({ mutationFn: (v: { id: string; folderId: string | null }) => m.moveFile(v.id, v.folderId), onSuccess: invalidateFiles, onError }),
    copy: useMutation({ mutationFn: (v: { id: string; folderId?: string }) => m.copyFile(v.id, v.folderId), onSuccess: invalidateFiles, onError }),
    remove: useMutation({ mutationFn: (id: string) => m.deleteFile(id), onSuccess: invalidateFiles, onError }),
    removeWithTwin: useMutation({ mutationFn: (v: { file: FileItem; withTwin: boolean }) => removeWithTwin(v.file, v.withTwin), onSuccess: invalidateFiles, onError }),
    restore: useMutation({ mutationFn: (id: string) => m.restoreFile(id), onSuccess: invalidateFiles, onError }),
    favourite: useMutation({ mutationFn: (v: { workspaceId: string; fileId?: string; folderId?: string }) => m.addFavourite(v.workspaceId, { fileId: v.fileId, folderId: v.folderId }), onSuccess: () => { invalidateFiles(); qc.invalidateQueries({ queryKey: ["favourites"] }); }, onError }),
    unfavourite: useMutation({ mutationFn: (v: { workspaceId: string; fileId?: string; folderId?: string }) => m.removeFavourite(v.workspaceId, { fileId: v.fileId, folderId: v.folderId }), onSuccess: () => { invalidateFiles(); qc.invalidateQueries({ queryKey: ["favourites"] }); }, onError }),
    createFolder: useMutation({ mutationFn: (v: { workspaceId: string; parentId: string | null; name: string }) => m.createFolder(v.workspaceId, v.parentId, v.name), onSuccess: invalidateFiles, onError }),
    renameFolder: useMutation({ mutationFn: (v: { id: string; name: string }) => m.renameFolder(v.id, v.name), onSuccess: invalidateFiles, onError }),
    // Looped, not fired once: the permanent purge of a trashed folder is
    // bounded server-side and answers 202 while work remains. The outcome is
    // handed to the caller so the toast can tell the truth about it.
    removeFolder: useMutation({
      mutationFn: (id: string) => purgeTrashedFolder(() => m.deleteFolder(id)),
      onSuccess: invalidateFiles,
      onError,
    }),
    moveFolder: useMutation({ mutationFn: (v: { id: string; parentId: string | null }) => m.moveFolder(v.id, v.parentId), onSuccess: invalidateFiles, onError }),
    restoreVersion: useMutation({ mutationFn: (v: { id: string; versionNumber: number }) => m.restoreVersion(v.id, v.versionNumber), onSuccess: (_r, v) => { invalidateFiles(); qc.invalidateQueries({ queryKey: ["file", v.id] }); }, onError }),
  };
}
