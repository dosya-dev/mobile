const mockNative = {
  livePhotoVideoUri: jest.fn(async (..._a: unknown[]) => null as string | null),
  copyTail: jest.fn(async (..._a: unknown[]) => true),
};
let mockNativePresent = true;
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: jest.fn(() => (mockNativePresent ? mockNative : null)),
}));
const mockGetInfoAsync = jest.fn(async (..._a: unknown[]) => ({ exists: true, size: 2_400_000 }));
const mockDeleteAsync = jest.fn(async (..._a: unknown[]) => {});
const mockReadAsStringAsync = jest.fn(async (..._a: unknown[]) => "");
const mockMakeDirectoryAsync = jest.fn(async (..._a: unknown[]) => {});
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  getInfoAsync: (...a: unknown[]) => mockGetInfoAsync(...a),
  deleteAsync: (...a: unknown[]) => mockDeleteAsync(...a),
  readAsStringAsync: (...a: unknown[]) => mockReadAsStringAsync(...a),
  makeDirectoryAsync: (...a: unknown[]) => mockMakeDirectoryAsync(...a),
}));
jest.mock("./motionPhoto", () => ({ ...jest.requireActual("./motionPhoto"), parseMotionPhotoOffset: (...a: unknown[]) => mockParse(...a) }));
const mockParse = jest.fn((..._a: unknown[]) => null as number | null);

import { Platform } from "react-native";
import { resolvePairedVideo, livePhotoLedgerId, isLivePhotoLedgerId, discardLivePhotoTemp, clearLivePhotoTemp, LIVE_PHOTO_TEMP_DIR } from "./livePhoto";

const setOS = (os: string) => { (Platform as unknown as { OS: string }).OS = os; };
const originalOS = Platform.OS;

// A copy of motionPhoto.test.ts's jpegWithXmp + PIXEL_CONTAINER fixture, so the
// "real parser" case below builds an actual Motion Photo header rather than
// relying on the mocked parseMotionPhotoOffset the other Android cases use.
const enc = (s: string) => new TextEncoder().encode(s);
const SOI = new Uint8Array([0xff, 0xd8]);
function jpegWithXmp(xmp: string): Uint8Array {
  const ns = enc("http://ns.adobe.com/xap/1.0/\0");
  const body = enc(xmp);
  const len = 2 + ns.length + body.length;
  return new Uint8Array([...SOI, 0xff, 0xe1, len >> 8, len & 0xff, ...ns, ...body, 0xff, 0xda]);
}
const PIXEL_CONTAINER = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" GCamera:MotionPhoto="1"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="3128172" Item:Padding="0"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;

beforeEach(() => {
  jest.clearAllMocks();
  mockNativePresent = true;
  mockNative.livePhotoVideoUri.mockResolvedValue(null);
  mockNative.copyTail.mockResolvedValue(true);
  mockGetInfoAsync.mockResolvedValue({ exists: true, size: 2_400_000 });
  mockParse.mockReturnValue(null);
  setOS("ios");
});

afterAll(() => setOS(originalOS));

describe("resolvePairedVideo", () => {
  it("names the paired video after the still", async () => {
    mockNative.livePhotoVideoUri.mockResolvedValue("file:///tmp/paired.mov");
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toEqual({
      uri: "file:///tmp/paired.mov",
      size: 2_400_000,
      name: "IMG_1.MOV",
    });
  });

  it("handles a filename with no extension", async () => {
    mockNative.livePhotoVideoUri.mockResolvedValue("file:///tmp/paired.mov");
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1" })).resolves.toMatchObject({ name: "IMG_1.MOV" });
  });

  it("returns null for a still that has no paired video", async () => {
    mockNative.livePhotoVideoUri.mockResolvedValue(null);
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toBeNull();
  });

  it("returns null off iOS", async () => {
    setOS("android");
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toBeNull();
    expect(mockNative.livePhotoVideoUri).not.toHaveBeenCalled();
  });

  it("returns null when the native module is absent (Expo Go)", async () => {
    mockNativePresent = false;
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toBeNull();
  });

  it("returns null rather than throwing when extraction fails", async () => {
    mockNative.livePhotoVideoUri.mockRejectedValue(new Error("resource unavailable"));
    // Losing the motion must never cost the user the still.
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toBeNull();
  });

  it("returns null when the extracted file is unreadable", async () => {
    mockNative.livePhotoVideoUri.mockResolvedValue("file:///tmp/paired.mov");
    mockGetInfoAsync.mockResolvedValue({ exists: false, size: 0 });
    await expect(resolvePairedVideo({ id: "a", filename: "IMG_1.HEIC" })).resolves.toBeNull();
  });

  it("returns null on iOS when there is no asset id (e.g. an Android caller shape)", async () => {
    await expect(resolvePairedVideo({ filename: "x.jpg" })).resolves.toBeNull();
    expect(mockNative.livePhotoVideoUri).not.toHaveBeenCalled();
  });
});

describe("resolvePairedVideo on Android", () => {
  beforeEach(() => { setOS("android"); mockParse.mockReturnValue(null); mockNative.copyTail.mockResolvedValue(true); });

  it("extracts the tail into the cache under the sibling MP4 name", async () => {
    mockReadAsStringAsync.mockResolvedValue("/9j/4AAQ");
    mockGetInfoAsync.mockImplementation(async (uri: unknown) => (uri as string).endsWith(".MP4") || (uri as string).includes("dosya-live-photos") ? { exists: true, size: 3_128_172 } : { exists: true, size: 9_000_000 });
    mockParse.mockReturnValue(3_128_172);
    const out = await resolvePairedVideo({ uri: "file:///dcim/PXL_1.jpg", filename: "PXL_1.jpg" });
    expect(mockReadAsStringAsync).toHaveBeenCalledWith("file:///dcim/PXL_1.jpg", { encoding: "base64", position: 0, length: 262144 });
    expect(mockNative.copyTail).toHaveBeenCalledWith("file:///dcim/PXL_1.jpg", 3_128_172, expect.stringContaining("dosya-live-photos/"));
    expect(out).toEqual({ uri: expect.stringMatching(/dosya-live-photos\/.+\.mp4$/), size: 3_128_172, name: "PXL_1.MP4" });
  });

  it("returns null when the JPEG is not a Motion Photo", async () => {
    mockReadAsStringAsync.mockResolvedValue("/9j/4AAQ");
    expect(await resolvePairedVideo({ uri: "file:///dcim/plain.jpg", filename: "plain.jpg" })).toBeNull();
    expect(mockNative.copyTail).not.toHaveBeenCalled();
  });

  it("offset beyond size: refuses an offset larger than the file", async () => {
    mockReadAsStringAsync.mockResolvedValue("/9j/4AAQ");
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1_000 });
    mockParse.mockReturnValue(5_000);
    expect(await resolvePairedVideo({ uri: "file:///dcim/bad.jpg", filename: "bad.jpg" })).toBeNull();
    expect(mockNative.copyTail).not.toHaveBeenCalled();
  });

  it("returns null without a uri, without the native module, or when copyTail fails", async () => {
    expect(await resolvePairedVideo({ filename: "x.jpg" })).toBeNull();
    mockReadAsStringAsync.mockResolvedValue("/9j/4AAQ");
    mockParse.mockReturnValue(100);
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1_000 });
    mockNative.copyTail.mockResolvedValue(false);
    expect(await resolvePairedVideo({ uri: "file:///dcim/y.jpg", filename: "y.jpg" })).toBeNull();
    // A failed copyTail has already created the target and written part of the
    // tail into it. Left behind, that truncated MP4 is claimed by nothing: the
    // twin's ledger row stays absent, so a retry writes the same path again.
    expect(mockDeleteAsync).toHaveBeenCalledWith(expect.stringMatching(/dosya-live-photos\/.+\.mp4$/), { idempotent: true });
    mockNativePresent = false;
    expect(await resolvePairedVideo({ uri: "file:///dcim/y.jpg", filename: "y.jpg" })).toBeNull();
  });

  // copyTail can also answer true having written nothing (a source that turned
  // out to be unreadable at the seek), which leaves a zero-byte file behind.
  it("removes a zero-byte target that copyTail claimed to have written", async () => {
    mockReadAsStringAsync.mockResolvedValue("/9j/4AAQ");
    mockParse.mockReturnValue(100);
    mockGetInfoAsync.mockImplementation(async (uri: unknown) =>
      (uri as string).includes("dosya-live-photos") ? { exists: true, size: 0 } : { exists: true, size: 1_000 });
    mockNative.copyTail.mockResolvedValue(true);
    expect(await resolvePairedVideo({ uri: "file:///dcim/z.jpg", filename: "z.jpg" })).toBeNull();
    expect(mockDeleteAsync).toHaveBeenCalledWith(expect.stringMatching(/dosya-live-photos\/.+\.mp4$/), { idempotent: true });
  });

  // The cases above mock parseMotionPhotoOffset, so they never exercise
  // base64ToBytes -> the real parser -> copyTail together. These two run the
  // real parser (see motionPhoto.test.ts for the same fixtures) against a
  // header this test builds and base64-encodes itself, the way the native
  // readAsStringAsync call would actually hand it back.
  it("runs end to end through the real parser: header bytes -> offset -> copyTail", async () => {
    mockParse.mockImplementation(jest.requireActual("./motionPhoto").parseMotionPhotoOffset);
    const header = jpegWithXmp(PIXEL_CONTAINER);
    mockReadAsStringAsync.mockResolvedValue(Buffer.from(header).toString("base64"));
    mockGetInfoAsync.mockImplementation(async (uri: unknown) => (uri as string).includes("dosya-live-photos") ? { exists: true, size: 3_128_172 } : { exists: true, size: 9_000_000 });
    const out = await resolvePairedVideo({ uri: "file:///dcim/PXL_2.jpg", filename: "PXL_2.jpg" });
    expect(mockNative.copyTail).toHaveBeenCalledWith("file:///dcim/PXL_2.jpg", 3_128_172, expect.stringMatching(/dosya-live-photos\/.+\.mp4$/));
    expect(out).toEqual({ uri: expect.stringMatching(/dosya-live-photos\/.+\.mp4$/), size: 3_128_172, name: "PXL_2.MP4" });
  });

  it("real parser: a plain JPEG with no Motion Photo XMP returns null", async () => {
    mockParse.mockImplementation(jest.requireActual("./motionPhoto").parseMotionPhotoOffset);
    const header = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 0]);
    mockReadAsStringAsync.mockResolvedValue(Buffer.from(header).toString("base64"));
    expect(await resolvePairedVideo({ uri: "file:///dcim/plain2.jpg", filename: "plain2.jpg" })).toBeNull();
    expect(mockNative.copyTail).not.toHaveBeenCalled();
  });
});

describe("livePhotoLedgerId", () => {
  it("gives the paired video its own ledger identity", () => {
    // Its own row means it dedupes and resumes like any other asset instead of
    // being re-extracted and re-uploaded on every run.
    expect(livePhotoLedgerId("abc")).toBe("abc#video");
  });
});

describe("extraction temp files", () => {
  it("recognises a paired-video ledger key", () => {
    expect(isLivePhotoLedgerId(livePhotoLedgerId("a"))).toBe(true);
    expect(isLivePhotoLedgerId("a")).toBe(false);
  });

  it("names the native module's extraction directory", () => {
    expect(LIVE_PHOTO_TEMP_DIR).toBe("file:///cache/dosya-live-photos/");
  });

  it("discards one extracted video and swallows a failure", async () => {
    await discardLivePhotoTemp("file:///cache/dosya-live-photos/x.mov");
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///cache/dosya-live-photos/x.mov", { idempotent: true });
    mockDeleteAsync.mockRejectedValueOnce(new Error("EPERM"));
    await expect(discardLivePhotoTemp("file:///cache/dosya-live-photos/y.mov")).resolves.toBeUndefined();
    await discardLivePhotoTemp("");
    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
  });

  it("clears the whole directory", async () => {
    await clearLivePhotoTemp();
    expect(mockDeleteAsync).toHaveBeenCalledWith(LIVE_PHOTO_TEMP_DIR, { idempotent: true });
  });
});
