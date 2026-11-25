import type { FileItem } from "./types";

/**
 * Whether a file's bytes may be written to the device's disk cache.
 *
 * `view_only` means the owner turned downloads OFF. Streaming those bytes to
 * render a preview is the point of the mode, but PERSISTING them is not: a
 * disk-cached copy outlives the session, survives the app being closed, and is
 * exactly the "saved copy" the mode exists to prevent. `full_lock` is the same
 * argument with a password in front of it - the bytes should leave with the
 * unlock token, not sit in a cache directory afterwards.
 *
 * So restricted files render from memory and are re-fetched next time. That is
 * slower on purpose. It applies to bytes the app caches on the user's behalf,
 * NOT to an explicit Save - a download the user asked for is theirs, and the
 * server refuses that for view_only anyway.
 */
export function mayPersistBytes(file: Pick<FileItem, "lock_mode">): boolean {
  return file.lock_mode === "none";
}

/** The expo-image cache policy for a file, given its lock mode. */
export function imageCachePolicy(file: Pick<FileItem, "lock_mode">): "memory-disk" | "memory" {
  return mayPersistBytes(file) ? "memory-disk" : "memory";
}
