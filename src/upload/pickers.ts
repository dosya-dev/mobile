import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { resolvePairedVideo } from "@/backup/livePhoto";
import { t } from "@/lib/i18n";
import { scanToPdf } from "../../modules/dosya-document-scanner";
import type { UploadItem } from "./types";

// Files from the iOS share sheet arrive as detached copies (src/share-intent/
// incoming.ts) with no asset id, so their Live Photo video cannot be
// recovered; only the in-app picker and backup carry it.

// Items returned by pickers don't yet know which workspace they belong to -
// the enqueue site (FileBrowser.startPicked) stamps workspaceId before
// calling store.enqueue(), so the type system forces that step.
export type UploadDraft = Omit<UploadItem, "workspaceId">;

let counter = 0;
/**
 * Exported so every producer of upload drafts shares ONE counter. A second
 * module keeping its own would restart at 1 and mint ids that already exist -
 * and useUploadStore.patch() finds items by id, so a collision routes one
 * upload's progress onto another's row. Currently also used by
 * src/share-intent/copy.ts for files arriving from the Android share sheet.
 */
export function makeUploadId(): string {
  counter += 1;
  return `up_${counter}_${Math.round(counter * 1000)}`; // Date.now avoided; monotonic enough per session
}

/**
 * Move the counter past ids restored from disk (see upload/persist.ts). The
 * counter restarts at 0 with the process, so without this the first pick after
 * a relaunch would mint `up_1_1000` again while a restored `up_1_1000` is still
 * in the queue - and patch() would route its progress onto the wrong row.
 */
export function noteUploadIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const m = /^up_(\d+)_/.exec(id);
    if (m) counter = Math.max(counter, Number(m[1]));
  }
}

// expo-image-picker doesn't reliably populate `fileSize` on iOS (notably for
// videos/HEIC), which would otherwise produce 0-byte-size items - bypassing
// the >50MB resumable guard (OOM risk) and mis-recording size_bytes: 0.
async function resolveSize(uri: string, fileSize: number | undefined | null): Promise<number> {
  if (typeof fileSize === "number" && fileSize > 0) return fileSize;
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && !info.isDirectory ? info.size ?? 0 : 0;
}

function toItem(a: { uri: string; name: string; size: number; mime: string }): UploadDraft {
  return { id: makeUploadId(), name: a.name, uri: a.uri, size: a.size, mime: a.mime, folderId: null, status: "queued", progress: 0 };
}

export async function pickPhotos(): Promise<UploadDraft[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    quality: 1,
    // Hand over the asset as the library stores it. The default "automatic"
    // mode transcodes HEIC to JPEG and re-encodes video to H.264 at a lower
    // preset, so the "original" that reached the server was a lossy copy with
    // its EXIF stripped - a backup that is not the photo.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    exif: true,
  });
  if (res.canceled || !res.assets) return [];
  const drafts: UploadDraft[] = [];
  for (const a of res.assets) {
    const name = a.fileName ?? a.uri.split("/").pop() ?? "photo";
    drafts.push(toItem({ uri: a.uri, name, size: await resolveSize(a.uri, a.fileSize), mime: a.mimeType ?? "application/octet-stream" }));
    // A Live Photo's motion half is a separate asset resource the picker never
    // hands over. Queue it right behind its still under the sibling name; an
    // extraction failure costs the motion, never the still.
    if (a.type === "image" || (a.mimeType ?? "").startsWith("image/")) {
      const paired = await resolvePairedVideo({ id: a.assetId, uri: a.uri, filename: name });
      if (paired) drafts.push({ ...toItem({ uri: paired.uri, name: paired.name, size: paired.size, mime: paired.name.endsWith(".MP4") ? "video/mp4" : "video/quicktime" }), pairedTempUri: paired.uri });
    }
  }
  return drafts;
}

export async function capturePhoto(): Promise<UploadDraft[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: true });
  if (res.canceled || !res.assets) return [];
  return Promise.all(res.assets.map(async (a) => toItem({
    uri: a.uri,
    name: a.fileName ?? "capture.jpg",
    size: await resolveSize(a.uri, a.fileSize),
    mime: a.mimeType ?? "image/jpeg",
  })));
}

export async function pickDocuments(): Promise<UploadDraft[]> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (res.canceled || !res.assets) return [];
  return res.assets.map((a) => toItem({ uri: a.uri, name: a.name, size: a.size ?? 0, mime: a.mimeType ?? "application/octet-stream" }));
}

/**
 * Scan paper with the phone's own document scanner and queue the result as
 * one PDF. The scanner owns the camera, the edge finding and the extra pages
 * (modules/dosya-document-scanner), so this only names the file.
 */
export async function scanDocument(now: Date = new Date()): Promise<UploadDraft[]> {
  const pdf = await scanToPdf();
  if (!pdf) return [];
  return [toItem({
    uri: pdf.uri,
    name: scanFileName(now),
    size: await resolveSize(pdf.uri, pdf.size),
    mime: "application/pdf",
  })];
}

/**
 * "Scan 2026-11-03 14.22.05.pdf". The date is numeric in every language so it
 * sorts, and uses dots in the time because a colon is not allowed in a file
 * name on Windows or in the macOS Finder.
 */
export function scanFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  // A translation must never smuggle a path separator into the name.
  return `${t("upload.label.scanDate", { date }).replace(/[/\\:]/g, "-")}.pdf`;
}
