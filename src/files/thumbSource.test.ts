import { EMBEDDED_THUMB_SIZE, thumbCandidates } from "./thumbSource";
import type { FileItem } from "./types";

jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok_live" }));
jest.mock("@/api", () => ({ API_BASE_URL: "https://api.test" }));

function file(over: Partial<FileItem> = {}): FileItem {
  return {
    id: "f1", name: "photo.jpg", size_bytes: 3_000_000, mime_type: "image/jpeg", extension: ".jpg",
    created_at: 1, updated_at: 1, current_version: 4, lock_mode: "none", share_count: 0, comment_count: 0,
    ...over,
  };
}

// The server answers from the camera's embedded EXIF preview ONLY at this
// width and only for image/jpeg. Ask for anything else and it 302s to /raw and
// ships the multi-megabyte original, which is what made a hundred-photo folder
// take minutes on mobile and seconds in a browser.
describe("the embedded-preview width", () => {
  it("is the width the server's fast path requires", () => {
    expect(EMBEDDED_THUMB_SIZE).toBe(128);
  });

  it("is what a JPEG list row asks for first", () => {
    const [first] = thumbCandidates(file(), "list");
    expect(first.uri).toContain("/thumb?");
    expect(first.uri).toContain("w=128");
  });

  // A grid tile is bigger, and the server decodes JPEG now - so it asks for a
  // real 512 derivative rather than upscaling the ~160px EXIF preview. The list
  // keeps 128, where the preview still answers with no decode at all.
  it("lets a JPEG grid tile ask for a real resize", () => {
    expect(thumbCandidates(file(), "grid")[0].uri).toContain("w=512");
    expect(thumbCandidates(file(), "list")[0].uri).toContain("w=128");
  });
});

describe("thumbCandidates", () => {
  it("falls back to the original for a JPEG with no embedded preview", () => {
    const c = thumbCandidates(file(), "list");
    expect(c).toHaveLength(2);
    expect(c[1].uri).toContain("/raw");
  });

  it("matches a JPEG by extension when the mime is unhelpful", () => {
    const c = thumbCandidates(file({ mime_type: "application/octet-stream", extension: ".JPEG" }), "list");
    expect(c[0].uri).toContain("w=128");
  });

  // HEIC is the one format the server really decodes, and Android cannot
  // render the original at all - so there is nothing to fall back TO.
  it("asks only the server for HEIC, and sizes it to the surface", () => {
    const heic = file({ mime_type: "image/heic", extension: ".heic" });
    const list = thumbCandidates(heic, "list");
    const grid = thumbCandidates(heic, "grid");
    expect(list).toHaveLength(1);
    expect(list[0].uri).toContain("w=128");
    expect(grid[0].uri).toContain("w=512");
  });

  // The server generates a real WebP derivative for PNG now, so it gets the
  // cheap path too - and unlike JPEG's fixed-size EXIF preview, a bigger
  // request is a bigger resize rather than a fall off the fast path.
  it("asks the server to resize a PNG, sized to the surface", () => {
    const png = file({ mime_type: "image/png", extension: ".png" });
    expect(thumbCandidates(png, "list")[0].uri).toContain("w=128");
    expect(thumbCandidates(png, "grid")[0].uri).toContain("w=512");
    // Still falls back: an oversize PNG is refused by the pixel budget.
    expect(thumbCandidates(png, "list")[1].uri).toContain("/raw");
  });

  // No derivative path exists for these server-side, so /thumb would buy only
  // a redirect that drops the auth header.
  it("goes straight to the original for formats with no fast path", () => {
    for (const [mime, ext] of [["image/webp", ".webp"], ["image/gif", ".gif"]]) {
      const c = thumbCandidates(file({ mime_type: mime, extension: ext }), "list");
      expect(c).toHaveLength(1);
      expect(c[0].uri).toContain("/raw");
    }
  });

  it("carries the bearer on every candidate - both routes are authenticated", () => {
    for (const c of thumbCandidates(file(), "list")) {
      expect(c.headers).toEqual({ Authorization: "Bearer tok_live" });
    }
  });

  it("pins the version, so a new upload is never served from the old cache entry", () => {
    for (const c of thumbCandidates(file({ current_version: 9 }), "list")) {
      expect(c.uri).toContain("version=9");
    }
  });

  it("is stable across calls, so the disk cache can actually hit", () => {
    expect(thumbCandidates(file(), "list")[0].uri).toBe(thumbCandidates(file(), "list")[0].uri);
  });
});
