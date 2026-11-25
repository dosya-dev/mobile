import { create } from "zustand";
import { t as translate } from "@/lib/i18n";

/**
 * Where an upload started from the orbit button would land.
 *
 * The `+` used to live inside `FileBrowser`, so the folder it uploaded into
 * was simply the folder on screen. The orbit button lives in the tab bar,
 * which means it is also on screen from Backup and Settings, where there is no
 * folder to infer. Rather than disable it there - the button is still the only
 * route to upload - the browser publishes its destination here as it goes, and
 * the sheet NAMES that destination before offering the sources. Uploading into
 * a folder you are not looking at is fine as long as you are told which one.
 *
 * Deliberately not persisted. A destination that outlives the process would
 * name a folder the user has not opened this session, and could name one they
 * no longer have access to.
 */
export interface UploadTarget {
  workspaceId: string | null;
  folderId: string | null;
  /** Null at a workspace root, where the workspace's own name is the label. */
  folderName: string | null;
  workspaceName: string | null;
  /** False for a viewer, who holds neither upload_files nor access_upload. */
  canAdd: boolean;
  /** create_folders. Gates the sheet's New folder row. */
  canCreateFolder: boolean;
}

interface UploadTargetState extends UploadTarget {
  setTarget: (t: UploadTarget) => void;
}

const EMPTY: UploadTarget = {
  workspaceId: null,
  folderId: null,
  folderName: null,
  workspaceName: null,
  canAdd: false,
  canCreateFolder: false,
};

export const useUploadTarget = create<UploadTargetState>((set) => ({
  ...EMPTY,
  setTarget: (t) => set(t),
}));

/** What to print above the upload sources, so the destination is never a guess. */
export function targetLabel(t: UploadTarget): string {
  if (!t.workspaceId) return translate("common.label.noWorkspace");
  if (t.folderName) return t.folderName;
  return t.workspaceName ?? translate("common.label.workspaceRoot");
}
