import { imageCachePolicy, mayPersistBytes } from "./cachePolicy";

const file = (lock_mode: string) => ({ lock_mode });

describe("mayPersistBytes", () => {
  it("lets an ordinary file cache to disk", () => {
    expect(mayPersistBytes(file("none"))).toBe(true);
  });

  // view_only means the owner turned downloads OFF. A disk-cached copy
  // outlives the session and survives the app closing - it IS the saved copy
  // the mode exists to prevent.
  it("keeps a view-only file off the disk", () => {
    expect(mayPersistBytes(file("view_only"))).toBe(false);
  });

  it("keeps a password-locked file off the disk", () => {
    expect(mayPersistBytes(file("full_lock"))).toBe(false);
  });

  // A mode this module has never heard of must not be treated as unrestricted:
  // a new lock mode added server-side would otherwise start caching silently.
  it("refuses to persist a lock mode it does not recognise", () => {
    expect(mayPersistBytes(file("some_future_mode"))).toBe(false);
  });
});

describe("imageCachePolicy", () => {
  it("maps the decision onto expo-image's policies", () => {
    expect(imageCachePolicy(file("none"))).toBe("memory-disk");
    expect(imageCachePolicy(file("view_only"))).toBe("memory");
    expect(imageCachePolicy(file("full_lock"))).toBe("memory");
  });
});
