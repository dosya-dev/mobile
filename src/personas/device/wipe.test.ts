import type { KeyStore, LocalCache } from "@dosya-dev/personas-engine";
import { clearKeyIfLastWorkspace, wipePersonasDevice } from "./wipe";

function fakes() {
  const keys = new Map<string, Uint8Array>([["u1", new Uint8Array([1])], ["u2", new Uint8Array([2])]]);
  const snaps = new Map<string, Uint8Array>([["u1:w1", new Uint8Array([9])], ["u1:w2", new Uint8Array([9])], ["u2:w1", new Uint8Array([8])]]);
  const keyStore: KeyStore = {
    get: async (u) => keys.get(u) ?? null,
    set: async (u, k) => { keys.set(u, k); },
    clear: async (u) => { keys.delete(u); },
  };
  const cache: LocalCache = {
    load: async (u, w) => snaps.get(`${u}:${w}`) ?? null,
    save: async (u, w, s) => { snaps.set(`${u}:${w}`, s); },
    clear: async (u) => { for (const k of [...snaps.keys()]) if (k.startsWith(`${u}:`)) snaps.delete(k); },
  };
  return { keys, snaps, keyStore, cache };
}

describe("wipePersonasDevice", () => {
  it("removes the user's key and snapshots and leaves another user's", async () => {
    const f = fakes();
    await wipePersonasDevice("u1", { keys: f.keyStore, cache: f.cache });
    expect(await f.keyStore.get("u1")).toBeNull();
    expect(await f.cache.load("u1", "w1")).toBeNull();
    expect(await f.cache.load("u1", "w2")).toBeNull();
    expect(await f.keyStore.get("u2")).not.toBeNull();
    expect(await f.cache.load("u2", "w1")).not.toBeNull();
  });

  it("does nothing without a user; a failing key store still clears the cache and nothing throws", async () => {
    const f = fakes();
    await expect(wipePersonasDevice(null, { keys: f.keyStore, cache: f.cache })).resolves.toBeUndefined();
    expect(f.keys.size).toBe(2);
    const broken: KeyStore = { ...f.keyStore, clear: async () => { throw new Error("keychain locked"); } };
    await expect(wipePersonasDevice("u1", { keys: broken, cache: f.cache })).resolves.toBeUndefined();
    expect(await f.cache.load("u1", "w1")).toBeNull();
  });
});

describe("clearKeyIfLastWorkspace", () => {
  it("clears the key only when the device holds no other snapshot for the user", async () => {
    const f = fakes();
    const deps = { keys: f.keyStore, hasSnapshots: async (u: string) => [...f.snaps.keys()].some((k) => k.startsWith(`${u}:`)) };
    await clearKeyIfLastWorkspace("u1", deps);
    expect(await f.keyStore.get("u1")).not.toBeNull();
    await f.cache.clear("u1");
    await clearKeyIfLastWorkspace("u1", deps);
    expect(await f.keyStore.get("u1")).toBeNull();
    expect(await f.keyStore.get("u2")).not.toBeNull();
  });

  it("never throws", async () => {
    const f = fakes();
    await expect(clearKeyIfLastWorkspace("u1", { keys: f.keyStore, hasSnapshots: async () => { throw new Error("db locked"); } })).resolves.toBeUndefined();
    await expect(clearKeyIfLastWorkspace(null)).resolves.toBeUndefined();
  });
});
