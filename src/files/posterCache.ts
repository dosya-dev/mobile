import * as VideoThumbnails from "expo-video-thumbnails";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "@/api";
import { getAccessToken } from "@/auth/authStore";
import { fileRawUrl } from "./fileUrl";
import type { FileItem } from "./types";

/**
 * Video posters: a still frame shown in place of a video in lists and grids.
 *
 * The server cannot pull a frame out of a video (a Worker has no ffmpeg), so
 * the app makes one and stores it - PUT /api/files/:id/poster - after which
 * /thumb serves it to every client. The order a card walks:
 *
 *   1. this device's own copy (made earlier, or by backup) - no network;
 *   2. the server's poster through /thumb - a few tens of KB;
 *   3. grab a frame here: the platform reads only the ranges of /raw it needs
 *      (the index and the first keyframe, not the whole video), shrink it,
 *      keep it, and hand it to the server so nobody has to do this again.
 */

/** Longest edge of a stored poster. A 2-up card on a phone is ~200pt wide. */
export const POSTER_EDGE = 640;
/** Past the black first frame most phone videos open on. */
const FRAME_AT_MS = 1000;
/** Each grab opens a video stream and decodes a keyframe; two at a time keeps a scroll smooth. */
const MAX_CONCURRENT_GRABS = 2;

type PosterFile = Pick<FileItem, "id" | "current_version">;

function versionOf(file: PosterFile): number {
  return file.current_version && file.current_version > 0 ? file.current_version : 1;
}

function posterDir(): string {
  return `${Paths.cache.uri.replace(/\/$/, "")}/video-posters`;
}

/** Where this device keeps a file version's poster. Ids are server-issued; still, never a raw path. */
export function localPosterPath(file: PosterFile): string {
  const id = file.id.replace(/[^\w-]/g, "_");
  return `${posterDir()}/${id}-v${versionOf(file)}.jpg`;
}

/** The poster this device already has, or null. Synchronous so a card can draw it on first render. */
export function cachedPoster(file: PosterFile): string | null {
  try {
    const f = new File(localPosterPath(file));
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/** Forget this device's copy - it failed to render, so the next ensurePoster makes a fresh one. */
export function dropCachedPoster(file: PosterFile): void {
  try {
    const f = new File(localPosterPath(file));
    if (f.exists) f.delete();
  } catch {
    // Nothing to drop.
  }
}

/**
 * Grab one frame of a video and shrink it to a poster-sized JPEG.
 *
 * `source` is a local file (backup) or the authenticated /raw URL. Returns the
 * temp uri of the shrunk JPEG, or null when the platform cannot decode the
 * video (an unsupported codec, a corrupt file).
 */
export async function grabPosterFrame(source: string, headers?: Record<string, string>): Promise<string | null> {
  let frame: VideoThumbnails.VideoThumbnailsResult | null = null;
  for (const time of [FRAME_AT_MS, 0]) {
    try {
      frame = await VideoThumbnails.getThumbnailAsync(source, { time, quality: 0.9, headers });
      break;
    } catch {
      // A clip shorter than a second has no frame at 1s; the second pass asks for the first.
    }
  }
  if (!frame) return null;

  try {
    const landscape = frame.width >= frame.height;
    const longest = Math.max(frame.width, frame.height);
    const ctx = ImageManipulator.manipulate(frame.uri);
    if (longest > POSTER_EDGE) ctx.resize(landscape ? { width: POSTER_EDGE } : { height: POSTER_EDGE });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return out.uri;
  } catch {
    return null;
  } finally {
    // The full-resolution frame is several MB for a 4K video; never keep it.
    FileSystem.deleteAsync(frame.uri, { idempotent: true }).catch(() => {});
  }
}

/** Move a freshly made poster into this device's cache. Returns its final uri. */
async function keepLocally(file: PosterFile, tempUri: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(posterDir(), { intermediates: true }).catch(() => {});
  const to = localPosterPath(file);
  await FileSystem.deleteAsync(to, { idempotent: true });
  await FileSystem.moveAsync({ from: tempUri, to });
  return to;
}

/**
 * Hand a poster to the server so every other client gets it from /thumb.
 *
 * Best effort and silent: a member without upload rights gets a 403, a newer
 * version a 409, and either way this device already shows its own copy. The
 * server keeps the first poster it gets, so a repeat is harmless.
 */
export async function storePoster(fileId: string, version: number | null, localUri: string): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  // Without a version the server pins the poster to the file's current one -
  // right for a video that has just finished uploading.
  const qs = version ? `?version=${version}` : "";
  try {
    const res = await FileSystem.uploadAsync(
      `${API_BASE_URL}/api/files/${encodeURIComponent(fileId)}/poster${qs}`,
      localUri,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
      },
    );
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

// ── one grab per file version, a few at a time ──

const inFlight = new Map<string, Promise<string | null>>();
/** Versions this session already gave up on, so a recycled card does not re-download them. */
const failed = new Set<string>();
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_GRABS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * This device's poster for a video, making it (and offering it to the server)
 * when there is none. Concurrent callers for the same version share one grab.
 */
export function ensurePoster(file: PosterFile): Promise<string | null> {
  const have = cachedPoster(file);
  if (have) return Promise.resolve(have);
  const key = localPosterPath(file);
  if (failed.has(key)) return Promise.resolve(null);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = withSlot(async () => {
    const token = getAccessToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const temp = await grabPosterFrame(fileRawUrl(file.id, versionOf(file)), headers);
    if (!temp) {
      failed.add(key);
      return null;
    }
    const uri = await keepLocally(file, temp);
    void storePoster(file.id, versionOf(file), uri);
    return uri;
  })
    .catch(() => {
      failed.add(key);
      return null;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/**
 * The upload hook (posterOnUpload.ts): the video is still on this phone, so
 * make the poster from the local file - no download at all - and store it.
 * The temp frame is not kept: the version a fresh upload landed on is the
 * server's to say, and a card fetches the stored poster through /thumb.
 */
export async function posterFromLocalVideo(fileId: string, localVideoUri: string): Promise<boolean> {
  const temp = await withSlot(() => grabPosterFrame(localVideoUri)).catch(() => null);
  if (!temp) return false;
  try {
    return await storePoster(fileId, null, temp);
  } finally {
    FileSystem.deleteAsync(temp, { idempotent: true }).catch(() => {});
  }
}

/** Test seam: forget the session's in-flight and failed sets. */
export function __resetPosterState(): void {
  inFlight.clear();
  failed.clear();
  running = 0;
  waiting.length = 0;
}
