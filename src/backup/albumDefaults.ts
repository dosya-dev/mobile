import { Platform } from "react-native";
import { listBackupAlbums } from "./scanner";
import { useBackupSettings } from "./settings";

/**
 * Bucket names that mean "the camera roll". OEM naming varies wildly, so a miss
 * falls back to scanning everything rather than guessing wrong - see below.
 */
const CAMERA_NAMES = ["camera", "dcim"];

/**
 * Resolves platform album defaults once per install.
 *
 * Camera bucket ids are not knowable at hydrate time: they need media
 * permission and an album query. So the defaults resolve lazily, the first time
 * either the folder picker opens or a backup runs.
 *
 * Android is where this matters. MediaStore exposes every image and video any
 * app ever wrote to shared storage - WhatsApp media, screenshots, Telegram
 * caches, downloads - and the camera roll is a minority of it. A fresh install
 * gets the camera buckets and nothing else.
 *
 * iOS is a no-op beyond the flag: albums there overlap, an asset can belong to
 * none at all, and app media never lands in Photos.
 *
 * Upgrades are also a no-op. An install that predates filters keeps backing up
 * everything - a backup app must never silently narrow its own scope.
 */
export async function ensureAlbumDefaults(): Promise<void> {
  const { settings, update, updateFilters } = useBackupSettings.getState();
  if (settings.albumDefaultsApplied) return;

  // filtersMigrated === false means this install predates filters (see
  // settings.hydrate) - leave it covering everything and let the one-time card
  // on the Backup tab invite the user to choose.
  if (Platform.OS !== "android" || !settings.filtersMigrated) {
    await update({ albumDefaultsApplied: true });
    return;
  }

  const albums = await listBackupAlbums();
  const camera = albums.filter((a) =>
    CAMERA_NAMES.some((n) => a.title.toLowerCase().includes(n)),
  );

  if (camera.length === 0) {
    // Nothing recognisable. Fail open - scan everything and prompt - rather
    // than pick an arbitrary bucket and quietly stop protecting the rest.
    await update({ albumDefaultsApplied: true, filtersMigrated: false });
    return;
  }

  await updateFilters({ albumMode: "include", albumIds: camera.map((a) => a.id) });
  await update({ albumDefaultsApplied: true });
}
