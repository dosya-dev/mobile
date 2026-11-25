import * as FileSystem from "expo-file-system/legacy";

/**
 * Delete every cached byte the app wrote on the signed-out account's behalf.
 *
 * The cache directory holds real file content, not just derivatives: books the
 * reader downloaded, extracted audio artwork, files staged for upload, backup
 * multipart chunks, and expo-image's own on-disk store. Signing out cleared the
 * tokens and left all of it in place, so another account's photos and documents
 * stayed readable on the device afterwards.
 *
 * Everything in this directory is by definition reconstructible, so the whole
 * contents go rather than a curated list - a curated list silently rots the
 * moment someone adds a new cache subdirectory. Entries are removed one at a
 * time and failures are swallowed: a single locked file must not abort the rest
 * of the wipe, or the sign-out.
 *
 * `keep` is the one exception, and it exists because one thing in here is NOT
 * reconstructible: a file staged for upload. A share from another app is only
 * readable under a grant that died with the sending task, and the picker's copy
 * is what the queue points at - so for a retryable upload the staged copy IS
 * the file. Sign-out passes nothing (the queue goes with the account); the
 * Settings "Clear" button passes the uris its persisted queue can still retry.
 */
export async function clearCachedFileBytes(keep: ReadonlySet<string> = new Set()): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;
  await clearDirectory(dir, keep);
}

/**
 * Delete everything in one directory except what `keep` names.
 *
 * A directory that CONTAINS something kept is descended into rather than
 * deleted - expo-document-picker stages a picked file in a subdirectory of the
 * cache (copyToCacheDirectory), so matching top-level names alone still took
 * the file out from under a retryable upload, directory and all.
 *
 * With an empty keep set (sign-out) nothing can be nested-kept, so this stays
 * the single flat pass it always was.
 */
async function clearDirectory(dir: string, keep: ReadonlySet<string>): Promise<void> {
  const entries = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const path = `${dir}${name}`;
    if (keep.has(path)) continue;
    const holdsKept = [...keep].some((k) => k.startsWith(`${path}/`));
    if (!holdsKept) {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      continue;
    }
    await clearDirectory(`${path}/`, keep);
  }
}
