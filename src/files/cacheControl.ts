import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import { clearCachedFileBytes } from "./fileCache";
import { sweepTransient } from "./byteStore";
import { clearLivePhotoTemp } from "@/backup/livePhoto";
// Value import, and deliberately this one: `@/vault/cache` imports
// expo-file-system and NOTHING else (its only e2ee import is `import type`,
// which is erased), so reaching it from the boot path does not pull the
// e2ee bundle in behind it. The store and the engine stay out of reach.
import { wipeVaultCache } from "@/vault/cache";

/**
 * What the app keeps on disk on the user's behalf, and how to let it go.
 *
 * Until now the only way to reclaim the cache directory was to sign out. It
 * holds every byte the viewer fetched (the byte store), expo-image's decoded
 * thumbnails, extracted Live Photo videos, staged uploads and view-only
 * downloads - on a phone that is short of space, easily gigabytes with no
 * control anywhere in the app. Settings now shows the number and offers the
 * button; this is what sits behind both.
 *
 * Everything in the cache directory is reconstructible from the server or the
 * photo library, so clearing it can only cost time, never data.
 */

/**
 * Total bytes under the cache directory, recursing into subdirectories.
 * Resolves 0 rather than rejecting: an unreadable entry is skipped, an
 * unreadable directory is an empty one. Settings must render either way.
 */
export async function getCacheSizeBytes(): Promise<number> {
  const root = FileSystem.cacheDirectory;
  if (!root) return 0;
  return sizeOfDirectory(root);
}

async function sizeOfDirectory(dir: string): Promise<number> {
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    const path = `${dir}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info || !info.exists) continue;
      if (info.isDirectory) total += await sizeOfDirectory(`${path}/`);
      else if (typeof info.size === "number") total += info.size;
    } catch {
      /* one unreadable entry must not hide the rest */
    }
  }
  return total;
}

/**
 * Drop every cache the app keeps. Each step is isolated, and the order matters:
 * the image library's own index first (Glide keeps an in-memory map of its
 * on-disk store and would otherwise serve entries that are gone), then the two
 * temp areas by name, then a sweep of the cache root that takes whatever is
 * left - the byte store, its index, and any loose file.
 *
 * `keep` names staged uploads that must survive it. A file shared in from
 * another app is not reconstructible - the sending app's grant is long gone -
 * so the copy in the cache is the only one there is, and the persisted upload
 * queue still points at it. The Settings screen also refuses outright while a
 * transfer is actually running, rather than pulling a file out from under it.
 */
export async function clearCaches(opts: { keep?: ReadonlySet<string> } = {}): Promise<void> {
  const keep = opts.keep ?? new Set<string>();
  const steps: Array<() => void | Promise<unknown>> = [
    () => ExpoImage.clearMemoryCache(),
    () => ExpoImage.clearDiskCache(),
    () => clearLivePhotoTemp(),
    () => sweepTransient(),
    () => wipeVaultCache(),
    () => clearCachedFileBytes(keep),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      /* best-effort - keep clearing */
    }
  }
}

/**
 * Launch-time sweep of caches that must not outlive a session: the transient
 * area holds bytes of view-only and locked files, which are fetched for one
 * viewing and are not meant to sit on disk afterwards; the Vault cache holds
 * DECRYPTED Vault files, and the Vault is always locked at boot - so anything
 * still there is plaintext a crash, a force-quit or an OS kill left behind,
 * with nothing in the app pointing at it any more. Never rejects, and one
 * failing sweep never skips the other.
 */
export async function sweepSessionCaches(): Promise<void> {
  for (const sweep of [sweepTransient, wipeVaultCache]) {
    try {
      await sweep();
    } catch {
      /* nothing to sweep, or not deletable */
    }
  }
}
