import type { FileItem } from "./types";

/**
 * Where tapping a file row or card goes: the viewer, for every type.
 *
 * Books used to deep-open straight into the reader, and playable audio was
 * intercepted before navigation and sent to the player. Both skipped the
 * viewer entirely, which meant two of its stages - the book cover with its
 * reading progress, and the audio hero with its artwork - could not be reached
 * by tapping anything.
 *
 * Neither shortcut is lost, they are just one tap further on and now visible:
 * the viewer offers "Continue reading" for a book and "Play" for a track, and
 * the file list keeps its "Play all" control for queueing a whole folder.
 */
export function fileOpenPath(file: Pick<FileItem, "id" | "mime_type" | "extension" | "lock_mode">): string {
  return `/file/${file.id}`;
}
