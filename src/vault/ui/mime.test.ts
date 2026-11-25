import { mimeFromName, extOf } from "./mime";

describe("extOf", () => {
  it("returns the lower-case extension without the dot", () => {
    expect(extOf("Holiday.JPG")).toBe("jpg");
    expect(extOf("archive.tar.gz")).toBe("gz");
  });

  it("returns null when there is no extension to speak of", () => {
    expect(extOf("README")).toBeNull();
    expect(extOf(".gitignore")).toBeNull();
    expect(extOf("trailing.")).toBeNull();
  });
});

describe("mimeFromName", () => {
  it("maps the types the Vault's stages can actually show", () => {
    expect(mimeFromName("a.jpg")).toBe("image/jpeg");
    expect(mimeFromName("a.jpeg")).toBe("image/jpeg");
    expect(mimeFromName("a.png")).toBe("image/png");
    expect(mimeFromName("a.gif")).toBe("image/gif");
    expect(mimeFromName("a.webp")).toBe("image/webp");
    expect(mimeFromName("a.heic")).toBe("image/heic");
    expect(mimeFromName("a.mp4")).toBe("video/mp4");
    expect(mimeFromName("a.m4v")).toBe("video/mp4");
    expect(mimeFromName("a.mov")).toBe("video/quicktime");
  });

  it("maps the containers the phone's players can open", () => {
    expect(mimeFromName("a.mkv")).toBe("video/x-matroska");
    expect(mimeFromName("a.webm")).toBe("video/webm");
    expect(mimeFromName("a.avi")).toBe("video/x-msvideo");
    expect(mimeFromName("a.wmv")).toBe("video/x-ms-wmv");
    expect(mimeFromName("a.flv")).toBe("video/x-flv");
    expect(mimeFromName("a.ogv")).toBe("video/ogg");
    expect(mimeFromName("a.mpg")).toBe("video/mpeg");
    expect(mimeFromName("a.mpeg")).toBe("video/mpeg");
    expect(mimeFromName("a.3gp")).toBe("video/3gpp");
  });

  it("does not read .ts as a video, because a name alone cannot tell it from TypeScript", () => {
    expect(mimeFromName("index.ts")).toBe("application/octet-stream");
  });

  it("maps the common document, archive and audio types", () => {
    expect(mimeFromName("a.pdf")).toBe("application/pdf");
    expect(mimeFromName("a.txt")).toBe("text/plain");
    expect(mimeFromName("a.md")).toBe("text/markdown");
    expect(mimeFromName("a.zip")).toBe("application/zip");
    expect(mimeFromName("a.mp3")).toBe("audio/mpeg");
    expect(mimeFromName("a.m4a")).toBe("audio/mp4");
  });

  it("is case-insensitive", () => {
    expect(mimeFromName("HOLIDAY.MOV")).toBe("video/quicktime");
  });

  it("falls back to octet-stream for anything else, including a name with no extension", () => {
    // The Vault never learns a type from the server - the file name is all
    // there is - so an unknown name must land on the glyph stage rather than
    // being guessed into an image.
    expect(mimeFromName("a.xyz")).toBe("application/octet-stream");
    expect(mimeFromName("notes")).toBe("application/octet-stream");
  });
});
