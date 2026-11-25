import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { fileKind } from "./format";
import { shareFile } from "./download";
import { t } from "@/lib/i18n";
import { videoPlayable } from "@/viewer/videoSupport";

/**
 * Base64 is the only way to write through Android's Storage Access Framework -
 * there is no stream or copy API for a `content://` target - and the encoded
 * string is ~4/3 the size of the file, held in JS memory all at once. A couple
 * of hundred MB of that on a low-end phone is an out-of-memory crash, so above
 * this the save is handed to the system share sheet instead, which streams.
 */
export const MAX_DIRECT_WRITE_BYTES = 64 * 1024 * 1024;

export type SaveOutcome =
  /** Landed in the phone's Photos/Gallery app. */
  | { kind: "gallery" }
  /** Written into a folder the user chose. */
  | { kind: "folder" }
  /** Handed to the system sheet, where "Save to Files" lives. */
  | { kind: "shared"; reason?: "too-large" };

export class SaveCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveCancelled";
  }
}

/**
 * Put a downloaded file somewhere the user can find it OUTSIDE this app.
 *
 * The viewer's old Save handed the file straight to the share sheet, which is
 * a good way to send a file to another app and a poor way to keep one: on
 * Android it offers no "save here" at all for most types, so "download it to
 * my phone" was not actually possible.
 *
 * Three routes, by what the file is and what the platform allows:
 *  - Photos and videos go to the media library, so they appear in Gallery
 *    alongside the camera roll. That is where people look for them. A video
 *    iOS cannot decode is the exception: Photos refuses it, so it takes the
 *    share sheet below.
 *  - Everything else on Android goes through the Storage Access Framework: the
 *    user picks a real folder (Downloads, an SD card, Drive) and the bytes are
 *    written there.
 *  - iOS has no writable Downloads directory, so everything else goes to the
 *    share sheet, where "Save to Files" is the first-class option.
 *
 * `localUri` must already be a downloaded copy in the app's cache.
 */
export async function saveToDevice(params: {
  localUri: string;
  fileName: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
}): Promise<SaveOutcome> {
  const kind = fileKind(params.mimeType, params.extension);

  if (kind === "image" || (kind === "video" && videoPlayable(params.mimeType, params.extension, Platform.OS))) {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      throw new SaveCancelled(t("common.description.dosyaNeedsPermissionToAddPhotosToYourGallery"));
    }
    await MediaLibrary.saveToLibraryAsync(params.localUri);
    return { kind: "gallery" };
  }

  if (Platform.OS !== "android") {
    await shareFile(params.localUri);
    return { kind: "shared" };
  }

  // Too big to hold as a base64 string; the sheet streams instead of buffering.
  if (params.sizeBytes > MAX_DIRECT_WRITE_BYTES) {
    await shareFile(params.localUri);
    return { kind: "shared", reason: "too-large" };
  }

  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    throw new SaveCancelled(t("common.description.noFolderChosen"));
  }

  const target = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    params.fileName,
    params.mimeType || "application/octet-stream",
  );
  const contents = await FileSystem.readAsStringAsync(params.localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(target, contents, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { kind: "folder" };
}

/** What to tell the user once it lands. */
export function saveOutcomeMessage(outcome: SaveOutcome): string {
  switch (outcome.kind) {
    case "gallery":
      return t("common.label.savedToYourGallery");
    case "folder":
      return t("common.label.savedToYourPhone");
    case "shared":
      return outcome.reason === "too-large"
        ? t("common.description.tooLargeToSaveDirectlyChooseWhereToPutIt")
        : t("common.label.chooseWhereToSaveIt");
  }
}
