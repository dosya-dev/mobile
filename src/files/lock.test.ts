jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok") }));
jest.mock("@/api", () => ({ API_BASE_URL: "https://api.example.com" }));

import { getAccessToken } from "@/auth/authStore";
import { canDownload, isFullLock, isKnownLocked, isViewOnly, needsUnlock, viewOnlySource } from "./lock";
import { mayPersistBytes } from "./cachePolicy";

const f = (lock_mode: string) => ({ id: "f1", lock_mode, current_version: 3 });

describe("needsUnlock", () => {
  // The defect this module exists to prevent: mobile computed
  // `lock_mode !== "none"` and gated view_only behind the same wall as
  // full_lock, so a view-only file could not be opened at all.
  it.each([
    ["none", null, false],
    ["none", "tok", false],
    ["view_only", null, false],
    ["view_only", "tok", false],
    ["full_lock", null, true],
    ["full_lock", "tok", false],
  ])("%s with token=%s -> %s", (mode, token, expected) => {
    expect(needsUnlock(f(mode), token)).toBe(expected);
  });

  it("treats an empty-string token as no token", () => {
    expect(needsUnlock(f("full_lock"), "")).toBe(true);
  });
});

describe("canDownload", () => {
  it.each([
    ["none", true],
    ["view_only", false],
    ["full_lock", true],
  ])("%s -> %s", (mode, expected) => {
    expect(canDownload(f(mode))).toBe(expected);
  });
});

describe("mode predicates", () => {
  it("distinguishes the two locked modes", () => {
    expect(isViewOnly(f("view_only"))).toBe(true);
    expect(isViewOnly(f("full_lock"))).toBe(false);
    expect(isFullLock(f("full_lock"))).toBe(true);
    expect(isFullLock(f("view_only"))).toBe(false);
  });

  it("treats an unrecognized mode as not locked rather than guessing", () => {
    expect(isViewOnly(f("something_new"))).toBe(false);
    expect(isFullLock(f("something_new"))).toBe(false);
    expect(needsUnlock(f("something_new"), null)).toBe(false);
  });
});

describe("viewOnlySource", () => {
  it("points view-only files at /raw with a bearer header", () => {
    // download-url 403s view_only before presigning, so /raw is the only
    // endpoint that will hand over these bytes - and it needs the header.
    expect(viewOnlySource(f("view_only"))).toEqual({
      uri: "https://api.example.com/api/files/f1/raw?version=3",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("returns null for modes that should presign instead", () => {
    expect(viewOnlySource(f("none"))).toBeNull();
    expect(viewOnlySource(f("full_lock"))).toBeNull();
  });

  it("omits the header when signed out rather than sending 'Bearer null'", () => {
    (getAccessToken as jest.Mock).mockReturnValueOnce(null);
    expect(viewOnlySource(f("view_only"))?.headers).toEqual({});
  });
});

describe("isKnownLocked", () => {
  const f = (lock_mode: string) => ({ lock_mode });

  it("badges the two real restrictions", () => {
    expect(isKnownLocked(f("view_only"))).toBe(true);
    expect(isKnownLocked(f("full_lock"))).toBe(true);
  });

  it("leaves an unrestricted file unbadged", () => {
    expect(isKnownLocked(f("none"))).toBe(false);
  });

  // The two questions fail in OPPOSITE directions on purpose. A list endpoint
  // that omits the column yields "unknown": too risky to cache, too uncertain
  // to badge. Getting this backwards either leaks view-only bytes to disk or
  // paints a padlock on every search result.
  it("stays quiet when the server did not say", () => {
    expect(isKnownLocked(f("unknown"))).toBe(false);
    expect(mayPersistBytes(f("unknown"))).toBe(false);
  });
});
