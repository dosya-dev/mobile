import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as FileSystem from "expo-file-system/legacy";
import { parseMotionPhotoOffset, base64ToBytes, MOTION_PHOTO_HEADER_BYTES } from "./motionPhoto";

interface DosyaMediaExtrasModule {
  /** File URL of the paired video, or null when the asset is not a Live Photo. */
  livePhotoVideoUri(localIdentifier: string): Promise<string | null>;
  /** Android: copy the last `tailBytes` of the file at `sourceUri` to `targetPath`. */
  copyTail(sourceUri: string, tailBytes: number, targetPath: string): Promise<boolean>;
}

export interface LivePhotoVideo {
  uri: string;
  size: number;
  name: string;
}

/**
 * The paired video's ledger key.
 *
 * It gets its own row rather than riding along with the still, so it dedupes,
 * resumes and reports failure exactly like any other asset. Without this it
 * would be re-extracted and re-uploaded on every single run.
 */
export function livePhotoLedgerId(localId: string): string {
  return `${localId}#video`;
}

/** Whether a ledger key names a Live Photo's paired video rather than an asset. */
export function isLivePhotoLedgerId(ledgerId: string): boolean {
  return ledgerId.endsWith("#video");
}

/**
 * Where the native module writes extracted videos: `<caches>/dosya-live-photos/`
 * (see modules/dosya-media-extras). Every file in it is a temp copy of bytes
 * the Photos library still holds, so the whole directory is disposable.
 */
export const LIVE_PHOTO_TEMP_DIR = `${FileSystem.cacheDirectory ?? ""}dosya-live-photos/`;

/**
 * Delete one extracted video once its upload has been recorded. Best-effort:
 * the file is cache, and a retry re-extracts it rather than needing it.
 */
export async function discardLivePhotoTemp(uri: string): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* already gone, or not deletable - the cache sweep picks it up */
  }
}

/** Remove every extracted Live Photo video (cache control, sign-out). */
export async function clearLivePhotoTemp(): Promise<void> {
  try {
    await FileSystem.deleteAsync(LIVE_PHOTO_TEMP_DIR, { idempotent: true });
  } catch {
    /* nothing extracted yet, or not deletable */
  }
}

export interface PairedVideoAsset {
  /** PHAsset local identifier (iOS). */
  id?: string | null;
  /** Readable file URI of the still (Android needs it; iOS ignores it). */
  uri?: string;
  filename: string;
}

/**
 * Extracts the motion half of a Live Photo.
 *
 * expo-media-library only ever hands back the still, so before this the moving
 * part of every Live Photo was silently dropped from the backup. The paired
 * video lives in a separate PHAssetResource, which needs native code.
 *
 * Returns null for anything that is not a Live Photo, off iOS, without the
 * native module, or on any failure - losing the motion must never cost the user
 * the still.
 */
export async function resolvePairedVideo(asset: PairedVideoAsset): Promise<LivePhotoVideo | null> {
  if (Platform.OS === "ios") return resolveIos(asset);
  if (Platform.OS === "android") return resolveAndroid(asset);
  return null;
}

async function resolveIos(asset: PairedVideoAsset): Promise<LivePhotoVideo | null> {
  if (!asset.id) return null;
  const native = requireOptionalNativeModule<DosyaMediaExtrasModule>("DosyaMediaExtras");
  if (!native) return null;
  try {
    const uri = await native.livePhotoVideoUri(asset.id);
    if (!uri) return null;
    const stat = await FileSystem.getInfoAsync(uri, { size: true } as never);
    const info = stat as { exists?: boolean; size?: number };
    if (!info.exists || !info.size) return null;
    return { uri, size: info.size, name: siblingName(asset.filename, "MOV") };
  } catch {
    return null;
  }
}

/**
 * Android has no PHAssetResource equivalent: the Motion Photo's video is
 * simply appended to the JPEG. This reads the header, parses the XMP offset
 * (see ./motionPhoto), and asks the native module to stream just the tail
 * bytes into a cache file - the JS side never holds a multi-megabyte base64
 * string of the whole photo.
 */
async function resolveAndroid(asset: PairedVideoAsset): Promise<LivePhotoVideo | null> {
  if (!asset.uri) return null;
  const native = requireOptionalNativeModule<DosyaMediaExtrasModule>("DosyaMediaExtras");
  if (!native) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64", position: 0, length: MOTION_PHOTO_HEADER_BYTES } as never);
    const tail = parseMotionPhotoOffset(base64ToBytes(b64));
    if (!tail) return null;
    const still = (await FileSystem.getInfoAsync(asset.uri, { size: true } as never)) as { exists?: boolean; size?: number };
    if (!still.exists || !still.size || tail >= still.size) return null;
    const safe = asset.uri.replace(/[^A-Za-z0-9]+/g, "_").slice(-80);
    const target = `${LIVE_PHOTO_TEMP_DIR}${safe}.mp4`;
    await FileSystem.makeDirectoryAsync(LIVE_PHOTO_TEMP_DIR, { intermediates: true }).catch(() => {});
    const ok = await native.copyTail(asset.uri, tail, target.replace(/^file:\/\//, ""));
    // A copyTail that fails partway has already created the target and written
    // whatever it got through. Returning null without removing it left a
    // truncated MP4 in the cache that nothing would ever claim - the ledger row
    // for the twin stays absent, so the retry writes to the same path and the
    // cache sweeper is the only thing that would ever notice.
    if (!ok) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      return null;
    }
    const info = (await FileSystem.getInfoAsync(target, { size: true } as never)) as { exists?: boolean; size?: number };
    if (!info.exists || !info.size) {
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      return null;
    }
    return { uri: target, size: info.size, name: siblingName(asset.filename, "MP4") };
  } catch {
    return null;
  }
}

/** IMG_1.HEIC -> IMG_1.MOV (iOS) or IMG_1.MP4 (Android), so the pair sorts together. */
export function siblingName(stillFilename: string, ext: "MOV" | "MP4"): string {
  const dot = stillFilename.lastIndexOf(".");
  const base = dot > 0 ? stillFilename.slice(0, dot) : stillFilename;
  return `${base}.${ext}`;
}
