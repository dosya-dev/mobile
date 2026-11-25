jest.mock("@/lib/keychain", () => { const m = new Map<string, string>(); return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, deleteItem: async (k: string) => { m.delete(k); }, __map: m }; });
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: { getState: () => ({ activeId: "gw-1" }) } }));
jest.mock("./fileSource", () => ({ fileSourceFromUri: jest.fn(async () => ({ totalSize: 3, boundaries: [{ offset: 0, size: 3 }], read: async () => new Uint8Array(3), close: jest.fn() })) }));
jest.mock("./cache", () => {
  const files = new Map<string, number>();
  return {
    cachePathFor: (ws: string, id: string, v: number, name: string) => ({ dir: `/c/${ws}/${id}-v${v}`, fileName: name }),
    cachedFile: async (t: { dir: string; fileName: string }) => (files.has(`${t.dir}/${t.fileName}`) ? `${t.dir}/${t.fileName}` : null),
    createCacheSink: (t: { dir: string; fileName: string }) => { let n = 0; return { sink: async (b: Uint8Array) => { n += b.length; }, finish: async () => { files.set(`${t.dir}/${t.fileName}`, n); return `${t.dir}/${t.fileName}`; }, abort: jest.fn(async () => {}) }; },
    wipeVaultCache: jest.fn(async () => { files.clear(); }),
  };
});
jest.mock("./engine", () => ({ createVaultEngine: () => ({}) }));

import type { AppState } from "react-native";
import { useVault, startVaultBackgroundLock, BACKGROUND_LOCK_MS, lockVaultForPurge, type Transfer } from "./store";
import type { VaultEngine, VaultEntry } from "./engine";
import { wipeVaultCache } from "./cache";

type FakeEngine = VaultEngine & { calls: string[]; gateUnlock(gate: Promise<void> | null): void };

/**
 * Mirrors the REAL engine's epoch discipline (see engine.ts): lock() bumps an
 * epoch, and a ceremony that resolves after it discards its result and
 * rejects, instead of assigning a session. A fake that just set `unlocked`
 * would let the store's guards look right against an engine that cannot
 * behave that way.
 */
function fakeEngine(over: Partial<VaultEngine> = {}): FakeEngine {
  const calls: string[] = [];
  let unlocked = false;
  let epoch = 0;
  let unlockGate: Promise<void> | null = null;
  // The names the SPACES carry, as the server would hold them - kept apart
  // from the store's own list so the two can disagree, which is the whole
  // point of the reconciler.
  const spaceNames = new Map<string, string>();
  let openId: string | null = null;
  return {
    calls,
    gateUnlock(gate) { unlockGate = gate; },
    hasIdentity: async () => true,
    setup: async () => { const e = epoch; if (unlockGate) await unlockGate; if (e !== epoch) throw new Error("vault: locked"); unlocked = true; return { recoveryKeyHex: "deadbeef" }; },
    unlock: async (p) => {
      const e = epoch;
      if (unlockGate) await unlockGate;
      if (p !== "right") throw new Error("engine: unlock failed: secret detail");
      if (e !== epoch) throw new Error("vault: locked");
      unlocked = true;
    },
    unlockWithRecoveryKey: async () => { const e = epoch; if (unlockGate) await unlockGate; if (e !== epoch) throw new Error("vault: locked"); unlocked = true; },
    lock: () => { epoch += 1; unlocked = false; calls.push("lock"); },
    isUnlocked: () => unlocked,
    createWorkspace: async (id, name) => {
      calls.push(`create:${id}${name === undefined ? "" : `:${name}`}`);
      if (name !== undefined) spaceNames.set(id, name);
      openId = id;
    },
    setWorkspaceScope: async (id, gw) => { calls.push(`scope:${id}:${gw}`); },
    openWorkspace: async (id, sf) => { calls.push(`open:${id}:${sf}`); openId = id; },
    readWorkspaceName: async () => (openId === null ? null : spaceNames.get(openId) ?? null),
    readWorkspaceNameById: async (id) => spaceNames.get(id) ?? null,
    renameWorkspace: async (name) => {
      calls.push(`rename:${openId}:${name ?? "null"}`);
      if (openId === null) return;
      if (name === null) spaceNames.delete(openId);
      else spaceNames.set(openId, name);
    },
    listMyWorkspaces: async () => [{ workspaceId: "ws-shared", globalWorkspaceId: "gw-1", createdByMe: true }],
    listFolder: async () => [{ id: "f1", name: "a.jpg", kind: "file", size: 3, timestamp: 1 }],
    createFolder: async () => ({ folderId: "d-new" }),
    uploadFile: async (_f, name) => { calls.push(`upload:${name}`); return { fileId: "f-new" }; },
    downloadFileTo: async (_f, _e, sink) => { await sink(new Uint8Array([1, 2, 3]), 0); return { totalSize: 3 }; },
    deleteEntry: async (_f, id) => { calls.push(`delete:${id}`); },
    ...over,
  };
}

const file: VaultEntry = { id: "f1", name: "a.jpg", kind: "file", size: 3, timestamp: 1 };

/** Lets the promise chain inside lock() settle; never advances timers. */
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe("Vault store", () => {
  let engine: ReturnType<typeof fakeEngine>;
  beforeEach(async () => {
    engine = fakeEngine();
    useVault.setState({ status: "locked", hasIdentity: null, error: null, busy: false, spaces: [], activeSpaceId: null, entries: [], recoveryKeyOnce: null, transfers: {} });
    useVault.getState().__setEngine(engine);
    await useVault.getState().hydrate("acct-1");
  });

  it("checkIdentity keeps hasIdentity null and sets an error on a transient failure (never routes to setup)", async () => {
    useVault.getState().__setEngine(fakeEngine({ hasIdentity: async () => { throw new Error("offline"); } }));
    await useVault.getState().checkIdentity();
    expect(useVault.getState().hasIdentity).toBeNull();
    expect(useVault.getState().error).toBe("Could not check encryption status.");
    useVault.getState().__setEngine(engine);
    await useVault.getState().checkIdentity();
    expect(useVault.getState().hasIdentity).toBe(true);
  });

  // Setup shows the key in groups of four; typed back from paper it arrives
  // with spaces, which the hex decoder would reject.
  it("unlocks with a recovery key typed with spaces or line breaks", async () => {
    let got = "";
    useVault.getState().__setEngine(fakeEngine({ unlockWithRecoveryKey: async (k: string) => { got = k; } }));
    expect(await useVault.getState().unlockWithRecoveryKey(" 3f9a 1c7e\n8b20 ")).toBe(true);
    expect(got).toBe("3f9a1c7e8b20");
  });

  it("setup unlocks and exposes the recovery key once; dismiss clears it", async () => {
    expect(await useVault.getState().setup("p")).toBe(true);
    expect(useVault.getState().status).toBe("unlocked");
    expect(useVault.getState().recoveryKeyOnce).toBe("deadbeef");
    useVault.getState().dismissRecoveryKey();
    expect(useVault.getState().recoveryKeyOnce).toBeNull();
  });

  it("a failed unlock shows one generic sentence, never the engine's text", async () => {
    expect(await useVault.getState().unlock("wrong")).toBe(false);
    expect(useVault.getState().status).toBe("locked");
    expect(useVault.getState().error).toBe("Couldn't unlock. Check your passphrase and try again.");
    expect(JSON.stringify(useVault.getState())).not.toContain("secret detail");
  });

  it("createSpace anchors selfFounded=true, scopes to the active workspace, and persists per account", async () => {
    await useVault.getState().unlock("right");
    const id = await useVault.getState().createSpace("Photos");
    expect(id).toMatch(/^ws-[0-9a-f-]{36}$/);
    // The name goes to the engine too: it is sealed into the Space, so every
    // other device reads "Photos" rather than inventing a placeholder.
    expect(engine.calls).toEqual([`create:${id}:Photos`, `scope:${id}:gw-1`]);
    expect(useVault.getState().spaces).toEqual([{ id, name: "Photos", selfFounded: true, globalWorkspaceId: "gw-1", shared: false, stub: false }]);
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    expect(JSON.parse(__map.get("dosya.vault.workspaces.acct-1")!)).toEqual([{ id, name: "Photos", selfFounded: true, globalWorkspaceId: "gw-1", shared: false, stub: false }]);
  });

  it("refreshSpaces merges discovered Spaces as selfFounded=false even when the server says createdByMe, never touching known ones", async () => {
    await useVault.getState().unlock("right");
    useVault.setState({ spaces: [{ id: "ws-mine", name: "Mine", selfFounded: true, globalWorkspaceId: "gw-1", shared: false }] });
    await useVault.getState().refreshSpaces();
    expect(useVault.getState().spaces).toEqual([
      { id: "ws-mine", name: "Mine", selfFounded: true, globalWorkspaceId: "gw-1", shared: false },
      // Discovered, so the name is this phone's invention and is marked as one.
      { id: "ws-shared", name: "Space shared", selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true },
    ]);
    await useVault.getState().openSpace("ws-shared");
    expect(engine.calls).toContain("open:ws-shared:false");
    await useVault.getState().openSpace("ws-mine");
    expect(engine.calls).toContain("open:ws-mine:true");
  });

  it("mySpacesForActiveWorkspace filters by the active storage workspace and keeps unscoped legacy Spaces", () => {
    useVault.setState({ spaces: [
      { id: "a", name: "A", selfFounded: true, globalWorkspaceId: "gw-1", shared: false },
      { id: "b", name: "B", selfFounded: true, globalWorkspaceId: "gw-2", shared: false },
      { id: "c", name: "C", selfFounded: false, globalWorkspaceId: null, shared: false },
      { id: "d", name: "D", selfFounded: false, globalWorkspaceId: "gw-1", shared: true },
    ] });
    expect(useVault.getState().mySpacesForActiveWorkspace().map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("uploadFromUri streams from the file source, retries once after a 412 by scoping, and refreshes the folder", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    let first = true;
    engine.uploadFile = async (_f, name) => { if (first) { first = false; throw new Error("e2ee: chunk-upload-url request failed (412)"); } engine.calls.push(`upload:${name}`); return { fileId: "f-new" }; };
    expect(await useVault.getState().uploadFromUri("root", "pic.jpg", "file:///tmp/pic.jpg")).toBe(true);
    expect(engine.calls.filter((c) => c.startsWith("scope:")).length).toBe(2);
    expect(engine.calls).toContain("upload:pic.jpg");
    expect(useVault.getState().entries).toEqual([file]);
    expect(Object.values(useVault.getState().transfers)).toEqual([]);
  });

  it("an upload that fails leaves the listing unchanged and records a retryable error on the transfer", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    useVault.setState({ entries: [file] });
    engine.uploadFile = async () => { throw new Error("Network request failed"); };
    expect(await useVault.getState().uploadFromUri("root", "x.bin", "file:///tmp/x.bin")).toBe(false);
    expect(useVault.getState().entries).toEqual([file]);
    const t = Object.values(useVault.getState().transfers)[0];
    expect(t.error).toBe("Couldn't upload x.bin.");
    expect(t.retry).toEqual({ folderId: "root", fileUri: "file:///tmp/x.bin" });
    expect(useVault.getState().error).toBe("Couldn't upload x.bin.");
  });

  it("downloadToCache returns the cached uri on a second call without touching the engine", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    const spy = jest.spyOn(engine, "downloadFileTo");
    const uri1 = await useVault.getState().downloadToCache("root", file);
    expect(uri1).toMatch(/a\.jpg$/);
    const uri2 = await useVault.getState().downloadToCache("root", file);
    expect(uri2).toBe(uri1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("deleteEntry refreshes the folder; lock clears state and wipes the cache; purge also forgets the Spaces", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    expect(await useVault.getState().deleteEntry("root", file)).toBe(true);
    expect(engine.calls).toContain("delete:f1");
    await useVault.getState().lock();
    expect(useVault.getState().status).toBe("locked");
    expect(useVault.getState().activeSpaceId).toBeNull();
    expect(useVault.getState().entries).toEqual([]);
    expect(engine.calls.filter((c) => c === "lock").length).toBe(1);
    expect(wipeVaultCache).toHaveBeenCalled();
    await useVault.getState().unlock("right");
    await lockVaultForPurge("acct-1");
    expect(useVault.getState().status).toBe("locked");
    expect(useVault.getState().spaces).toEqual([]);
  });

  it("lockVaultForPurge deletes the given account's keychain entry even when hydrate was never called for it", async () => {
    // This session's beforeEach hydrated "acct-1"; simulate an account whose
    // Spaces list was written on a previous run but never hydrated here -
    // the module's own bookkeeping must not be what decides which key to delete.
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    __map.set("dosya.vault.workspaces.acct-2", JSON.stringify([{ id: "ws-x", name: "X", selfFounded: true, globalWorkspaceId: null, shared: false }]));
    await lockVaultForPurge("acct-2");
    expect(__map.has("dosya.vault.workspaces.acct-2")).toBe(false);
  });

  it("locks on resume once five minutes of wall clock passed in the background, with no timer fired, and not on a quick switch", async () => {
    // React Native pauses JS timers while the host is paused, so a 5-minute
    // setTimeout armed on `background` CANNOT fire during a real backgrounding.
    // The clock therefore moves here (setSystemTime) while timers do not
    // (never advanceTimersByTime): a timer-only implementation fails this.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-28T10:00:00Z"));
    const listeners: ((s: string) => void)[] = [];
    const appState = { addEventListener: (_: string, fn: (s: string) => void) => { listeners.push(fn); return { remove: () => {} }; } } as unknown as typeof AppState;
    const stop = startVaultBackgroundLock(appState);
    await useVault.getState().unlock("right");

    listeners[0]("background");
    jest.setSystemTime(Date.now() + 1000);
    listeners[0]("active");
    await flush();
    expect(useVault.getState().status).toBe("unlocked");

    listeners[0]("background");
    jest.setSystemTime(Date.now() + BACKGROUND_LOCK_MS + 1);
    listeners[0]("active");
    await flush();
    expect(useVault.getState().status).toBe("locked");

    stop();
    jest.useRealTimers();
  });

  it("still locks from the timer when the platform keeps JS alive in the background", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-28T10:00:00Z"));
    const listeners: ((s: string) => void)[] = [];
    const appState = { addEventListener: (_: string, fn: (s: string) => void) => { listeners.push(fn); return { remove: () => {} }; } } as unknown as typeof AppState;
    const stop = startVaultBackgroundLock(appState);
    await useVault.getState().unlock("right");
    listeners[0]("background");
    jest.advanceTimersByTime(BACKGROUND_LOCK_MS + 1);
    await flush();
    expect(useVault.getState().status).toBe("locked");
    stop();
    jest.useRealTimers();
  });

  it("an unlock resolving after a sign-out purge returns false, stays locked, and leaves the engine locked", async () => {
    let resolveGate!: () => void;
    engine.gateUnlock(new Promise<void>((resolve) => { resolveGate = resolve; }));

    const pending = useVault.getState().unlock("right");
    await lockVaultForPurge("acct-1");
    resolveGate();

    expect(await pending).toBe(false);
    expect(useVault.getState().status).toBe("locked");
    expect(useVault.getState().busy).toBe(false);
    // The engine locked itself (its own epoch); the store never asks it to -
    // asking would wipe whatever session is live by then.
    expect(engine.isUnlocked()).toBe(false);
  });

  it("a stale unlock resolving after a NEW one never locks the account that is signed in now", async () => {
    // The store must not call engine.lock() from a stale continuation: the
    // engine is a singleton, so that would wipe the live session of whoever
    // signed in after the purge.
    let resolveOld!: () => void;
    engine.gateUnlock(new Promise<void>((resolve) => { resolveOld = resolve; }));
    const stalePending = useVault.getState().unlock("right");

    await lockVaultForPurge("acct-1");
    engine.gateUnlock(null);
    expect(await useVault.getState().unlock("right")).toBe(true);
    expect(engine.isUnlocked()).toBe(true);

    resolveOld();

    expect(await stalePending).toBe(false);
    expect(engine.isUnlocked()).toBe(true);
    expect(useVault.getState().status).toBe("unlocked");
  });

  it("a refreshSpaces resolving after a purge writes nothing, and persists nothing under the next account's key", async () => {
    await useVault.getState().unlock("right");
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    let started = false;
    engine.listMyWorkspaces = async () => { started = true; await gate; return [{ workspaceId: "ws-old", globalWorkspaceId: "gw-1", createdByMe: true }]; };

    const pending = useVault.getState().refreshSpaces();
    while (!started) await Promise.resolve();
    await lockVaultForPurge("acct-1");
    await useVault.getState().hydrate("acct-2");
    resolveGate();
    await pending;

    expect(useVault.getState().spaces).toEqual([]);
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    expect(__map.has("dosya.vault.workspaces.acct-2")).toBe(false);
  });

  it("Retry reuses the failed transfer row: one row throughout, and none left once it succeeds", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    engine.uploadFile = async () => { throw new Error("Network request failed"); };

    expect(await useVault.getState().uploadFromUri("root", "x.bin", "file:///tmp/x.bin")).toBe(false);
    const rowId = Object.keys(useVault.getState().transfers)[0];
    expect(Object.keys(useVault.getState().transfers)).toEqual([rowId]);

    // A retry that fails again: still one row, still armed.
    expect(await useVault.getState().uploadFromUri("root", "x.bin", "file:///tmp/x.bin", rowId)).toBe(false);
    expect(Object.keys(useVault.getState().transfers)).toEqual([rowId]);
    expect(useVault.getState().transfers[rowId].retry).toEqual({ folderId: "root", fileUri: "file:///tmp/x.bin" });

    engine.uploadFile = async (_f, name) => { engine.calls.push(`upload:${name}`); return { fileId: "f-new" }; };
    expect(await useVault.getState().uploadFromUri("root", "x.bin", "file:///tmp/x.bin", rowId)).toBe(true);
    expect(Object.values(useVault.getState().transfers)).toEqual([]);
  });

  it("createSpace keeps a Space whose workspace attachment failed, unscoped, and says only that", async () => {
    await useVault.getState().unlock("right");
    useVault.setState({ spaces: [] });
    engine.setWorkspaceScope = async () => { throw new Error("network"); };

    const id = await useVault.getState().createSpace("Photos");

    expect(id).toMatch(/^ws-/);
    const expected = [{ id, name: "Photos", selfFounded: true, globalWorkspaceId: null, shared: false, stub: false }];
    expect(useVault.getState().spaces).toEqual(expected);
    expect(useVault.getState().activeSpaceId).toBe(id);
    expect(useVault.getState().error).toBe("Couldn't attach the Space to this workspace. Uploads will retry the attachment.");
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    expect(JSON.parse(__map.get("dosya.vault.workspaces.acct-1")!)).toEqual(expected);
  });

  it("clearEntries empties the listing without touching anything else", async () => {
    await useVault.getState().unlock("right");
    useVault.setState({ entries: [file], activeSpaceId: "ws-1" });
    useVault.getState().clearEntries();
    expect(useVault.getState().entries).toEqual([]);
    expect(useVault.getState().activeSpaceId).toBe("ws-1");
    expect(useVault.getState().status).toBe("unlocked");
  });

  it("lock() aborts in-flight downloads before wiping the cache, and the aborted download resolves null", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    const cacheMock = jest.requireMock("./cache") as typeof import("./cache");
    const spy = jest.spyOn(cacheMock, "createCacheSink");

    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    let downloadStarted = false;
    // Mirrors what happens for real: after lock() aborts this download's
    // cache sink, the sink's next write throws "vault: sink closed" (see
    // createCacheSink in ./cache). Simulated here directly on the engine
    // call so the test does not need to reimplement the sink's own state
    // machine.
    engine.downloadFileTo = async () => {
      downloadStarted = true;
      await gate;
      throw new Error("vault: sink closed");
    };

    const pending = useVault.getState().downloadToCache("root", file);
    while (!downloadStarted) await Promise.resolve();
    await useVault.getState().lock();
    resolveGate();
    const result = await pending;

    expect(result).toBeNull();
    expect(wipeVaultCache).toHaveBeenCalled();
    const { abort } = spy.mock.results[0].value as { abort: jest.Mock };
    expect(abort).toHaveBeenCalled();
    // The abort registered for THIS download must run before the wipe -
    // wipeVaultCache's own call history may already hold calls from earlier
    // tests in this file, so compare against its most recent (this test's) call.
    const wipeOrder = (wipeVaultCache as jest.Mock).mock.invocationCallOrder;
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(wipeOrder[wipeOrder.length - 1]);
    // Everything settles back to a clean, locked store - the suspended
    // continuation must not have written a stale error or transfer back in.
    expect(useVault.getState()).toMatchObject({ transfers: {}, error: null, busy: false, entries: [] });

    spy.mockRestore();
  });

  it("a refreshFolder call resolving after lock() leaves the already-cleared entries alone", async () => {
    await useVault.getState().unlock("right");
    await useVault.getState().createSpace("S");
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    let started = false;
    engine.listFolder = async () => { started = true; await gate; return [file]; };

    const pending = useVault.getState().refreshFolder("root");
    while (!started) await Promise.resolve();
    await useVault.getState().lock();
    resolveGate();
    await pending;

    expect(useVault.getState().entries).toEqual([]);
    expect(useVault.getState().busy).toBe(false);
  });

  it("openSpace resolving after lock() does not report success into a store the user can no longer act on", async () => {
    await useVault.getState().unlock("right");
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    let started = false;
    engine.openWorkspace = async () => { started = true; await gate; };

    const pending = useVault.getState().openSpace("ws-x");
    while (!started) await Promise.resolve();
    await useVault.getState().lock();
    resolveGate();
    const result = await pending;

    expect(result).toBe(false);
    expect(useVault.getState().activeSpaceId).toBeNull();
    expect(useVault.getState().entries).toEqual([]);
    expect(useVault.getState().busy).toBe(false);
    expect(useVault.getState().status).toBe("locked");
  });

  it("a failed openSpace clears activeSpaceId and entries, matching the engine's now-closed Space", async () => {
    await useVault.getState().unlock("right");
    useVault.setState({ activeSpaceId: "stale", entries: [file] });
    engine.openWorkspace = async () => { throw new Error("network"); };
    expect(await useVault.getState().openSpace("ws-x")).toBe(false);
    expect(useVault.getState().activeSpaceId).toBeNull();
    expect(useVault.getState().entries).toEqual([]);
  });

  it("a failed createSpace clears activeSpaceId and entries, matching the engine's now-closed Space", async () => {
    await useVault.getState().unlock("right");
    useVault.setState({ activeSpaceId: "stale", entries: [file] });
    engine.createWorkspace = async () => { throw new Error("network"); };
    expect(await useVault.getState().createSpace("Boom")).toBeNull();
    expect(useVault.getState().activeSpaceId).toBeNull();
    expect(useVault.getState().entries).toEqual([]);
  });

  it("createSpace still returns the new id and keeps the Space in state when saving the Spaces list to the keychain fails", async () => {
    await useVault.getState().unlock("right");
    // Self-contained regardless of what earlier tests in this file persisted
    // to "acct-1" (the shared keychain mock's map is never cleared between
    // tests, and beforeEach's own hydrate("acct-1") would otherwise restore it).
    useVault.setState({ spaces: [] });
    const keychainMock = jest.requireMock("@/lib/keychain") as typeof import("@/lib/keychain");
    const spy = jest.spyOn(keychainMock, "setItem").mockRejectedValueOnce(new Error("keychain unavailable"));

    const id = await useVault.getState().createSpace("Photos");

    expect(id).toMatch(/^ws-[0-9a-f-]{36}$/);
    expect(useVault.getState().spaces).toEqual([{ id, name: "Photos", selfFounded: true, globalWorkspaceId: "gw-1", shared: false, stub: false }]);
    expect(useVault.getState().error).toBe("Couldn't save your Spaces list on this phone.");

    spy.mockRestore();
  });

  it("hydrate tolerates a malformed keychain value and starts with an empty Spaces list", async () => {
    const { __map } = jest.requireMock("@/lib/keychain") as { __map: Map<string, string> };
    __map.set("dosya.vault.workspaces.acct-bad", "not json");
    await useVault.getState().hydrate("acct-bad");
    expect(useVault.getState().spaces).toEqual([]);

    __map.set("dosya.vault.workspaces.acct-bad2", JSON.stringify({ not: "an array" }));
    await useVault.getState().hydrate("acct-bad2");
    expect(useVault.getState().spaces).toEqual([]);
  });

  // The workspace menu shows "Locked" or "Unlocked" without importing this
  // store, so the flag it reads has to follow the real thing on every edge.
  it("publishes its lock state to the flag the workspace menu reads", async () => {
    // Not mocked in this file, so this is the very module the store writes to.
    const { isVaultLocked } = require("./status") as typeof import("./status");
    await useVault.getState().lock();
    expect(isVaultLocked()).toBe(true);

    await useVault.getState().unlock("right");
    expect(isVaultLocked()).toBe(false);

    await useVault.getState().lock();
    expect(isVaultLocked()).toBe(true);

    await useVault.getState().setup("p");
    expect(isVaultLocked()).toBe(false);

    await lockVaultForPurge("acct-1");
    expect(isVaultLocked()).toBe(true);
  });

  // A Space's name now lives in the Space, sealed under its own key. This
  // phone's list is a cache of that, and `openSpace` is where the two are
  // made to agree - in whichever direction has something to say.
  describe("the name this phone shows for a Space", () => {
    /** The reconciler is deliberately not awaited by openSpace. */
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it("adopts the name the Space carries, and stops calling it a stub", async () => {
      engine = fakeEngine();
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      const id = (await useVault.getState().createSpace("Holiday")) as string;

      // Another device's label for the same Space, as this phone had it.
      useVault.setState({
        spaces: [{ id, name: `Space ${id.slice(3, 9)}`, selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true }],
      });

      await useVault.getState().openSpace(id);
      await settle();

      const known = useVault.getState().spaces.find((sp) => sp.id === id);
      expect(known?.name).toBe("Holiday");
      expect(known?.stub).toBe(false);
    });

    it("writes THIS phone's name into a Space that has none, so an old Space gets its label without anyone retyping it", async () => {
      engine = fakeEngine();
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      // A Space from before names existed: real name here, nothing in the Space.
      useVault.setState({
        spaces: [{ id: "ws-old", name: "Phone", selfFounded: true, globalWorkspaceId: "gw-1", shared: false }],
      });

      await useVault.getState().openSpace("ws-old");
      await settle();

      expect(engine.calls).toContain("rename:ws-old:Phone");
    });

    it("never promotes a placeholder: a discovered Space with no name keeps its stub to itself", async () => {
      engine = fakeEngine();
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      useVault.setState({
        spaces: [{ id: "ws-disc", name: "Space abc123", selfFounded: false, globalWorkspaceId: "gw-1", shared: true, stub: true }],
      });

      await useVault.getState().openSpace("ws-disc");
      await settle();

      expect(engine.calls.some((c) => c.startsWith("rename:"))).toBe(false);
      expect(useVault.getState().spaces[0]!.name).toBe("Space abc123");
    });

    it("fills in every placeholder in the list, so a column of Spaces is not a column of identical rows", async () => {
      engine = fakeEngine({
        readWorkspaceNameById: async (id) => (id === "ws-a" ? "Photos" : id === "ws-b" ? "Tax 2026" : null),
      });
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      useVault.setState({
        spaces: [
          { id: "ws-a", name: "Space aaaaaa", selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true },
          { id: "ws-b", name: "Space bbbbbb", selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true },
          { id: "ws-c", name: "Mine", selfFounded: true, globalWorkspaceId: "gw-1", shared: false },
        ],
      });

      await useVault.getState().resolveSpaceNames();

      expect(useVault.getState().spaces.map((sp) => sp.name)).toEqual(["Photos", "Tax 2026", "Mine"]);
    });

    it("leaves a placeholder alone when the Space has nothing to say, and reports nothing when one lookup fails", async () => {
      engine = fakeEngine({
        readWorkspaceNameById: async (id) => {
          if (id === "ws-a") throw new Error("offline");
          return null;
        },
      });
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      useVault.setState({
        spaces: [
          { id: "ws-a", name: "Space aaaaaa", selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true },
          { id: "ws-b", name: "Space bbbbbb", selfFounded: false, globalWorkspaceId: "gw-1", shared: false, stub: true },
        ],
        error: null,
      });

      await useVault.getState().resolveSpaceNames();

      expect(useVault.getState().spaces.map((sp) => sp.name)).toEqual(["Space aaaaaa", "Space bbbbbb"]);
      expect(useVault.getState().error).toBeNull();
    });

    it("stays quiet when the Space will not say: a label is not worth an error over a Space that opened", async () => {
      engine = fakeEngine({ readWorkspaceName: async () => { throw new Error("offline"); } });
      useVault.getState().__setEngine(engine);
      await useVault.getState().unlock("right");
      useVault.setState({
        spaces: [{ id: "ws-1", name: "Phone", selfFounded: true, globalWorkspaceId: "gw-1", shared: false }],
      });

      expect(await useVault.getState().openSpace("ws-1")).toBe(true);
      await settle();

      expect(useVault.getState().error).toBeNull();
      expect(useVault.getState().activeSpaceId).toBe("ws-1");
    });
  });

  // The plus button's ring and sheet report every transfer in the app, and
  // they live outside the lock. What crosses is counted, never named.
  describe("the activity it publishes to the plus button", () => {
    const t = (over: Partial<Transfer> & Pick<Transfer, "id">): Transfer => ({
      name: "tax-return.pdf", kind: "upload", done: 0, total: 0, error: null, ...over,
    });

    it("adds the counts and the bytes up, both directions and breakages apart", () => {
      const { getVaultActivity } = require("./status") as typeof import("./status");
      useVault.setState({
        transfers: {
          "up-1": t({ id: "up-1", done: 30, total: 100 }),
          "up-2": t({ id: "up-2", error: "Couldn't upload tax-return.pdf." }),
          "dl-3": t({ id: "dl-3", kind: "download", done: 10, total: 50 }),
        },
      });
      expect(getVaultActivity()).toEqual({
        count: 3, failed: 1, uploads: 2, downloads: 1, written: 40, total: 150,
      });
    });

    it("carries no name out, whatever a transfer is called", () => {
      const { getVaultActivity } = require("./status") as typeof import("./status");
      useVault.setState({ transfers: { "up-1": t({ id: "up-1", name: "divorce-papers.pdf" }) } });
      expect(JSON.stringify(getVaultActivity())).not.toContain("divorce");
      expect(Object.keys(getVaultActivity()).sort()).toEqual([
        "count", "downloads", "failed", "total", "uploads", "written",
      ]);
    });

    it("falls silent the moment the list empties, so a stale count cannot outlive the work", () => {
      const { getVaultActivity } = require("./status") as typeof import("./status");
      useVault.setState({ transfers: { "up-1": t({ id: "up-1", done: 1, total: 2 }) } });
      expect(getVaultActivity().count).toBe(1);
      useVault.setState({ transfers: {} });
      expect(getVaultActivity()).toEqual({ count: 0, failed: 0, uploads: 0, downloads: 0, written: 0, total: 0 });
    });
  });
});
