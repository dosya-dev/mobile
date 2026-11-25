import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { useBackupSettings } from "./settings";

// Deleting per asset inside the upload loop meant one OS confirmation dialog
// per photo - back up 500 photos and the user taps through 500 prompts. The
// queue collapses a whole run into a single prompt at the end of it.
//
// A Set, not an array: the large-file loop and the completion subscription can
// both settle the same asset in edge cases, and offering a duplicate id to the
// OS is a needless way to make the prompt wrong.
let queued = new Set<string>();

/**
 * The queue is mirrored to disk. It used to be memory only, which made it
 * inert for anything settled by the background transport: iOS finishes those
 * uploads while the app is not running, the relaunch that settles them lives
 * for seconds and never reaches a flush, and the ids died with that process.
 * The originals then stayed on the phone for good, with the setting on and
 * the photos safely backed up.
 *
 * The file is the source of truth; memory is the working copy. It is merged
 * in lazily (on the first queue or flush of a process) rather than at launch,
 * so nothing at startup has to know this module exists. Every write is
 * best-effort: a device with no document directory (tests, odd sandboxes)
 * simply keeps the old memory-only behaviour.
 */
export const DELETE_QUEUE_FILE = `${FileSystem.documentDirectory ?? ""}delete-after-backup.json`;

let loaded: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      if (!FileSystem.documentDirectory) return;
      try {
        const info = await FileSystem.getInfoAsync(DELETE_QUEUE_FILE);
        if (!info.exists) return;
        const ids: unknown = JSON.parse(await FileSystem.readAsStringAsync(DELETE_QUEUE_FILE));
        if (!Array.isArray(ids)) return;
        for (const id of ids) if (typeof id === "string" && id) queued.add(id);
      } catch {
        // Unreadable or corrupt: start from what memory has. The next write
        // replaces the file.
      }
    })();
  }
  return loaded;
}

/** Serialised so two quick queues cannot interleave their writes. */
function persist(): Promise<void> {
  writes = writes
    .then(async () => {
      if (!FileSystem.documentDirectory) return;
      await FileSystem.writeAsStringAsync(DELETE_QUEUE_FILE, JSON.stringify([...queued]));
    })
    .catch(() => {});
  return writes;
}

/** Records an asset for deletion at the end of the run. No-op when the setting
 * is off, so callers never have to check it. */
export function queueDeleteAfterBackup(localId: string): void {
  if (!useBackupSettings.getState().settings.deleteAfterBackup) return;
  queued.add(localId);
  void load().then(persist);
}

/**
 * Issues one batched delete for everything the run backed up. Returns how many
 * originals were actually removed.
 *
 * `deleteAssetsAsync` raises the OS confirmation dialog on both platforms. A
 * declined or failed deletion is non-fatal and returns 0 - the files are safely
 * backed up either way, and there is no in-app restore, so failing closed is
 * the right direction.
 */
export async function flushDeleteAfterBackup(): Promise<number> {
  await load();
  const ids = [...queued];
  queued = new Set();
  // Cleared on disk before the prompt, not after: if the user declines, the
  // ids must not come back on the next run and ask again, and if the app dies
  // mid-prompt the same holds. Failing closed, as below.
  await persist();
  if (ids.length === 0) return 0;
  try {
    await MediaLibrary.deleteAssetsAsync(ids);
  } catch {
    // User declined the OS prompt, or the assets are already gone.
    return 0;
  }
  return ids.length;
}

/** Drops anything pending without deleting - used when a run is cancelled, so
 * a later run's flush doesn't delete originals from a run the user stopped. */
export function clearDeleteQueue(): void {
  queued = new Set();
  // Whatever the file held is dropped too, without merging it first: the
  // user's stop applies to everything pending, this process's or an earlier one's.
  loaded = Promise.resolve();
  void persist();
}

/** Test seam: forget the in-memory copy and the "already merged" mark, as a
 * fresh process would, without touching the file. */
export function __resetDeleteQueueMemoryForTests(): void {
  queued = new Set();
  loaded = null;
  writes = Promise.resolve();
}
