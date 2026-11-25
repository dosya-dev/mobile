/**
 * What a Vault file is, guessed from its name alone.
 *
 * A Vault entry carries no mime type: the server stores ciphertext and a
 * wrapped name, so there is nothing for it to sniff and nothing it could tell
 * us if it did. The name is all the client has, and it is enough to pick a
 * stage and to hand a sensible type to the phone's save flow.
 *
 * Unknown means `application/octet-stream`, never a guess: a wrong image type
 * lands the file on a stage that cannot decode it, which reads as a broken
 * file rather than an unsupported one. That is why `.ts` stays out of the
 * table: from the name alone it is as likely TypeScript as a transport stream.
 */
const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  ogv: "video/ogg",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
};

/** The lower-case extension without its dot, or null when the name has none. */
export function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  // `dot > 0` keeps dotfiles (".gitignore") from reading as an extension, and
  // the length check keeps a trailing dot from producing an empty one.
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

export function mimeFromName(name: string): string {
  const ext = extOf(name);
  return (ext && BY_EXT[ext]) || "application/octet-stream";
}
