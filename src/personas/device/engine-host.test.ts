// The phone's engine host (src/personas/device/engine-host.ts), ported from
// apps/web/src/lib/personas-device/engine-host.test.ts. Mobile differences
// under test: reading waits on the read gate (foreground, Wi-Fi and charging
// unless allowed anywhere), the signed-in user is the auth store's, the
// Vault is src/vault/store, and the reader is the hidden WebView.
import { PersonasEngine, type EngineStatus } from "@dosya-dev/personas-engine";

const mockGate = { hidden: true, held: false, heldReason: null as string | null, fns: new Set<() => void>(), subs: new Set<() => void>() };
jest.mock("./gate", () => ({
  appReadGate: () => ({
    get hidden() { return mockGate.hidden; },
    get held() { return mockGate.held; },
    get heldReason() { return mockGate.heldReason; },
    addEventListener: (_: string, fn: () => void) => mockGate.fns.add(fn),
    removeEventListener: (_: string, fn: () => void) => mockGate.fns.delete(fn),
    subscribe: (fn: () => void) => { mockGate.subs.add(fn); return () => { mockGate.subs.delete(fn); }; },
    stop: () => { mockGate.fns.clear(); mockGate.subs.clear(); },
  }),
}));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));

import { useAuthStore } from "@/auth/authStore";
import { useVault } from "@/vault/store";
import {
  guardFiles, guardReader, pausePersonasEngines, personasDeviceState, personasEngine, subscribePersonasWork, personasPhotoRows, runReadLoop, stopPersonasEngines, subscribePersonasDevice, unlockPersonas,
  type LoopDoc, type LoopEngine, type ReadLoop,
} from "./engine-host";
import { personasReaderChannel } from "./channel";
import { ReaderUnavailableError } from "./reader";
import { PersonasUnavailableError } from "./errors";
import { personasTornDown, personasUser, teardownPersonas } from "./teardown";

class FakeDoc implements LoopDoc {
  hidden = false;
  private fns = new Set<() => void>();
  addEventListener(_: "visibilitychange", fn: () => void) { this.fns.add(fn); }
  removeEventListener(_: "visibilitychange", fn: () => void) { this.fns.delete(fn); }
  setHidden(h: boolean) { this.hidden = h; for (const f of this.fns) f(); }
}

const READY: EngineStatus = { state: "ready", read: 0, total: null, reading: false, paused: false };

class FakeEngine implements LoopEngine {
  st: EngineStatus = READY;
  statusError: unknown = null;
  calls: { max: number; signal?: AbortSignal }[] = [];
  results: number[] = [];
  gate: Promise<void> | null = null;
  private fns = new Set<() => void>();
  async status() { if (this.statusError) throw this.statusError; return this.st; }
  async readSome(max: number, signal?: AbortSignal) {
    this.calls.push({ max, signal });
    if (this.gate) await this.gate;
    return this.results.shift() ?? 0;
  }
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  notify() { for (const f of this.fns) f(); }
}

const signIn = (id: string | null) => {
  useAuthStore.setState(id ? { status: "signedIn", user: { id } as never } : { status: "signedOut", user: null });
};

describe("runReadLoop", () => {
  let loop: ReadLoop | null = null;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { loop?.stop(); loop = null; jest.useRealTimers(); });
  const tick = (ms = 0) => jest.advanceTimersByTimeAsync(ms);

  it("reads 50 at a time while there is work, then waits before looking again", async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.results = [50, 50, 3];
    loop = runReadLoop(engine, { doc, idleMs: 120_000 });
    await tick(10);
    expect(engine.calls.map((c) => c.max)).toEqual([50, 50, 50, 50]);
    await tick(119_000);
    expect(engine.calls).toHaveLength(4);
    await tick(2_000);
    expect(engine.calls).toHaveLength(5);
  });

  it("does not read while the gate is closed (background, no Wi-Fi or charger), and stops mid-read when it closes", async () => {
    const doc = new FakeDoc();
    doc.hidden = true;
    const engine = new FakeEngine();
    loop = runReadLoop(engine, { doc });
    await tick(600_000);
    expect(engine.calls).toHaveLength(0);
    let release!: () => void;
    engine.gate = new Promise((r) => (release = r));
    engine.results = [50, 50, 50];
    doc.setHidden(false);
    await tick();
    expect(engine.calls).toHaveLength(1);
    const signal = engine.calls[0].signal!;
    doc.setHidden(true);
    expect(signal.aborted).toBe(true);
    release();
    engine.gate = null;
    await tick(600_000);
    expect(engine.calls).toHaveLength(1);
    doc.setHidden(false);
    await tick();
    expect(engine.calls.length).toBeGreaterThan(1);
  });

  it("waits while not ready or paused and resumes when the engine says something changed", async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.st = { state: "needs_unlock" };
    loop = runReadLoop(engine, { doc });
    await tick(30_000);
    expect(engine.calls).toHaveLength(0);
    engine.st = { ...READY, paused: true };
    engine.notify();
    await tick();
    expect(engine.calls).toHaveLength(0);
    engine.st = READY;
    engine.notify();
    await tick();
    expect(engine.calls).toHaveLength(1);
  });

  it("reads nothing (no rendition is fetched) while this phone cannot run the reader, and starts once it can", async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    let can = false;
    loop = runReadLoop(engine, { doc, canRead: () => can });
    await tick(600_000);
    expect(engine.calls).toHaveLength(0);
    can = true;
    engine.notify();
    await tick();
    expect(engine.calls).toHaveLength(1);
  });

  it("backs off after an error and tries again", async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    engine.statusError = new Error("offline");
    loop = runReadLoop(engine, { doc, retryMs: 30_000 });
    await tick(29_000);
    expect(engine.calls).toHaveLength(0);
    engine.statusError = null;
    await tick(2_000);
    expect(engine.calls).toHaveLength(1);
  });

  it("interrupt() aborts the read in flight and tries again after the retry delay; stop() ends it", async () => {
    const doc = new FakeDoc();
    const engine = new FakeEngine();
    let release!: () => void;
    engine.gate = new Promise((r) => (release = r));
    engine.results = [50];
    loop = runReadLoop(engine, { doc, retryMs: 30_000 });
    await tick();
    loop.interrupt();
    expect(engine.calls[0].signal!.aborted).toBe(true);
    release();
    engine.gate = null;
    await tick(29_000);
    expect(engine.calls).toHaveLength(1);
    await tick(2_000);
    expect(engine.calls).toHaveLength(2);
    loop.stop();
    await tick(600_000);
    expect(engine.calls).toHaveLength(2);
  });
});

describe("guardReader and guardFiles", () => {
  it("report an unavailable reader or rendition before the engine sees it, and pass everything else through", async () => {
    const seen: string[] = [];
    let fail: Error | null = new ReaderUnavailableError("models missing");
    const reader = guardReader({ read: async () => { if (fail) throw fail; return []; } }, () => seen.push("reader"));
    await expect(reader.read(new Uint8Array())).rejects.toBeInstanceOf(ReaderUnavailableError);
    fail = new Error("photo");
    await expect(reader.read(new Uint8Array())).rejects.toThrow("photo");
    fail = null;
    expect(await reader.read(new Uint8Array())).toEqual([]);

    let rfail: Error | null = new PersonasUnavailableError("offline");
    const files = guardFiles({ candidates: async function* () {}, rendition: async () => { if (rfail) throw rfail; return new Uint8Array([1]); } }, () => seen.push("files"));
    await expect(files.rendition("f", 1)).rejects.toBeInstanceOf(PersonasUnavailableError);
    rfail = new Error("404");
    await expect(files.rendition("f", 1)).rejects.toThrow("404");
    expect(seen).toEqual(["reader", "files"]);
  });
});

describe("engines, sign-out and unlock", () => {
  afterEach(() => {
    stopPersonasEngines();
    signIn(null);
    jest.restoreAllMocks();
  });

  const keychain = jest.requireMock("@/lib/keychain") as { getItem: jest.Mock; setItem: jest.Mock; deleteItem: jest.Mock };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("\"Read on this device\" off is remembered per user and workspace in this phone's keychain", async () => {
    const store = new Map<string, string>();
    keychain.getItem.mockImplementation(async (k: string) => store.get(k) ?? null);
    keychain.setItem.mockImplementation(async (k: string, v: string) => void store.set(k, v));
    keychain.deleteItem.mockImplementation(async (k: string) => void store.delete(k));
    try {
      signIn("u1");
      const a = personasEngine("w1");
      await settle();
      expect(a.isPaused()).toBe(false);
      a.setPaused(true);
      await settle();
      expect(store.get("dosya.personas.paused.u1.w1")).toBe("1");
      stopPersonasEngines();
      const b = personasEngine("w1");
      expect(b).not.toBe(a);
      await settle();
      expect(b.isPaused()).toBe(true);
      const c = personasEngine("w2");
      await settle();
      expect(c.isPaused()).toBe(false);
      b.setPaused(false);
      await settle();
      expect(store.has("dosya.personas.paused.u1.w1")).toBe(false);
      stopPersonasEngines();
      const d = personasEngine("w1");
      await settle();
      expect(d.isPaused()).toBe(false);
    } finally {
      keychain.getItem.mockImplementation(async () => null);
      keychain.setItem.mockImplementation(async () => {});
      keychain.deleteItem.mockImplementation(async () => {});
    }
  });

  it("reading starts only once the stored pause is known, and a choice made meanwhile wins", async () => {
    let answer!: (v: string | null) => void;
    keychain.getItem.mockImplementation((k: string) =>
      k.startsWith("dosya.personas.paused.") ? new Promise((r) => (answer = r)) : Promise.resolve(null));
    const status = jest.spyOn(PersonasEngine.prototype, "status").mockResolvedValue({ state: "off" });
    mockGate.hidden = false;
    try {
      signIn("u1");
      const a = personasEngine("w1");
      await settle();
      await settle();
      expect(status).not.toHaveBeenCalled(); // no read loop yet
      answer("1");
      await settle();
      await settle();
      expect(a.isPaused()).toBe(true);
      expect(status).toHaveBeenCalled(); // the loop runs (and waits while paused)

      stopPersonasEngines();
      const b = personasEngine("w1");
      b.setPaused(false); // the user switched reading on before the keychain answered
      answer("1");
      await settle();
      expect(b.isPaused()).toBe(false);
    } finally {
      mockGate.hidden = true;
      keychain.getItem.mockImplementation(async () => null);
    }
  });

  it("an unreadable keychain reads as not paused", async () => {
    keychain.getItem.mockImplementation(async () => { throw new Error("locked"); });
    try {
      signIn("u1");
      const a = personasEngine("w1");
      await settle();
      expect(a.isPaused()).toBe(false);
    } finally {
      keychain.getItem.mockImplementation(async () => null);
    }
  });

  it("the notification's Pause pauses every hosted engine, remembered in the keychain", async () => {
    signIn("u1");
    const a = personasEngine("w1");
    const b = personasEngine("w2");
    await settle();
    keychain.setItem.mockClear();
    pausePersonasEngines();
    expect(a.isPaused()).toBe(true);
    expect(b.isPaused()).toBe(true);
    await settle();
    expect(keychain.setItem).toHaveBeenCalledWith("dosya.personas.paused.u1.w1", "1");
    expect(keychain.setItem).toHaveBeenCalledWith("dosya.personas.paused.u1.w2", "1");
  });

  it("tells the schedule when the work may have changed: pause, resume, turn on, turn off, unlock, sign-out; not on reads", async () => {
    signIn("u1");
    const a = personasEngine("w1");
    await settle();
    const seen = jest.fn();
    const off = subscribePersonasWork(seen);
    a.setPaused(true);
    a.setPaused(false);
    expect(seen).toHaveBeenCalledTimes(2);
    jest.spyOn(Object.getPrototypeOf(a), "turnOn").mockResolvedValue(undefined);
    stopPersonasEngines();
    expect(seen).toHaveBeenCalledTimes(3);
    const b = personasEngine("w1");
    await b.turnOn();
    expect(seen).toHaveBeenCalledTimes(4);
    // "Turn off and delete" (through deleteIndex), even when it fails part-way (offline here).
    await expect(b.turnOff()).rejects.toThrow();
    expect(seen).toHaveBeenCalledTimes(5);
    off();
  });

  it("one engine per user and workspace; none while signed out", () => {
    signIn("u1");
    expect(personasUser()).toBe("u1");
    const a = personasEngine("w1");
    expect(personasEngine("w1")).toBe(a);
    expect(personasEngine("w2")).not.toBe(a);
    signIn("u2");
    expect(personasEngine("w1")).not.toBe(a);
    signIn(null);
    expect(() => personasEngine("w1")).toThrow();
  });

  it("sign-out teardown forgets every engine, drops the WebView and makes none until the user changes", () => {
    signIn("u1");
    const a = personasEngine("w1");
    personasReaderChannel.post("{}");
    expect(personasReaderChannel.snapshot().mounted).toBe(true);
    teardownPersonas();
    expect(personasTornDown()).toBe(true);
    expect(personasReaderChannel.snapshot().mounted).toBe(false);
    expect(() => personasEngine("w1")).toThrow();
    signIn(null);
    signIn("u1");
    expect(personasTornDown()).toBe(false);
    expect(personasEngine("w1")).not.toBe(a);
  });

  it("a change of user tears the old user's engines down by itself", () => {
    signIn("u1");
    const a = personasEngine("w1");
    signIn("u2");
    signIn("u1");
    expect(personasEngine("w1")).not.toBe(a);
  });

  it("personasPhotoRows reads the shared photo listing once, and refuses while signed out", async () => {
    await expect(personasPhotoRows("w1")).rejects.toThrow();
    signIn("u1");
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const u = new URL(String(url));
      const body = u.pathname === "/api/folders/tree"
        ? { ok: true, folders: [] }
        : { ok: true, months: [{ files: [{ id: "p1", name: "a.jpg", folder_id: null, current_version: 1, taken_at: 5, is_hidden: 0, lock_mode: "none" }] }], next_cursor: null };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as unknown as Response;
    }) as never);
    const rows = await personasPhotoRows("w1");
    expect(rows.get("p1")?.name).toBe("a.jpg");
    expect(await personasPhotoRows("w1")).toBe(rows);
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/library"))).toHaveLength(1);
  });

  it("tells the screens when this phone's WebView cannot run the reader, and what reading waits for", () => {
    signIn("u1");
    personasEngine("w1");
    expect(personasDeviceState()).toEqual({ supported: true, held: false, heldReason: null });
    const fn = jest.fn();
    const off = subscribePersonasDevice(fn);
    personasReaderChannel.post("{}");
    personasReaderChannel.receive(JSON.stringify({ type: "ready", supported: false }));
    expect(personasDeviceState().supported).toBe(false);
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    mockGate.held = true;
    mockGate.heldReason = "battery";
    for (const f of mockGate.subs) f();
    expect(personasDeviceState()).toEqual({ supported: false, held: true, heldReason: "battery" });
    expect(fn).toHaveBeenCalled();
    fn.mockClear();
    // Still held, for another reason: the screens hear of it.
    mockGate.heldReason = "thermal";
    for (const f of mockGate.subs) f();
    expect(personasDeviceState().heldReason).toBe("thermal");
    expect(fn).toHaveBeenCalled();
    off();
    mockGate.held = false;
    mockGate.heldReason = null;
  });

  it("unlockPersonas hands the unlocked identity to the engine and wipes the private key copy", async () => {
    signIn("u1");
    const priv = new Uint8Array(32).fill(9);
    const pub = new Uint8Array(32).fill(8);
    const spy = jest.spyOn(PersonasEngine.prototype, "unlockWith").mockImplementation(async (id) => {
      expect(id).toEqual({ userId: "u1", x25519Pub: pub, x25519Priv: new Uint8Array(32).fill(9) });
    });
    const base = { lock: () => {}, isUnlocked: () => false } as never;
    useVault.getState().__setEngine({ ...(base as object), personasIdentity: () => null } as never);
    await expect(unlockPersonas("w1")).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    useVault.getState().__setEngine({ ...(base as object), personasIdentity: () => ({ x25519Pub: pub, x25519Priv: priv }) } as never);
    await unlockPersonas("w1");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(priv.every((b) => b === 0)).toBe(true);
  });
});

describe("foregroundReadDoc", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { foregroundReadDoc } = require("./engine-host") as typeof import("./engine-host");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { acquireReadLock, readLockOwner } = require("./read-lock") as typeof import("./read-lock");
  const gateLike = () => {
    const fns = new Set<() => void>();
    return {
      hidden: true, held: false, heldReason: null, allows: () => false,
      subscribe: () => () => undefined,
      addEventListener: (_: string, fn: () => void) => fns.add(fn),
      removeEventListener: (_: string, fn: () => void) => fns.delete(fn),
      stop: () => undefined,
      set(h: boolean) { this.hidden = h; for (const f of [...fns]) f(); },
    };
  };

  it("holds the read lock while its gate is open and waits for a window to let it go", () => {
    const gate = gateLike();
    const window = acquireReadLock("processing")!;
    const doc = foregroundReadDoc(gate as never);
    const seen: boolean[] = [];
    doc.addEventListener("visibilitychange", () => seen.push(doc.hidden));
    gate.set(false);
    expect(doc.hidden).toBe(true); // a window reads: the foreground waits
    window();
    expect(readLockOwner()).toBe("foreground");
    expect(doc.hidden).toBe(false);
    gate.set(true);
    expect(doc.hidden).toBe(true);
    expect(readLockOwner()).toBeNull();
    expect(seen).toEqual([false, true]);
    doc.stop();
  });

  it("a continued window started from the app waits while the foreground holds the lock, and reads once the app leaves the front", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require("react-native") as typeof import("react-native");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runPersonasWindow } = require("./background") as typeof import("./background");
    const appFns = new Set<(s: string) => void>();
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, fn: (s: string) => void) => {
      appFns.add(fn);
      return { remove: () => appFns.delete(fn) };
    }) as never);
    const was = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
    try {
      const gate = gateLike();
      gate.hidden = false; // in front, the gate open
      const doc = foregroundReadDoc(gate as never);
      expect(readLockOwner()).toBe("foreground");
      let left = 4;
      const reads: number[] = [];
      const engine = {
        status: async (): Promise<EngineStatus> => ({ state: "ready", read: 4 - left, total: 4, reading: false, paused: false }),
        readSome: async (max: number) => {
          const n = Math.min(max, left);
          left -= n;
          reads.push(n);
          return n;
        },
        subscribe: () => () => undefined,
      };
      let result: unknown = null;
      const now = Date.now();
      const p = runPersonasWindow(
        { deadlineMs: now + 60 * 60_000, signal: new AbortController().signal, kind: "continued" },
        {
          hydrate: async () => undefined,
          user: () => "u1",
          readerReady: async () => true,
          workspaces: async () => ["w1"],
          engine: () => engine,
          gate: () => ({ allows: () => true, subscribe: () => () => undefined }),
          policy: async () => ({ background: "on", maxPhotosPerWindow: 2000 }),
          mode: async () => "charging",
          charging: async () => true,
          onTeardown: () => () => undefined,
          onAppActive: () => () => undefined,
          onUnavailable: () => () => undefined,
          onMemoryWarning: () => () => undefined,
          memoryFootprint: () => -1,
          platform: "ios",
          unload: async () => undefined,
          record: async () => undefined,
          now: Date.now,
          gateWaitMs: 50,
          unloadTimeoutMs: 50,
          abortGraceMs: 50,
          settleWaitMs: 50,
          lockWaitMs: 50,
        },
      ).then((r) => (result = r));
      // Well past a service window's wait: still waiting, not ended busy.
      await new Promise((r) => setTimeout(r, 150));
      expect(result).toBeNull();
      expect(reads).toEqual([]);
      // The user leaves the app: the foreground lets the lock go and the window reads.
      (AppState as { currentState: string }).currentState = "background";
      gate.set(true);
      for (const fn of [...appFns]) fn("background");
      await p;
      expect(result).toEqual({ moreLeft: false, reason: "done" });
      expect(reads.reduce((a, b) => a + b, 0)).toBe(4);
      expect(readLockOwner()).toBeNull();
      doc.stop();
    } finally {
      spy.mockRestore();
      if (was) Object.defineProperty(AppState, "currentState", was);
    }
  });
});
