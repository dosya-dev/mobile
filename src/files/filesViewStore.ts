import { create } from "zustand";
import type { MessageKey } from "@/i18n/keys";
import type { IconName } from "@/ui/Icon";
import type { FileFilter } from "./types";

/**
 * The view the Files root shows (All, Documents, ...). It lives here, not in
 * FileBrowser's state, so the left menu can set it. In memory only: the old chip
 * row reset on restart too. Folders ignore it and always show `all`.
 */
export const useFilesView = create<{ view: FileFilter; setView: (v: FileFilter) => void }>((set) => ({
  view: "all",
  setView: (view) => set({ view }),
}));

/** The views in the web sidebar's order. Personas is a destination, not a view. */
export const FILES_VIEWS: readonly { key: FileFilter; label: MessageKey; icon: IconName }[] = [
  { key: "all", label: "common.label.all", icon: "folder-outline" },
  { key: "documents", label: "common.label.documents", icon: "document-text-outline" },
  { key: "videos", label: "common.label.videos", icon: "videocam-outline" },
  { key: "images", label: "common.label.images", icon: "image-outline" },
  { key: "hidden", label: "files.label.hidden", icon: "eye-off-outline" },
];
