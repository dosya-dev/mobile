import {
  MAX_PREVIEW_ATTEMPTS, nextPreviewState, officePreviewPath,
  type OfficePreviewState,
} from "./officePreview";

const preparing = (attempt = 0): OfficePreviewState => ({ kind: "preparing", attempt });

describe("MAX_PREVIEW_ATTEMPTS", () => {
  it("is derived from the server's lock TTL over its Retry-After, not picked", () => {
    // CONVERT_LOCK_TTL_SECONDS = 60, Retry-After: 3
    expect(MAX_PREVIEW_ATTEMPTS).toBe(20);
  });
});

describe("nextPreviewState", () => {
  it("treats 200 as ready", () => {
    expect(nextPreviewState(preparing(), { status: 200 })).toEqual({ kind: "ready" });
  });

  it("treats 503 as still converting and counts the attempt", () => {
    expect(nextPreviewState(preparing(0), { status: 503 })).toEqual({ kind: "preparing", attempt: 1 });
    expect(nextPreviewState(preparing(5), { status: 503 })).toEqual({ kind: "preparing", attempt: 6 });
  });

  it("gives up once the derived bound is exhausted rather than spinning forever", () => {
    const s = nextPreviewState(preparing(MAX_PREVIEW_ATTEMPTS - 1), { status: 503 });
    expect(s.kind).toBe("failed");
    expect(s.kind === "failed" && s.message).toMatch(/taking too long/i);
  });

  it("distinguishes too-large from a generic failure", () => {
    // 422 + code, NOT 413. A client keying on 413 shows "unknown error" for an
    // ordinary 60MB deck.
    expect(nextPreviewState(preparing(), { status: 422, code: "too_large" }))
      .toEqual({ kind: "too-large" });
  });

  it("treats a 422 without the code as a plain failure, not as too-large", () => {
    expect(nextPreviewState(preparing(), { status: 422 }).kind).toBe("failed");
  });

  it("treats 415 as unsupported, which is a fallback and not an error", () => {
    expect(nextPreviewState(preparing(), { status: 415 })).toEqual({ kind: "unsupported" });
  });

  it("does not swallow 403 or 404 into 'unsupported'", () => {
    // Those are the lock gate and the not-found path; conflating them would tell
    // a user their file cannot be previewed when it is actually locked.
    expect(nextPreviewState(preparing(), { status: 403 }).kind).toBe("failed");
    expect(nextPreviewState(preparing(), { status: 404 }).kind).toBe("failed");
  });

  it("never leaves a terminal state", () => {
    for (const terminal of [
      { kind: "ready" } as const,
      { kind: "too-large" } as const,
      { kind: "unsupported" } as const,
    ]) {
      expect(nextPreviewState(terminal, { status: 503 })).toEqual(terminal);
    }
  });

  it("never returns an empty message on a failure", () => {
    for (const status of [0, 400, 403, 404, 500]) {
      const s = nextPreviewState(preparing(), { status });
      expect(s.kind).toBe("failed");
      if (s.kind === "failed") expect(s.message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("officePreviewPath", () => {
  it("points at the conversion endpoint for the file", () => {
    expect(officePreviewPath("file_1")).toBe("/api/files/file_1/preview-pdf");
  });
});
