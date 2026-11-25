import { useUploadStore } from "@/upload/store";
import { posterFromLocalVideo } from "./posterCache";

/**
 * Give every video this phone uploads - backup or a manual pick - a poster
 * while the file is still here to read, so no client ever has to download
 * part of it to make one.
 *
 * Watches the upload store for an item turning `done` with a server file id.
 * Idempotent: called at launch (_layout) and at the start of every backup run,
 * because a background run on Android is headless and never mounts the layout.
 */
let started = false;
const handled = new Set<string>();

export function startPosterOnUpload(): void {
  if (started) return;
  // Posters are a nicety: nothing here may break the backup run that calls it.
  try {
    subscribe();
    started = true;
  } catch {
    // Left unstarted; the next run tries again.
  }
}

function subscribe(): void {
  useUploadStore.subscribe((state, prev) => {
    // Progress ticks patch the store many times a second; only a changed
    // list can hold a newly finished item.
    if (state.items === prev.items) return;
    for (const item of state.items) {
      if (item.status !== "done" || !item.fileId || !item.mime.startsWith("video/")) continue;
      if (handled.has(item.fileId)) continue;
      handled.add(item.fileId);
      void posterFromLocalVideo(item.fileId, item.uri).catch(() => {});
    }
  });
}

/** Test seam. */
export function __resetPosterOnUpload(): void {
  started = false;
  handled.clear();
}
