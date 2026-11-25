import { t } from "@/lib/i18n";
import { normalizeExt } from "@/files/format";

/**
 * Whether this phone can actually decode this video.
 *
 * Extending the presign TTL fixes the reported failure - a 512MB video dying
 * five minutes in - but it does not fix a container the device has no demuxer
 * for. Without intervention those render as a black rectangle that never
 * starts, which is indistinguishable from a slow connection and is part of why
 * the bug arrived as "big videos don't play": the two failures looked
 * identical.
 *
 * "Unplayable" here means unplayable BY AVPLAYER. A build carrying
 * modules/dosya-vlc-player routes these to the libVLC stage instead of the
 * explanation card (see VideoStage), so this list is also the routing table
 * that decides which player a file gets.
 *
 * The list is deliberately a DENYLIST of things known not to work, not an
 * allowlist of things known to work. An unrecognised file is given the benefit
 * of the doubt and handed to the player, because refusing to try would turn a
 * file that plays perfectly well into one the app claims it cannot open.
 */

/** Containers AVPlayer has no demuxer for. ExoPlayer handles all of them. */
const IOS_UNPLAYABLE = new Set(["mkv", "webm", "avi", "wmv", "flv", "ogv", "mpg", "mpeg", "rmvb", "ts"]);

const NAMES: Record<string, string> = {
  mkv: "Matroska",
  webm: "WebM",
  avi: "AVI",
  wmv: "Windows Media",
  flv: "Flash Video",
  ogv: "Ogg",
  mpg: "MPEG",
  mpeg: "MPEG",
  rmvb: "RealMedia",
  // ts holds a placeholder: its name is a catalog message, produced in containerLabel.
  ts: "",
};

const nameOf = (key: string): string => (key === "ts" ? t("common.label.mpegTransportStream") : NAMES[key]);

/** To first FRAME, not first byte. Under this the player's own spinner is enough. */
export const BUFFER_TIMEOUT_MS = 15_000;

export function videoPlayable(
  mime: string,
  ext: string | null,
  os: "ios" | "android" | string,
): boolean {
  if (os !== "ios") return true;
  const e = normalizeExt(ext);
  if (e) return !IOS_UNPLAYABLE.has(e);
  // No usable extension: fall back to the mime subtype, which is where a
  // `video/x-matroska` with a stripped filename still says what it is.
  const sub = (mime || "").toLowerCase().split("/")[1]?.replace(/^x-/, "") ?? "";
  return !IOS_UNPLAYABLE.has(sub === "matroska" ? "mkv" : sub);
}

/** The format's name, or null when the format is not one we have a name for. */
export function containerName(mime: string, ext: string | null): string | null {
  const e = normalizeExt(ext);
  if (e && NAMES[e] !== undefined) return nameOf(e);
  if (e) return e.toUpperCase();
  const sub = (mime || "").toLowerCase().split("/")[1]?.replace(/^x-/, "") ?? "";
  const key = sub === "matroska" ? "mkv" : sub;
  return NAMES[key] !== undefined ? nameOf(key) : null;
}

/** The format's name, for the sentence that explains why it will not open. */
export function containerLabel(mime: string, ext: string | null): string {
  return containerName(mime, ext) ?? "this";
}
