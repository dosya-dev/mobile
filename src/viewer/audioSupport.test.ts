import { audioPlayable } from "./audioSupport";

describe("audioPlayable", () => {
  it("denylists the formats AVPlayer cannot decode, on iOS only", () => {
    for (const e of [".ogg", ".oga", ".opus", ".wma", ".mka"]) {
      expect(audioPlayable("application/octet-stream", e, "ios")).toBe(false);
      expect(audioPlayable("application/octet-stream", e, "android")).toBe(true);
    }
  });

  it("gives everything AVPlayer does decode the benefit of the doubt", () => {
    for (const e of [".mp3", ".m4a", ".aac", ".wav", ".flac", ".aiff"]) {
      expect(audioPlayable("audio/mpeg", e, "ios")).toBe(true);
    }
    // Unknown formats are handed to the player rather than pre-refused.
    expect(audioPlayable("audio/x-something-new", ".xyz", "ios")).toBe(true);
  });

  it("falls back to the mime subtype when the filename says nothing", () => {
    expect(audioPlayable("audio/ogg", null, "ios")).toBe(false);
    expect(audioPlayable("audio/opus", "", "ios")).toBe(false);
    expect(audioPlayable("audio/x-ms-wma", null, "ios")).toBe(false);
    expect(audioPlayable("audio/x-matroska", null, "ios")).toBe(false);
    expect(audioPlayable("audio/mpeg", null, "ios")).toBe(true);
  });

  it("an extension it recognises outranks the mime", () => {
    // A server that labels an .ogg as audio/mpeg does not make it decodable.
    expect(audioPlayable("audio/mpeg", ".ogg", "ios")).toBe(false);
  });
});
