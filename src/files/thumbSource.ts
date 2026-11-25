import { getAccessToken } from "@/auth/authStore";
import { fileRawUrl, fileThumbUrl } from "./fileUrl";
import { normalizeExt } from "./format";
import type { FileItem } from "./types";

/**
 * The ONE thumbnail size the server can answer cheaply for an ordinary photo.
 *
 * `/thumb` serves the camera's embedded EXIF preview - 5-30KB, cached in R2,
 * one hop - but only when the width is exactly this and the mime is exactly
 * image/jpeg (see apps/api src/lib/thumbs/embedded.ts, canUseEmbedded). At any
 * other width it 302s to /raw and hands back the multi-megabyte original.
 *
 * Keep this in step with EMBEDDED_SIZE on the server. A mismatch does not fail
 * loudly - it silently downgrades every list thumbnail to a full download.
 */
export const EMBEDDED_THUMB_SIZE = 128 as const;

export interface ThumbCandidate {
  uri: string;
  headers: Record<string, string>;
}

function isHeic(mime: string, ext: string | null): boolean {
  const m = (mime || "").toLowerCase();
  const e = normalizeExt(ext);
  return m === "image/heic" || m === "image/heif" || e === "heic" || e === "heif";
}

function isJpeg(mime: string, ext: string | null): boolean {
  const m = (mime || "").toLowerCase();
  const e = normalizeExt(ext);
  return m === "image/jpeg" || e === "jpg" || e === "jpeg";
}

function isPng(mime: string, ext: string | null): boolean {
  return (mime || "").toLowerCase() === "image/png" || normalizeExt(ext) === "png";
}

/**
 * URLs to try, in order, for a file's list or grid thumbnail.
 *
 * The list used to fetch `/raw` - the FULL ORIGINAL - for every image row,
 * because of a comment reasoning that `/thumb` always 302s for passthrough
 * formats and native loaders drop the Authorization header across a redirect.
 * That is true at every width except the embedded one, which is the only width
 * a list actually needs. The web client asks for w=128 and gets a few KB; the
 * app was pulling several MB per row for the same picture, which is why a
 * hundred photos took minutes on mobile and seconds in a browser.
 *
 * A list is a lot of pictures at once, so the ordering optimises for bytes:
 *   - JPEG: the embedded preview, then the original if this particular file
 *     carries no EXIF thumbnail (screenshots and re-encoded images often do
 *     not). Without that fallback those rows would 401 through the redirect
 *     and show a file icon.
 *   - HEIC: `/thumb` only. It is the one format the server truly decodes, and
 *     Android cannot render the original at all, so there is nothing to fall
 *     back to. The server answers from the file's own thumbnail item or its
 *     grid tiles (apps/api src/lib/thumbs/heic.ts), so a 24MP or 48MP phone
 *     photo gets a real thumbnail rather than the 302-to-original it used to
 *     get - which this loader could not follow, and was why those rows showed
 *     a file icon.
 *   - Everything else (PNG, WebP, GIF): `/raw`. No embedded-preview path
 *     exists for them server-side, so asking for `/thumb` would only buy a
 *     redirect that loses the auth header.
 */
export function thumbCandidates(
  file: Pick<FileItem, "id" | "mime_type" | "extension" | "current_version">,
  variant: "list" | "grid",
): ThumbCandidate[] {
  const token = getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const raw = { uri: fileRawUrl(file.id, file.current_version), headers };

  if (isHeic(file.mime_type, file.extension)) {
    // Grid tiles are big enough to justify the larger decoded derivative; the
    // server generates it either way, so the cost is bytes, not latency.
    const size = variant === "grid" ? 512 : EMBEDDED_THUMB_SIZE;
    return [{ uri: fileThumbUrl(file.id, size, file.current_version), headers }];
  }

  if (isPng(file.mime_type, file.extension)) {
    // The server decodes PNG to a small WebP now (apps/api thumbs/formats.ts).
    // Before that it had no cheap derivative at all, so a 40pt row pulled the
    // whole multi-megabyte original - the slowest surface in the app.
    // Grid keeps its own size: unlike the JPEG path this is a real resize, so
    // asking for a larger one costs bytes rather than losing the fast path.
    const size = variant === "grid" ? 512 : EMBEDDED_THUMB_SIZE;
    return [{ uri: fileThumbUrl(file.id, size, file.current_version), headers }, raw];
  }

  if (isJpeg(file.mime_type, file.extension)) {
    // A list row takes the embedded EXIF preview: no decode at all, a few KB.
    // A grid tile asks for a real 512 derivative instead of upscaling that
    // ~160px preview - the server decodes JPEG now, so the larger size is a
    // resize rather than a fall back to the whole original.
    const size = variant === "grid" ? 512 : EMBEDDED_THUMB_SIZE;
    return [{ uri: fileThumbUrl(file.id, size, file.current_version), headers }, raw];
  }

  return [raw];
}
