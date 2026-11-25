import { isHeic, viewerImagePlaceholder, viewerImageSource } from "./imageSource";
import { fileRawUrl } from "@/files/fileUrl";
import type { FileDetail } from "@/files/types";

jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok_live" }));
jest.mock("@/api", () => ({ API_BASE_URL: "https://api.test" }));

function makeFile(over: Partial<FileDetail> = {}): FileDetail {
  return {
    id: "f1", name: "photo.jpg", size_bytes: 2_500_000, mime_type: "image/jpeg", extension: ".jpg",
    created_at: 1, updated_at: 1, current_version: 3, lock_mode: "none", share_count: 0, comment_count: 0,
    ...over,
  };
}

describe("isHeic", () => {
  it("matches by mime or by extension, dot-prefixed or not", () => {
    expect(isHeic("image/heic", null)).toBe(true);
    expect(isHeic("image/heif", null)).toBe(true);
    expect(isHeic("application/octet-stream", ".HEIC")).toBe(true);
    expect(isHeic("application/octet-stream", "heif")).toBe(true);
    expect(isHeic("image/jpeg", ".jpg")).toBe(false);
  });
});

describe("viewerImageSource", () => {
  // This is the whole point of the module. FileThumb caches `/raw` on disk from
  // the list; if the viewer asks for anything else, that cache never hits and
  // every photo is re-downloaded in full.
  it("asks for byte-for-byte the URL the file list already cached", () => {
    const file = makeFile();
    expect(viewerImageSource(file).uri).toBe(fileRawUrl(file.id, file.current_version));
  });

  it("is stable across calls, unlike a presigned URL", () => {
    const file = makeFile();
    expect(viewerImageSource(file).uri).toBe(viewerImageSource(file).uri);
  });

  it("carries the bearer, since /raw is an authenticated route", () => {
    expect(viewerImageSource(makeFile()).headers).toEqual({ Authorization: "Bearer tok_live" });
  });

  it("pins the version so a new upload is never served from the old cache entry", () => {
    expect(viewerImageSource(makeFile({ current_version: 7 })).uri).toContain("version=7");
  });

  // HEIC is the one format the server actually decodes; Android cannot render
  // the original at all.
  it("asks for a large decoded derivative for HEIC", () => {
    const uri = viewerImageSource(makeFile({ mime_type: "image/heic", extension: ".heic" })).uri;
    expect(uri).toContain("/thumb?");
    expect(uri).toContain("w=1600");
  });

  it("passes the unlock token through, or /raw 403s a full_lock file", () => {
    const uri = viewerImageSource(makeFile({ lock_mode: "full_lock" }), "ut_abc").uri;
    expect(uri).toContain("ut=ut_abc");
  });

  it("adds no token when there is none", () => {
    expect(viewerImageSource(makeFile()).uri).not.toContain("ut=");
  });
});

describe("viewerImagePlaceholder", () => {
  it("offers the list's small derivative under a HEIC", () => {
    const p = viewerImagePlaceholder(makeFile({ mime_type: "image/heic", extension: ".heic" }));
    expect(p?.uri).toContain("w=512");
  });

  // A JPEG's embedded preview is what the LIST fetched, so it is already on
  // disk and the photo appears instantly instead of on an empty stage.
  it("reuses the list's embedded preview for a JPEG, at the same width", () => {
    const p = viewerImagePlaceholder(makeFile());
    expect(p?.uri).toContain("w=128");
  });

  // For these the list cached the SAME bytes the viewer wants, so there is
  // nothing smaller to show and nothing to wait for.
  it("offers nothing for a format with no smaller derivative", () => {
    expect(viewerImagePlaceholder(makeFile({ mime_type: "image/png", extension: ".png" }))).toBeNull();
  });
});
