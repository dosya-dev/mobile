import * as FileSystem from "expo-file-system/legacy";
import { useShareIntentStore } from "./store";
import type { SharedFile } from "./types";

/**
 * The iOS half of "Open with" / share sheet. Android's half is
 * modules/dosya-share-intent + listener.ts; this file is what iOS needs instead.
 *
 * On iOS a document opened with dosya.dev (CFBundleDocumentTypes in
 * app.config.ts) is copied by the system into Documents/Inbox and the app is
 * launched - or foregrounded - with its file:// URL, exactly like a deep link.
 * That is the whole hand-over: no extras, no provider, no native code. But it
 * also means expo-router sees the URL, and without interception it becomes a
 * route ("Unmatched Route" rendered over the app). app/+native-intent.ts calls
 * routeIncomingUrl() for every URL to keep file opens out of the router and
 * park them for app/save-to.tsx instead.
 */

/** file:// and content:// - the two schemes a file open or share can arrive as. */
export function isIncomingFileUrl(url: string): boolean {
  return url.startsWith("file:") || url.startsWith("content:");
}

/** Files iOS placed in the app's Documents/Inbox. Ours to delete, nothing else is. */
export function isInboxUri(uri: string): boolean {
  return uri.startsWith("file:") && uri.includes("/Documents/Inbox/");
}

/**
 * Enough for the server to pick an icon and preview, which it does from the
 * extension anyway; the mime mostly matters for the upload PUT's content-type.
 * Anything unlisted uploads as a generic blob and still works.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  rtf: "application/rtf",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  gz: "application/gzip",
  tar: "application/x-tar",
  ics: "text/calendar",
  vcf: "text/vcard",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  webm: "video/webm",
};

function mimeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function fileNameOf(url: string): string {
  const path = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const raw = path.slice(path.lastIndexOf("/") + 1);
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Malformed escape - keep the raw segment rather than lose the file.
  }
  return name.trim().length > 0 ? name : "shared-file";
}

/**
 * A file:// URL as a SharedFile, or null when there is nothing to upload: not a
 * file URL, missing, or a directory (packages like .pages bundles arrive as
 * directories and cannot be copied as one blob).
 */
export async function describeIncomingFile(url: string): Promise<SharedFile | null> {
  if (!url.startsWith("file:")) return null;
  const info = await FileSystem.getInfoAsync(url);
  if (!info.exists || info.isDirectory) return null;
  const name = fileNameOf(url);
  return {
    uri: url,
    name,
    size: typeof info.size === "number" && info.size > 0 ? info.size : 0,
    mime: mimeOf(name),
  };
}

// iOS can surface a single open through both the initial-URL read and the url
// event. The Inbox path is reused once the earlier copy has been deleted, so the
// guard is a short window, not a permanent set.
const REPEAT_WINDOW_MS = 10_000;
let lastParked: { url: string; at: number } | null = null;

/**
 * expo-router's redirectSystemPath, minus the Platform lookup so it is testable.
 * Returns the path to route, or null to keep the URL out of the router.
 *
 * Never throws: expo-router documents that a throw from redirectSystemPath can
 * take the app down, and a stat failure on an opened file must degrade to
 * "nothing to save".
 */
export async function routeIncomingUrl(path: string, platform: string): Promise<string | null> {
  if (!isIncomingFileUrl(path)) return path;
  // Android: the native module already delivered this intent with its real
  // display name and size (listener.ts). Parking it here too would open the
  // picker twice. It still has to be swallowed - "Open with" launches the
  // activity with the content:// URI as intent data, which RN's Linking reports
  // as the initial URL and expo-router would otherwise try to route.
  if (platform !== "ios") return null;
  const now = Date.now();
  if (lastParked && lastParked.url === path && now - lastParked.at < REPEAT_WINDOW_MS) return null;
  try {
    const file = await describeIncomingFile(path);
    if (file) {
      lastParked = { url: path, at: now };
      useShareIntentStore.getState().receive([file]);
    }
  } catch {
    // Unreadable - see the never-throws note above.
  }
  return null;
}

/**
 * Removes the originals iOS copied into Documents/Inbox. Apple leaves that to
 * the app; nothing else ever reclaims them. Anything that is not an Inbox file
 * - a content:// handle into another app's provider, a cache copy owned by the
 * upload queue - is left alone. Best-effort: one failed delete must not stop
 * the others.
 */
export async function discardSharedFiles(files: SharedFile[]): Promise<void> {
  for (const file of files) {
    if (!isInboxUri(file.uri)) continue;
    try {
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
    } catch {
      // Already gone, or the sandbox refused. Nothing the user can act on.
    }
  }
}
