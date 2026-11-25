import { BUFFER_TIMEOUT_MS, containerLabel, videoPlayable } from "./videoSupport";

describe("videoPlayable", () => {
  it("plays the formats every phone has a decoder for", () => {
    for (const os of ["ios", "android"] as const) {
      expect(videoPlayable("video/mp4", ".mp4", os)).toBe(true);
      expect(videoPlayable("video/quicktime", ".mov", os)).toBe(true);
    }
  });

  // AVPlayer has no Matroska demuxer at all, so a .mkv renders as a black
  // rectangle that never starts - indistinguishable from a slow connection,
  // which is exactly how it got reported as "big videos don't play".
  it("knows an iPhone cannot open a Matroska file", () => {
    expect(videoPlayable("video/x-matroska", ".mkv", "ios")).toBe(false);
  });

  it("knows ExoPlayer opens the same file happily", () => {
    expect(videoPlayable("video/x-matroska", ".mkv", "android")).toBe(true);
  });

  it("rules out the other containers iOS has no demuxer for", () => {
    for (const ext of [".avi", ".wmv", ".flv", ".mpg"]) {
      expect(videoPlayable("video/unknown", ext, "ios")).toBe(false);
    }
  });

  // WebM is Android-only in practice; VP8/VP9 in a WebM container is not
  // something AVPlayer will open.
  it("rules out WebM on iOS and allows it on Android", () => {
    expect(videoPlayable("video/webm", ".webm", "ios")).toBe(false);
    expect(videoPlayable("video/webm", ".webm", "android")).toBe(true);
  });

  // An unknown extension is not evidence of a problem. Refusing to try would
  // turn a file that plays fine into one the app claims it cannot open.
  it("gives an unrecognised file the benefit of the doubt", () => {
    expect(videoPlayable("video/mp4", null, "ios")).toBe(true);
    expect(videoPlayable("video/something-new", ".xyz", "ios")).toBe(true);
  });

  it("is not confused by an extension the API sent dot-prefixed or upper case", () => {
    expect(videoPlayable("video/x-matroska", "MKV", "ios")).toBe(false);
    expect(videoPlayable("video/x-matroska", ".MKV", "ios")).toBe(false);
  });
});

describe("containerLabel", () => {
  it("names the format in words the message can use", () => {
    expect(containerLabel("video/x-matroska", ".mkv")).toBe("Matroska");
    expect(containerLabel("video/webm", ".webm")).toBe("WebM");
  });

  it("falls back to the bare extension rather than an empty sentence", () => {
    expect(containerLabel("video/unknown", ".xyz")).toBe("XYZ");
  });
});

describe("BUFFER_TIMEOUT_MS", () => {
  // To first FRAME, not first byte. Under this the native spinner is enough.
  it("waits fifteen seconds before admitting it does not know", () => {
    expect(BUFFER_TIMEOUT_MS).toBe(15_000);
  });
});
