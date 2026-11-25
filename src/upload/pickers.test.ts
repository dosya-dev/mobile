jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: "file://a.jpg", fileName: "a.jpg", fileSize: 100, mimeType: "image/jpeg" }],
  })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  MediaTypeOptions: { All: "All" },
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: "automatic", Compatible: "compatible", Current: "current" },
  VideoExportPreset: { Passthrough: 0, LowQuality: 1, MediumQuality: 2, HighestQuality: 3 },
}));
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: "file://d.pdf", name: "d.pdf", size: 200, mimeType: "application/pdf" }],
  })),
}));
// Named with a `mock` prefix: babel-plugin-jest-hoist only allows a
// jest.mock() factory to reference out-of-scope variables that are either
// "pure" (e.g. object/array literals) or explicitly escape-hatched via a
// `mock`-prefixed name - see runner.test.ts for the same mechanism.
const mockGetInfoAsync = jest.fn();
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: (...a: any[]) => mockGetInfoAsync(...a) }));
const mockResolvePairedVideo = jest.fn(async (a: { id?: string | null }) =>
  a.id === "ABC/L0/001" ? { uri: "file:///cache/dosya-live-photos/ABC_L0_001.mov", size: 2_400_000, name: "IMG_1.MOV" } : null,
);
jest.mock("@/backup/livePhoto", () => ({ resolvePairedVideo: (...a: unknown[]) => mockResolvePairedVideo(...(a as [never])) }));

jest.mock("../../modules/dosya-document-scanner");

import { pickPhotos, capturePhoto, pickDocuments, scanDocument, scanFileName } from "./pickers";
import { scanToPdf } from "../../modules/dosya-document-scanner";
import * as ImagePicker from "expo-image-picker";

beforeEach(() => { mockGetInfoAsync.mockReset(); mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 12345 }); });

describe("pickers", () => {
  it("maps picked photos to upload items", async () => {
    const items = await pickPhotos();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "a.jpg", uri: "file://a.jpg", size: 100, mime: "image/jpeg", status: "queued" });
    expect(mockGetInfoAsync).not.toHaveBeenCalled();
  });
  it("falls back to expo-file-system size when the picker asset has no fileSize (iOS)", async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file://big.mov", fileName: "big.mov", fileSize: 0, mimeType: "video/quicktime" }],
    });
    const items = await pickPhotos();
    expect(mockGetInfoAsync).toHaveBeenCalledWith("file://big.mov");
    expect(items[0].size).toBe(12345);
  });
  it("asks the library for the original bytes: no transcode, no video re-encode, EXIF kept", async () => {
    await pickPhotos();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
      // "current" = hand over the asset as stored (HEIC stays HEIC, a 4K HEVC
      // clip stays 4K HEVC) instead of a JPEG/H.264 re-encode that drops
      // quality and metadata before the upload even starts.
      preferredAssetRepresentationMode: "current",
      videoExportPreset: 0,
      exif: true,
      quality: 1,
    }));
  });

  it("keeps the camera capture's EXIF too", async () => {
    await capturePhoto();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: true, quality: 1 }));
  });

  it("returns [] when the camera is canceled", async () => {
    expect(await capturePhoto()).toEqual([]);
  });
  it("capturePhoto falls back to expo-file-system size when fileSize is missing", async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file://cap.heic", mimeType: "image/heic" }],
    });
    const items = await capturePhoto();
    expect(mockGetInfoAsync).toHaveBeenCalledWith("file://cap.heic");
    expect(items[0].size).toBe(12345);
  });
  it("maps picked documents", async () => {
    const items = await pickDocuments();
    expect(items[0]).toMatchObject({ name: "d.pdf", mime: "application/pdf", size: 200 });
    expect(mockGetInfoAsync).not.toHaveBeenCalled();
  });

  it("pickPhotos queues a Live Photo's twin right after its still with the sibling name", async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: "file:///p/IMG_1.HEIC", fileName: "IMG_1.HEIC", fileSize: 3_000_000, mimeType: "image/heic", assetId: "ABC/L0/001" },
        { uri: "file:///p/IMG_2.HEIC", fileName: "IMG_2.HEIC", fileSize: 2_000_000, mimeType: "image/heic", assetId: "DEF/L0/001" },
      ],
    });
    const drafts = await pickPhotos();
    expect(drafts.map((d) => d.name)).toEqual(["IMG_1.HEIC", "IMG_1.MOV", "IMG_2.HEIC"]);
    expect(drafts[1]).toMatchObject({
      mime: "video/quicktime",
      size: 2_400_000,
      pairedTempUri: "file:///cache/dosya-live-photos/ABC_L0_001.mov",
      uri: "file:///cache/dosya-live-photos/ABC_L0_001.mov",
    });
    expect(mockResolvePairedVideo).toHaveBeenCalledWith({ id: "ABC/L0/001", uri: "file:///p/IMG_1.HEIC", filename: "IMG_1.HEIC" });
  });
});

describe("scanDocument", () => {
  const at = new Date(2026, 10, 3, 9, 4, 5);

  it("queues the scanner's PDF under a dated name", async () => {
    (scanToPdf as jest.Mock).mockResolvedValueOnce({ uri: "file:///cache/scans/x.pdf", pageCount: 3, size: 482_000 });
    const items = await scanDocument(at);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Scan 2026-11-03 09.04.05.pdf",
      uri: "file:///cache/scans/x.pdf",
      size: 482_000,
      mime: "application/pdf",
      status: "queued",
    });
  });

  it("queues nothing when the person backs out of the scanner", async () => {
    (scanToPdf as jest.Mock).mockResolvedValueOnce(null);
    expect(await scanDocument(at)).toEqual([]);
  });

  it("reads the size from disk when the scanner does not report one", async () => {
    (scanToPdf as jest.Mock).mockResolvedValueOnce({ uri: "file:///cache/scans/y.pdf", pageCount: 1, size: 0 });
    const [item] = await scanDocument(at);
    expect(mockGetInfoAsync).toHaveBeenCalledWith("file:///cache/scans/y.pdf");
    expect(item.size).toBe(12345);
  });

  // A colon is not allowed in a Windows or Finder file name, so the time uses dots.
  it("names the file with no path or drive separators in it", () => {
    expect(scanFileName(at)).not.toMatch(/[/\\:]/);
  });
});
