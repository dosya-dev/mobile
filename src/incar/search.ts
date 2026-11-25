import { search } from "@/files/api";
import { fileKind } from "@/files/format";
import type { FileItem, FolderItem } from "@/files/types";

export interface AudioSearchResults {
  folders: FolderItem[];
  files: FileItem[];
}

/** Voice search is the only search path in-car (no CPSearchTemplate under the carplay-audio entitlement) — this backs the Siri handler in Task 7. */
export async function searchAudio(workspaceId: string, query: string): Promise<AudioSearchResults> {
  const results = await search(workspaceId, query);
  return {
    folders: results.folders,
    files: results.files.filter((f: FileItem) => fileKind(f.mime_type, f.extension) === "audio"),
  };
}
