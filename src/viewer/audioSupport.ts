import { normalizeExt } from "@/files/format";

/**
 * Whether this phone's OWN decoder can play this audio file.
 *
 * Same shape and same reasoning as videoSupport.ts: a denylist of formats
 * AVPlayer has no decoder for, not an allowlist of ones it does. Before this,
 * an .ogg on iOS classified as audio, showed its artwork stage, offered Play -
 * and produced silence, which is the audio version of the MKV black rectangle.
 *
 * Android never consults this: ExoPlayer decodes all of these.
 */

/** Formats AVPlayer cannot decode. libVLC (modules/dosya-vlc-player) can. */
const IOS_UNPLAYABLE_AUDIO = new Set(["ogg", "oga", "opus", "wma", "mka"]);

/** Mime subtypes that identify the same formats when the filename says nothing. */
const UNPLAYABLE_SUBTYPES: Record<string, string> = {
  ogg: "ogg",
  opus: "opus",
  "ms-wma": "wma",
  matroska: "mka",
};

export function audioPlayable(
  mime: string,
  ext: string | null,
  os: "ios" | "android" | string,
): boolean {
  if (os !== "ios") return true;
  const e = normalizeExt(ext);
  if (e) return !IOS_UNPLAYABLE_AUDIO.has(e);
  const sub = (mime || "").toLowerCase().split("/")[1]?.replace(/^x-/, "") ?? "";
  return !IOS_UNPLAYABLE_AUDIO.has(UNPLAYABLE_SUBTYPES[sub] ?? sub);
}
