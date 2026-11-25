import { canAirPlay, canCast, castAllowed, castContentType, castKind } from "./castSupport";

const file = (mime: string, ext: string | null, lock_mode = "none") => ({ mime_type: mime, extension: ext, lock_mode });

describe("castKind", () => {
  it("knows the formats the TV decodes", () => {
    expect(castKind(file("video/mp4", ".mp4"))).toBe("video");
    expect(castKind(file("video/quicktime", "mov"))).toBe("video");
    expect(castKind(file("audio/mpeg", ".mp3"))).toBe("audio");
    expect(castKind(file("audio/flac", ".flac"))).toBe("audio");
    expect(castKind(file("image/jpeg", ".JPG"))).toBe("image");
    expect(castKind(file("image/png", ".png"))).toBe("image");
  });

  // The receiver is a browser: a photo it cannot put in an <img> would sit on
  // the TV as a spinner with nothing on the phone saying why.
  it("refuses photos a browser cannot show", () => {
    for (const ext of [".heic", ".tiff", ".dng", ".psd"]) {
      expect(castKind(file("image/unknown", ext))).toBeNull();
    }
  });

  it("refuses the video containers the receiver has no demuxer for", () => {
    for (const ext of [".avi", ".wmv", ".flv", ".mpg", ".ts"]) {
      expect(castKind(file("video/unknown", ext))).toBeNull();
    }
  });

  it("falls back to the mime subtype when the name has no extension", () => {
    expect(castKind(file("video/x-matroska", null))).toBe("video");
    expect(castKind(file("audio/mpeg", null))).toBe("audio");
    expect(castKind(file("image/jpeg", null))).toBe("image");
  });

  it("never casts a document", () => {
    expect(castKind(file("application/pdf", ".pdf"))).toBeNull();
    expect(castKind(file("text/plain", ".txt"))).toBeNull();
  });
});

describe("castAllowed", () => {
  it("never hands a view-only file to another screen", () => {
    expect(castAllowed(file("video/mp4", ".mp4", "view_only"), null)).toBe(false);
    expect(castAllowed(file("video/mp4", ".mp4", "view_only"), "token")).toBe(false);
  });

  it("waits for a locked file's unlock", () => {
    expect(castAllowed(file("video/mp4", ".mp4", "full_lock"), null)).toBe(false);
    expect(castAllowed(file("video/mp4", ".mp4", "full_lock"), "token")).toBe(true);
  });

  it("allows a plain file", () => {
    expect(canCast(file("video/mp4", ".mp4"), null)).toBe(true);
  });
});

describe("castContentType", () => {
  it("keeps a real media mime", () => {
    expect(castContentType(file("video/webm", ".webm"))).toBe("video/webm");
  });

  it("fills in a generic mime from the extension", () => {
    expect(castContentType(file("application/octet-stream", ".mp4"))).toBe("video/mp4");
    expect(castContentType(file("", ".m4a"))).toBe("audio/mp4");
  });
});

describe("canAirPlay", () => {
  it("is an iPhone feature", () => {
    expect(canAirPlay(file("video/mp4", ".mp4"), null, "android")).toBe(false);
    expect(canAirPlay(file("video/mp4", ".mp4"), null, "ios")).toBe(true);
  });

  it("covers audio, whatever the format, since the system routes the sound", () => {
    expect(canAirPlay(file("audio/x-ms-wma", ".wma"), null, "ios")).toBe(true);
  });

  // A Matroska file plays through libVLC on iOS, which never reaches AVPlayer.
  it("leaves out a video only libVLC can open", () => {
    expect(canAirPlay(file("video/x-matroska", ".mkv"), null, "ios")).toBe(false);
  });

  it("leaves out photos, which need Screen Mirroring", () => {
    expect(canAirPlay(file("image/jpeg", ".jpg"), null, "ios")).toBe(false);
  });

  it("follows the same lock rules as casting", () => {
    expect(canAirPlay(file("video/mp4", ".mp4", "view_only"), null, "ios")).toBe(false);
  });
});
