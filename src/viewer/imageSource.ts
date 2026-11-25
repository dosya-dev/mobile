import { getAccessToken } from "@/auth/authStore";
import { fileRawUrl, fileThumbUrl } from "@/files/fileUrl";
import type { FileDetail } from "@/files/types";

export interface ImageSource {
  uri: string;
  headers: Record<string, string>;
}

/** HEIC/HEIF is the one raster format the server actually decodes (see api thumbs/formats.ts). */
export function isHeic(mime: string, ext: string | null): boolean {
  const m = (mime || "").toLowerCase();
  const e = (ext || "").toLowerCase().replace(/^\./, "");
  return m === "image/heic" || m === "image/heif" || e === "heic" || e === "heif";
}

/**
 * Where the viewer reads an image from - and it is deliberately NOT the
 * presigned URL the rest of the stages use.
 *
 * A presigned URL carries a signature that changes on every call, so it is a
 * different cache key every time. Pointing the viewer at one meant expo-image
 * could never reuse what the file LIST had already downloaded (FileThumb loads
 * `/raw` with a bearer and `cachePolicy="disk"`), and could not even reuse its
 * own previous fetch of the same photo. Every open was a full re-download of
 * the original.
 *
 * The authenticated `/raw` URL is stable per file version, and is byte-for-byte
 * the URL FileThumb already cached - so a photo you have scrolled past in the
 * list opens from disk. That is the whole fix; keep this URL identical to
 * FileThumb's or the cache silently stops hitting.
 *
 * HEIC is the exception: `/thumb` genuinely decodes and downscales it to WebP
 * in one hop, so the viewer asks for the large derivative rather than an
 * original no native loader on Android can read.
 */
export function viewerImageSource(file: FileDetail, unlockToken?: string | null): ImageSource {
  const token = getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const ut = unlockToken ?? undefined;
  const uri = isHeic(file.mime_type, file.extension)
    ? fileThumbUrl(file.id, 1600, file.current_version, ut)
    : fileRawUrl(file.id, file.current_version, ut);
  return { uri, headers };
}

/**
 * The small derivative the LIST already downloaded, shown under the full image
 * while it loads. Because it is the same URL the list requested, it is already
 * on disk for anything scrolled past, so the photo appears instantly and
 * sharpens a moment later instead of opening on an empty stage.
 *
 * Only the two formats with a cheap server-side derivative have one to show:
 * a JPEG's embedded EXIF preview at w=128, and HEIC's decoded WebP. For PNG
 * and friends the list cached the same bytes the viewer wants, so there is
 * nothing smaller and nothing to wait for.
 */
export function viewerImagePlaceholder(file: FileDetail, unlockToken?: string | null): ImageSource | null {
  const heic = isHeic(file.mime_type, file.extension);
  const jpeg = /^image\/jpe?g$/.test((file.mime_type || "").toLowerCase())
    || /^\.?jpe?g$/i.test(file.extension || "");
  if (!heic && !jpeg) return null;

  const token = getAccessToken();
  return {
    // Must match the width the list asked for, or this is a second download
    // rather than a cache hit. See files/thumbSource.ts.
    uri: fileThumbUrl(file.id, heic ? 512 : 128, file.current_version, unlockToken ?? undefined),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}
