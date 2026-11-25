import { listFiles } from "@/files/api";
import { fileKind } from "@/files/format";
import type { FileItem, FolderItem } from "@/files/types";

export interface BrowseLevel {
  folders: FolderItem[];
  audioFiles: FileItem[];
}

/**
 * One CarPlay list level: a folder's direct children, files filtered to
 * playable audio. Folders are shown regardless of what they contain — whether
 * a folder holds audio isn't knowable without a recursive scan, and CarPlay
 * pushes one level at a time just like this call does.
 */
export async function listBrowseLevel(workspaceId: string, folderId: string | null): Promise<BrowseLevel> {
  const page = await listFiles({ workspaceId, folderId, perPage: 100 });
  const audioFiles = page.files.filter(
    (f: FileItem) => fileKind(f.mime_type, f.extension) === "audio" && f.lock_mode === "none",
  );
  return { folders: page.folders, audioFiles };
}
