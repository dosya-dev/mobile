import { API_BASE_URL } from "@/api";

// Sizes the server thumbnail pipeline accepts (longest edge). Any other w → 400.
export type ThumbSize = 128 | 256 | 512 | 1600;

/**
 * Build the authenticated thumbnail URL for a file. The endpoint streams image
 * bytes (or a decoded HEIC preview); the request must carry a Bearer token.
 * Version is included so a new file version never serves a stale cached thumb.
 */
export function fileThumbUrl(fileId: string, size: ThumbSize, version?: number, unlockToken?: string): string {
  const params = new URLSearchParams();
  if (version && version > 0) params.set("version", String(version));
  params.set("w", String(size));
  // /thumb re-checks the unlock token itself and 403s a full_lock file without it.
  if (unlockToken) params.set("ut", unlockToken);
  return `${API_BASE_URL}/api/files/${fileId}/thumb?${params.toString()}`;
}

/**
 * The raw file bytes, served inline. Used directly for natively-renderable images
 * (JPEG/PNG/WebP/GIF/…). We hit /raw rather than /thumb for these because /thumb
 * 302-redirects to /raw for passthrough formats, and native image loaders drop the
 * Authorization header across that redirect (→ 401). /thumb is only worthwhile for
 * HEIC, which it actually decodes and serves in one hop.
 */
/**
 * The server-side office-to-PDF conversion for a file.
 *
 * Office documents have no native viewer on any client: the server converts them
 * and every client renders the resulting PDF. Lives here beside fileRawUrl so
 * there is one place that knows how a file URL is built.
 */
export function filePreviewPdfUrl(fileId: string): string {
  return `${API_BASE_URL}/api/files/${fileId}/preview-pdf`;
}

export function fileRawUrl(fileId: string, version?: number, unlockToken?: string): string {
  const params = new URLSearchParams();
  if (version && version > 0) params.set("version", String(version));
  // Same rule as /thumb: full_lock is refused without the token from /unlock.
  if (unlockToken) params.set("ut", unlockToken);
  const qs = params.toString();
  return `${API_BASE_URL}/api/files/${fileId}/raw${qs ? `?${qs}` : ""}`;
}
