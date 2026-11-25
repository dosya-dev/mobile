import { fileKind, normalizeExt } from "@/files/format";
import { videoPlayable } from "@/viewer/videoSupport";

/**
 * What a TV can be handed, decided before anything is sent to it.
 *
 * A Chromecast fetches the file itself from a presigned URL, so two things
 * rule a file out before format even comes into it:
 *
 *  - view_only: the server refuses to presign it (download-gate.ts), and the
 *    /raw route it is viewed through needs our Bearer header, which a TV
 *    cannot send. Casting it would also hand the bytes to another device,
 *    which is the one thing the owner switched off.
 *  - full_lock without its unlock token: the stage is the password gate, so
 *    there is nothing on screen to cast yet.
 *
 * The format lists are ALLOWLISTS, unlike videoSupport's denylist. A file the
 * phone cannot play only costs a card explaining why; a file the TV cannot
 * play leaves a spinner on someone's living-room screen with nothing on the
 * phone saying why. The Default Media Receiver documents what it decodes
 * (developers.google.com/cast/docs/media), and this is that list.
 */

export type CastKind = "video" | "audio" | "image";

const VIDEO = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const AUDIO = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"]);
// No HEIC, TIFF, RAW or PSD: the receiver is a browser and shows what <img> shows.
const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

/** Content types for files whose stored mime is missing or generic. */
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

interface CastableFile {
  mime_type: string;
  extension: string | null;
  lock_mode: string;
}

/** The extension, or the mime subtype when the name has none. */
function formatKey(file: Pick<CastableFile, "mime_type" | "extension">): string {
  const e = normalizeExt(file.extension);
  if (e) return e;
  const sub = (file.mime_type || "").toLowerCase().split("/")[1]?.replace(/^x-/, "") ?? "";
  if (sub === "matroska") return "mkv";
  if (sub === "quicktime") return "mov";
  if (sub === "mpeg") return file.mime_type.toLowerCase().startsWith("audio/") ? "mp3" : "";
  return sub === "jpg" ? "jpeg" : sub;
}

/** Which kind of media this file is on a TV, or null when it is not one a TV can show. */
export function castKind(file: Pick<CastableFile, "mime_type" | "extension">): CastKind | null {
  const kind = fileKind(file.mime_type, file.extension);
  const key = formatKey(file);
  if (kind === "video" && VIDEO.has(key)) return "video";
  if (kind === "audio" && AUDIO.has(key)) return "audio";
  if (kind === "image" && IMAGE.has(key)) return "image";
  return null;
}

/** Whether this file's bytes may be handed to a TV at all, whatever the format. */
export function castAllowed(file: CastableFile, unlockToken: string | null): boolean {
  if (file.lock_mode === "view_only") return false;
  if (file.lock_mode === "full_lock" && !unlockToken) return false;
  return true;
}

export function canCast(file: CastableFile, unlockToken: string | null): boolean {
  return castAllowed(file, unlockToken) && castKind(file) !== null;
}

/** The content type the receiver is told, which picks its player. */
export function castContentType(file: Pick<CastableFile, "mime_type" | "extension">): string {
  const mime = (file.mime_type || "").toLowerCase();
  if (/^(video|audio|image)\/[\w.+-]+$/.test(mime)) return mime;
  return CONTENT_TYPES[formatKey(file)] ?? "application/octet-stream";
}

/**
 * Whether the AirPlay row belongs on this file (iOS only).
 *
 * AirPlay sends what AVPlayer is playing, so it covers the video stage and the
 * audio queue and nothing else: a photo needs Screen Mirroring from Control
 * Center, and a video only libVLC can open (MKV and friends on iOS) never
 * reaches AVPlayer at all. The lock rules match casting's, since an AirPlay
 * receiver is just as much someone else's screen.
 */
export function canAirPlay(file: CastableFile, unlockToken: string | null, os: string): boolean {
  if (os !== "ios" || !castAllowed(file, unlockToken)) return false;
  const kind = fileKind(file.mime_type, file.extension);
  if (kind === "audio") return true;
  return kind === "video" && videoPlayable(file.mime_type, file.extension, os);
}
