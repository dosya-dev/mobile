import type { DownloadTask } from "./byteStore";
import { useDownloadStore } from "./downloadStore";
import { clearTransferNotification } from "./transferNotice";

/**
 * The live native download tasks, so a transfer can be stopped from anywhere.
 *
 * A module-level registry rather than a ref inside the viewer, because the
 * whole point of keying progress by file id is that the transfer outlives the
 * screen that started it: the dock and the file list both show it, and a Cancel
 * in either has to reach the real download rather than only hiding the row that
 * reports it.
 *
 * Deliberately not in the Zustand store. A native task object is not state -
 * nothing renders from it, and putting a non-serialisable handle in the store
 * would invite it into a persist layer later.
 */
const tasks = new Map<string, DownloadTask>();

export function registerTask(fileId: string, task: DownloadTask): void {
  tasks.set(fileId, task);
}

export function forgetTask(fileId: string): void {
  tasks.delete(fileId);
}

/**
 * Stop a transfer and take it off screen.
 *
 * The row is cleared whatever the native side does. The entry outlives the
 * task - a failed transfer has no task left but still has a row the user may
 * want gone - and a `cancelAsync` that rejects because the download is already
 * finished must not strand a row that can never be dismissed.
 */
export async function cancelDownload(fileId: string): Promise<void> {
  const task = tasks.get(fileId);
  tasks.delete(fileId);
  if (task) await task.cancelAsync().catch(() => {});
  useDownloadStore.getState().clear(fileId);
  await clearTransferNotification(fileId).catch(() => {});
}
