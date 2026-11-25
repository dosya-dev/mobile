const mockApiRequest = jest.fn();
jest.mock("@/api", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  API_BASE_URL: "https://api.test",
}));
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

import { linkFilesProvider, relinkFilesProvider, unlinkFilesProvider, __resetFilesProviderLink, type FilesProviderNative } from "./link";

function fakeNative(storedUser: string | null, supported = true) {
  let stored: string | null = storedUser;
  const calls: string[] = [];
  const native: FilesProviderNative & { written: string | null } = {
    written: null,
    isSupported: () => supported,
    storedUserId: () => stored,
    writeSession: (json: string) => {
      calls.push("write");
      native.written = json;
      stored = JSON.parse(json).userId;
    },
    clearSession: () => { calls.push("clear"); stored = null; },
    registerDomain: async () => { calls.push("register"); return true; },
    removeDomain: async () => { calls.push("remove"); return true; },
    signalChanges: async () => { calls.push("signal"); return true; },
  };
  return { native, calls };
}

beforeEach(() => {
  mockApiRequest.mockReset();
  __resetFilesProviderLink();
});

describe("linkFilesProvider", () => {
  it("links through any supported native module, not only the iOS one", async () => {
    // The Android DocumentsProvider implements the same interface; nothing in
    // this flow may check the platform.
    mockApiRequest.mockResolvedValueOnce({ ok: true, access_token: "a", refresh_token: "r" });
    const { native, calls } = fakeNative(null);
    await linkFilesProvider("u1", native);
    expect(mockApiRequest).toHaveBeenCalledWith("/api/auth/mobile/linked-session", { method: "POST", body: { purpose: "files" } });
    expect(JSON.parse(native.written!)).toEqual({ access: "a", refresh: "r", apiBaseUrl: "https://api.test", userId: "u1" });
    expect(calls).toEqual(["write", "register"]);
  });

  it("does nothing without the native module (Android, Expo Go, jest)", async () => {
    await linkFilesProvider("u1", null);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("does nothing on iOS 15, where the replicated File Provider API does not exist", async () => {
    const { native, calls } = fakeNative(null, false);
    await linkFilesProvider("u1", native);
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("mints a linked session and registers the location when none is stored", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, access_token: "dosm_a", refresh_token: "dosr_r" });
    const { native, calls } = fakeNative(null);
    await linkFilesProvider("u1", native);

    expect(mockApiRequest).toHaveBeenCalledWith("/api/auth/mobile/linked-session", {
      method: "POST",
      body: { purpose: "files" },
    });
    expect(JSON.parse(native.written!)).toEqual({
      access: "dosm_a", refresh: "dosr_r", apiBaseUrl: "https://api.test", userId: "u1",
    });
    expect(calls).toEqual(["write", "register"]);
  });

  it("reuses a session already stored for the same account instead of revoking it", async () => {
    // A re-mint revokes the extension's current session server-side, so doing it
    // on every launch would break any upload Files had in flight.
    const { native, calls } = fakeNative("u1");
    await linkFilesProvider("u1", native);
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(calls).toEqual(["register", "signal"]);
  });

  it("removes another account's location and files before linking the new account", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, access_token: "dosm_b", refresh_token: "dosr_b" });
    const { native, calls } = fakeNative("someone-else");
    await linkFilesProvider("u2", native);
    expect(calls).toEqual(["clear", "remove", "write", "register"]);
    expect(JSON.parse(native.written!).userId).toBe("u2");
  });

  it("swallows a failed mint so sign-in is never blocked", async () => {
    mockApiRequest.mockRejectedValue(new Error("offline"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { native, calls } = fakeNative(null);
    await expect(linkFilesProvider("u1", native)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(calls).toEqual([]);
    warn.mockRestore();
  });

  it("shares one in-flight link between concurrent callers", async () => {
    let resolve!: (v: unknown) => void;
    mockApiRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { native } = fakeNative(null);
    const a = linkFilesProvider("u1", native);
    const b = linkFilesProvider("u1", native);
    resolve({ ok: true, access_token: "dosm_a", refresh_token: "dosr_r" });
    await Promise.all([a, b]);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });
});

describe("unlinkFilesProvider", () => {
  it("clears the session and removes the location", async () => {
    const { native, calls } = fakeNative("u1");
    await unlinkFilesProvider("u1", native);
    expect(calls).toEqual(["clear", "remove"]);
  });

  it("clears whoever is stored when the purged account is unknown", async () => {
    const { native, calls } = fakeNative("u1");
    await unlinkFilesProvider(null, native);
    expect(calls).toEqual(["clear", "remove"]);
  });

  it("never throws, even when the native call fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { native } = fakeNative("u1");
    native.removeDomain = async () => { throw new Error("boom"); };
    await expect(unlinkFilesProvider("u1", native)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("an account switch cannot purge the session the new account just linked", async () => {
    // The shell fires the old account's purge and the new account's link in the
    // same render. Whichever order they run in, the new account ends up linked.
    mockApiRequest.mockResolvedValue({ ok: true, access_token: "dosm_b", refresh_token: "dosr_b" });
    const { native, calls } = fakeNative("old");
    const link = linkFilesProvider("new", native);
    const purge = unlinkFilesProvider("old", native);
    await Promise.all([link, purge]);
    expect(native.storedUserId()).toBe("new");
    expect(calls[calls.length - 1]).toBe("register");
  });

  it("purge first, then link, also leaves the new account linked", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, access_token: "dosm_b", refresh_token: "dosr_b" });
    const { native, calls } = fakeNative("old");
    const purge = unlinkFilesProvider("old", native);
    const link = linkFilesProvider("new", native);
    await Promise.all([purge, link]);
    expect(native.storedUserId()).toBe("new");
    expect(calls).toEqual(["clear", "remove", "write", "register"]);
  });
});

describe("relinkFilesProvider (fresh sign-in)", () => {
  // The extension's session is a CHILD of the app's session and dies with it.
  // After a forced sign-out (the server rejected the app's refresh token) the
  // keychain still holds the dead child under the same user id, so a plain
  // link would keep it and Files would say "authentication required" forever.
  it("mints a new session even when one is stored for the same account", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, access_token: "dosm_new", refresh_token: "dosr_new" });
    const { native, calls } = fakeNative("u1");
    await relinkFilesProvider("u1", native);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(JSON.parse(native.written!)).toMatchObject({ access: "dosm_new", refresh: "dosr_new", userId: "u1" });
    // No "remove": the location and its downloaded files belong to this same
    // account and must survive the re-mint.
    expect(calls).toEqual(["write", "register"]);
  });

  it("keeps the stored session when the mint fails", async () => {
    mockApiRequest.mockRejectedValue(new Error("offline"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { native, calls } = fakeNative("u1");
    await expect(relinkFilesProvider("u1", native)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    expect(native.storedUserId()).toBe("u1");
    warn.mockRestore();
  });

  it("a plain link arriving during the re-mint joins it instead of minting again", async () => {
    // Sign-in calls relink, then the layout effect calls link for the same id.
    let resolve!: (v: unknown) => void;
    mockApiRequest.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { native, calls } = fakeNative("u1");
    const a = relinkFilesProvider("u1", native);
    const b = linkFilesProvider("u1", native);
    resolve({ ok: true, access_token: "dosm_new", refresh_token: "dosr_new" });
    await Promise.all([a, b]);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["write", "register"]);
  });
});
