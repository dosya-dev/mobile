/**
 * The original file dates an upload declares to the server (unix seconds),
 * which stores them in files.source_created_at / source_modified_at for NEW
 * files so listings show when a photo was really taken rather than when the
 * backup ran. Implausible values are sanitized to NULL server-side, so this
 * only skips the obvious zero/negative epoch fallbacks.
 */
export function sourceTimeHeaders(item: {
  sourceCreatedAt?: number;
  sourceModifiedAt?: number;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if ((item.sourceCreatedAt ?? 0) > 0) headers["X-Dosya-Source-Ctime"] = String(Math.floor(item.sourceCreatedAt!));
  if ((item.sourceModifiedAt ?? 0) > 0) headers["X-Dosya-Source-Mtime"] = String(Math.floor(item.sourceModifiedAt!));
  return headers;
}
