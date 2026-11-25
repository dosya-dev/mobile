import { Image as ExpoImage } from "expo-image";
import type { FolderItem } from "./types";

// The same three SVGs the web app serves from /public, copied into the bundle so a folder
// looks identical on both. Metro only bundles require()d assets with static paths, hence
// the three constants rather than building a path from a variable.
const EMPTY = require("../../assets/file-icons/folder-empty.svg");
const FULL = require("../../assets/file-icons/folder-full.svg");
const SYNCED = require("../../assets/sync.svg");

type IconInput = Pick<FolderItem, "file_count" | "is_synced">;

/**
 * Mirrors web's folderIconSrc(): a backup (synced) folder reads as synced whatever it
 * holds, otherwise the icon says whether the folder has anything in it. Keep the order -
 * synced wins over full, same as web.
 */
export function folderIconSource(folder: IconInput) {
  if (folder.is_synced) return SYNCED;
  return folder.file_count > 0 ? FULL : EMPTY;
}

/** `size` is the square edge in pt: 26 matches the list row, 44 the grid tile. */
export function FolderIcon({ folder, size, testID }: { folder: IconInput; size: number; testID?: string }) {
  return (
    <ExpoImage
      testID={testID}
      source={folderIconSource(folder)}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}
