// Image type helpers shared by Report a problem and the live chat composer.

/** File extension the server derives a type's screenshot name from, when the
 *  picker gave no file name of its own. */
export const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const TYPE_FOR_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** iOS hands back HEIC by default and some pickers leave mimeType empty
 *  entirely, so the uri's own extension is the fallback, not a last resort. */
export function resolveImageType(mimeType: string | null | undefined, uri: string): string | null {
  if (mimeType) return mimeType;
  const ext = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  return ext ? TYPE_FOR_EXTENSION[ext] ?? null : null;
}
