/**
 * Type from filename extension, mirroring the server's own map in
 * apps/api/src/lib/mime.ts so the client and server agree and thumbnails
 * resolve.
 *
 * Before this existed the orchestrator hardcoded image/jpeg and video/mp4 from
 * the media type alone, which mislabeled every HEIC, PNG, DNG, MOV and HEVC on
 * the device.
 */
const MIME_BY_EXT: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  dng: "image/x-adobe-dng",
  // Video
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  "3gp": "video/3gpp",
};

/**
 * Unknown extensions fall back to the value the orchestrator used to hardcode,
 * so this is strictly better than the old behavior with no regression path.
 */
export function mimeForFilename(name: string, fallback: "photo" | "video"): string {
  // Take the basename first: a dot in a directory segment is not an extension.
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? (fallback === "video" ? "video/mp4" : "image/jpeg");
}
