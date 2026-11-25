import { mimeForFilename } from "./mime";

describe("mimeForFilename", () => {
  it("reads the real type off the extension", () => {
    expect(mimeForFilename("IMG_0001.HEIC", "photo")).toBe("image/heic");
    expect(mimeForFilename("IMG_0002.png", "photo")).toBe("image/png");
    expect(mimeForFilename("IMG_0003.MOV", "video")).toBe("video/quicktime");
    expect(mimeForFilename("clip.webm", "video")).toBe("video/webm");
    expect(mimeForFilename("raw.dng", "photo")).toBe("image/x-adobe-dng");
  });

  it("is case insensitive", () => {
    expect(mimeForFilename("a.JpEg", "photo")).toBe("image/jpeg");
  });

  it("falls back to the media-type default for unknown extensions", () => {
    expect(mimeForFilename("weird.xyz", "photo")).toBe("image/jpeg");
    expect(mimeForFilename("weird.xyz", "video")).toBe("video/mp4");
    expect(mimeForFilename("noextension", "photo")).toBe("image/jpeg");
  });

  it("does not mistake a dot in the directory portion for an extension", () => {
    expect(mimeForFilename("my.photos/IMG_1", "photo")).toBe("image/jpeg");
  });
});
