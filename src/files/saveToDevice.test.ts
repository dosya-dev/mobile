import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { MAX_DIRECT_WRITE_BYTES, SaveCancelled, saveOutcomeMessage, saveToDevice } from "./saveToDevice";
import { shareFile } from "./download";

jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: jest.fn(async () => "YmFzZTY0"),
  writeAsStringAsync: jest.fn(),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(async () => "content://target/doc"),
  },
}));
jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}));
jest.mock("./download", () => ({ shareFile: jest.fn() }));

const saf = FileSystem.StorageAccessFramework as jest.Mocked<typeof FileSystem.StorageAccessFramework>;
const requestPerm = MediaLibrary.requestPermissionsAsync as jest.Mock;
const saveToLibrary = MediaLibrary.saveToLibraryAsync as jest.Mock;
const share = shareFile as jest.Mock;

function args(over: Record<string, unknown> = {}) {
  return {
    localUri: "file:///cache/report.pdf",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    extension: ".pdf",
    sizeBytes: 1024,
    ...over,
  } as Parameters<typeof saveToDevice>[0];
}

const setPlatform = (os: "ios" | "android") => {
  (Platform as unknown as { OS: string }).OS = os;
};

describe("saveToDevice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform("android");
    requestPerm.mockResolvedValue({ granted: true });
    (saf.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true, directoryUri: "content://tree/downloads",
    });
  });

  // Photos belong in the gallery next to the camera roll - that is where
  // people go looking for them, not inside a file manager.
  it("puts a photo in the gallery", async () => {
    const out = await saveToDevice(
      args({ mimeType: "image/jpeg", extension: ".jpg", fileName: "pic.jpg", localUri: "file:///cache/pic.jpg" }),
    );
    expect(out).toEqual({ kind: "gallery" });
    expect(saveToLibrary).toHaveBeenCalledWith("file:///cache/pic.jpg");
    expect(saf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  });

  it("puts a video in the gallery too", async () => {
    const out = await saveToDevice(args({ mimeType: "video/mp4", extension: ".mp4", fileName: "clip.mp4" }));
    expect(out).toEqual({ kind: "gallery" });
  });

  it("asks for write permission only, not full library access", async () => {
    await saveToDevice(args({ mimeType: "image/png", extension: ".png" }));
    expect(requestPerm).toHaveBeenCalledWith(true);
  });

  it("explains itself when gallery permission is refused", async () => {
    requestPerm.mockResolvedValue({ granted: false });
    await expect(saveToDevice(args({ mimeType: "image/png", extension: ".png" }))).rejects.toBeInstanceOf(SaveCancelled);
    expect(saveToLibrary).not.toHaveBeenCalled();
  });

  it("writes a document into the folder the user picked", async () => {
    const out = await saveToDevice(args());
    expect(out).toEqual({ kind: "folder" });
    expect(saf.createFileAsync).toHaveBeenCalledWith("content://tree/downloads", "report.pdf", "application/pdf");
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith("content://target/doc", "YmFzZTY0", { encoding: "base64" });
  });

  // Backing out of the folder picker is a choice, not a failure. Reporting it
  // as "couldn't save" reads as a bug the user then tries to work around.
  it("treats a dismissed folder picker as a cancellation", async () => {
    (saf.requestDirectoryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    await expect(saveToDevice(args())).rejects.toBeInstanceOf(SaveCancelled);
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });

  // The SAF write has to buffer the whole file as base64 (~4/3 its size) in JS
  // memory. A few hundred MB of that is an out-of-memory crash.
  it("hands a very large file to the share sheet instead of buffering it", async () => {
    const out = await saveToDevice(args({ sizeBytes: MAX_DIRECT_WRITE_BYTES + 1 }));
    expect(out).toEqual({ kind: "shared", reason: "too-large" });
    expect(share).toHaveBeenCalledWith("file:///cache/report.pdf");
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it("stays under the cap for a file exactly at the limit", async () => {
    const out = await saveToDevice(args({ sizeBytes: MAX_DIRECT_WRITE_BYTES }));
    expect(out).toEqual({ kind: "folder" });
  });

  // iOS has no writable Downloads directory; "Save to Files" lives in the sheet.
  it("uses the share sheet for a document on iOS", async () => {
    setPlatform("ios");
    const out = await saveToDevice(args());
    expect(out).toEqual({ kind: "shared" });
    expect(share).toHaveBeenCalled();
    expect(saf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  });

  // Photos refuses a container AVFoundation cannot read, so the gallery route
  // would turn a perfectly good MKV into a failed save.
  it("uses the share sheet for a video iOS cannot decode", async () => {
    setPlatform("ios");
    const out = await saveToDevice(args({ mimeType: "video/x-matroska", extension: "mkv", fileName: "film.mkv" }));
    expect(out).toEqual({ kind: "shared" });
    expect(saveToLibrary).not.toHaveBeenCalled();
  });

  it("still uses the gallery for that same video on Android", async () => {
    const out = await saveToDevice(args({ mimeType: "video/x-matroska", extension: "mkv", fileName: "film.mkv" }));
    expect(out).toEqual({ kind: "gallery" });
  });

  it("still uses the gallery for a photo on iOS", async () => {
    setPlatform("ios");
    const out = await saveToDevice(args({ mimeType: "image/heic", extension: ".heic" }));
    expect(out).toEqual({ kind: "gallery" });
  });

  it("falls back to a generic mime when the file has none", async () => {
    await saveToDevice(args({ mimeType: "", extension: null, fileName: "blob" }));
    expect(saf.createFileAsync).toHaveBeenCalledWith(expect.any(String), "blob", "application/octet-stream");
  });
});

describe("saveOutcomeMessage", () => {
  it("says where the file actually went", () => {
    expect(saveOutcomeMessage({ kind: "gallery" })).toBe("Saved to your gallery");
    expect(saveOutcomeMessage({ kind: "folder" })).toBe("Saved to your phone");
    expect(saveOutcomeMessage({ kind: "shared" })).toBe("Choose where to save it");
    expect(saveOutcomeMessage({ kind: "shared", reason: "too-large" })).toContain("Too large to save directly");
  });
});
