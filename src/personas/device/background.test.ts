// The background window runner (./background.ts): reads with the native
// reader inside one OS window, under the read lock, the gate and the remote
// switch, and always lets the models go at the end.
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));

import type { EngineStatus } from "@dosya-dev/personas-engine";
import { acquireReadLock, personasWorkLeft, runPersonasWindow, type WindowDeps, type WindowEnd, type WindowEngine } from "./background";
import type { DevicePolicy } from "./policy";

class FakeEngine implements WindowEngine {
  calls: { max: number; signal?: AbortSignal }[] = [];
  /** Called inside readSome, before the photos are counted. */
  during: ((n: number) => void | Promise<void>) | null = null;
  block = false;
  settled = 0;
  private fns = new Set<() => void>();
  constructor(public st: EngineStatus, public left = 0, public total = left) {}
  async status(): Promise<EngineStatus> {
    if (this.st.state !== "ready") return this.st;
    return { ...this.st, read: this.total - this.left, total: this.total };
  }
  async readSome(max: number, signal?: AbortSignal) {
    this.calls.push({ max, signal });
    try {
      if (this.during) await this.during(this.calls.length);
      if (this.block) {
        await new Promise<void>((res) => {
          if (signal?.aborted) res();
          signal?.addEventListener("abort", () => res());
        });
      }
      if (signal?.aborted) return 0;
      const n = Math.min(max, this.left);
      this.left -= n;
      return n;
    } finally {
      this.settled++;
    }
  }
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
}

const ready = (paused = false): EngineStatus => ({ state: "ready", read: 0, total: 0, reading: false, paused });

class FakeGate {
  open = true;
  fns = new Set<() => void>();
  allows() { return this.open; }
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  set(open: boolean) { this.open = open; for (const f of [...this.fns]) f(); }
}

function setup(engines: Record<string, FakeEngine>, over: Partial<WindowDeps> = {}) {
  const gate = new FakeGate();
  const teardown = new Set<() => void>();
  const active = new Set<() => void>();
  const memory = new Set<() => void>();
  const unavailable = new Set<() => void>();
  let user: string | null = "u1";
  let policy: DevicePolicy = { background: "on", maxPhotosPerWindow: 2000 };
  let clock = 1_000_000;
  const unload = jest.fn(async () => {});
  const record = jest.fn(async () => {});
  const engineCalls: string[] = [];
  const deps: WindowDeps = {
    hydrate: async () => {},
    user: () => user,
    readerReady: async () => true,
    workspaces: async () => Object.keys(engines),
    engine: (ws) => { engineCalls.push(ws); return engines[ws]; },
    gate: () => gate,
    policy: async () => policy,
    mode: async () => "charging",
    charging: async () => true,
    onTeardown: (fn) => { teardown.add(fn); return () => teardown.delete(fn); },
    onAppActive: (fn) => { active.add(fn); return () => active.delete(fn); },
    onUnavailable: (fn) => { unavailable.add(fn); return () => unavailable.delete(fn); },
    onMemoryWarning: (fn) => { memory.add(fn); return () => memory.delete(fn); },
    memoryFootprint: () => 100 * 1024 * 1024,
    platform: "ios",
    unload,
    record,
    now: () => clock,
    gateWaitMs: 50,
    unloadTimeoutMs: 3_000,
    abortGraceMs: 2_000,
    settleWaitMs: 5_000,
    ...over,
  };
  return {
    deps, gate, unload, record, engineCalls,
    signOut: () => { user = null; for (const f of [...teardown]) f(); },
    goActive: () => { for (const f of [...active]) f(); },
    unavailable: () => { for (const f of [...unavailable]) f(); },
    setPolicy: (p: DevicePolicy) => { policy = p; },
    advance: (ms: number) => { clock += ms; },
    now: () => clock,
  };
}

const opts = (deadlineMs: number, signal = new AbortController().signal) => ({ deadlineMs, signal });

describe("runPersonasWindow", () => {
  it("reads until done", async () => {
    const e = new FakeEngine(ready(), 25);
    const s = setup({ w1: e });
    const progress: { read: number; total: number }[] = [];
    const end = await runPersonasWindow({ ...opts(s.now() + 600_000), onProgress: (p) => progress.push(p) }, s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
    expect(e.left).toBe(0);
    expect(e.calls.every((c) => c.max <= 10)).toBe(true);
    expect(progress.at(-1)).toEqual({ read: 25, total: 25 });
    expect(progress.length).toBeGreaterThanOrEqual(3);
  });

  it("stops at deadline minus 10 s with moreLeft", async () => {
    const e = new FakeEngine(ready(), 1000);
    const s = setup({ w1: e });
    e.during = () => s.advance(5_000);
    const end = await runPersonasWindow(opts(s.now() + 30_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "deadline" });
    // 0 -> 5 -> 10 -> 15 -> 20 s: the fourth batch ends at the 20 s cut-off.
    expect(e.calls).toHaveLength(4);
  });

  it("expired window aborts and reports", async () => {
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    const s = setup({ w1: e });
    const ac = new AbortController();
    const started = Date.now();
    const p = runPersonasWindow(opts(s.now() + 600_000, ac.signal), s.deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(e.calls).toHaveLength(1);
    ac.abort();
    const end = await p;
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "aborted" });
    expect(e.calls[0].signal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("gate closing (unplug) ends with gate", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e });
    e.during = (n) => { if (n === 2) s.gate.set(false); };
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "gate" });
    expect(e.calls).toHaveLength(2);
    expect(e.calls[1].signal?.aborted).toBe(true);
  });

  it("a closed gate that never opens ends with gate before reading", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e });
    s.gate.open = false;
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "gate" });
    expect(e.calls).toHaveLength(0);
  });

  it("sign-out mid-window ends signedOut and stops reading", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e });
    e.during = (n) => { if (n === 1) s.signOut(); };
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: false, reason: "signedOut" });
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0].signal?.aborted).toBe(true);
  });

  it("signed out at the start gives signedOut", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e }, { user: () => null });
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "signedOut" });
    expect(s.engineCalls).toEqual([]);
  });

  it("paused and off workspaces are skipped", async () => {
    const paused = new FakeEngine(ready(true), 50);
    const off = new FakeEngine({ state: "off" }, 50);
    const locked = new FakeEngine({ state: "needs_unlock" }, 50);
    const on = new FakeEngine(ready(), 15);
    const s = setup({ paused, off, locked, on });
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
    expect(paused.calls).toHaveLength(0);
    expect(off.calls).toHaveLength(0);
    expect(locked.calls).toHaveLength(0);
    expect(on.left).toBe(0);
  });

  it("reads every ready workspace", async () => {
    const a = new FakeEngine(ready(), 12);
    const b = new FakeEngine(ready(), 7);
    const s = setup({ a, b });
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
    expect(a.left + b.left).toBe(0);
  });

  it("no native reader gives noReader without touching engines", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e }, { readerReady: async () => false });
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "noReader" });
    expect(s.engineCalls).toEqual([]);
  });

  it("a workspace list that cannot be fetched ends with error and moreLeft", async () => {
    const s = setup({}, { workspaces: async () => { throw new TypeError("Network request failed"); } });
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "error" });
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ end: "error" }), expect.any(TypeError));
  });

  it("second window is refused while one runs", async () => {
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    const s = setup({ w1: e });
    const ac = new AbortController();
    const first = runPersonasWindow({ ...opts(s.now() + 600_000, ac.signal), kind: "processing" }, s.deps);
    await new Promise((r) => setTimeout(r, 10));
    const second = await runPersonasWindow({ ...opts(s.now() + 600_000), kind: "worker" }, s.deps);
    expect(second).toEqual<WindowEnd>({ moreLeft: true, reason: "busy" });
    expect(e.calls).toHaveLength(1);
    // A refused window does not let the running one's models go.
    expect(s.unload).not.toHaveBeenCalled();
    ac.abort();
    await first;
    const again = acquireReadLock("worker");
    expect(again).not.toBeNull();
    again!();
  });

  it("a service window waits for the foreground to let the lock go, then reads", async () => {
    jest.useFakeTimers();
    try {
      const e = new FakeEngine(ready(), 5);
      const s = setup({ w1: e }, { lockWaitMs: 5_000 });
      const fg = acquireReadLock("foreground")!;
      let result: WindowEnd | null = null;
      void runPersonasWindow({ ...opts(s.now() + 600_000), kind: "service" }, s.deps).then((r) => (result = r));
      await jest.advanceTimersByTimeAsync(1_000);
      expect(result).toBeNull();
      expect(e.calls).toHaveLength(0);
      fg();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(result).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
      expect(e.calls.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a service window still ends busy when the lock is not let go in time; other windows do not wait", async () => {
    jest.useFakeTimers();
    try {
      const s = setup({ w1: new FakeEngine(ready(), 5) }, { lockWaitMs: 5_000 });
      const fg = acquireReadLock("foreground")!;
      let result: WindowEnd | null = null;
      void runPersonasWindow({ ...opts(s.now() + 600_000), kind: "service" }, s.deps).then((r) => (result = r));
      await jest.advanceTimersByTimeAsync(5_100);
      expect(result).toEqual<WindowEnd>({ moreLeft: true, reason: "busy" });
      const worker = await runPersonasWindow({ ...opts(s.now() + 600_000), kind: "worker" }, s.deps);
      expect(worker).toEqual<WindowEnd>({ moreLeft: true, reason: "busy" });
      fg();
    } finally {
      jest.useRealTimers();
    }
  });

  it("a continued window waits for the lock until the foreground lets it go, with no time limit", async () => {
    jest.useFakeTimers();
    try {
      const e = new FakeEngine(ready(), 5);
      const s = setup({ w1: e }, { lockWaitMs: 5_000 });
      const fg = acquireReadLock("foreground")!;
      let result: WindowEnd | null = null;
      void runPersonasWindow({ ...opts(s.now() + 60 * 60_000), kind: "continued" }, s.deps).then((r) => (result = r));
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(result).toBeNull();
      expect(e.calls).toHaveLength(0);
      fg();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(result).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
      expect(e.left).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a continued window waiting for the lock ends aborted when iOS expires it", async () => {
    jest.useFakeTimers();
    try {
      const s = setup({ w1: new FakeEngine(ready(), 5) });
      const fg = acquireReadLock("foreground")!;
      const ac = new AbortController();
      let result: WindowEnd | null = null;
      void runPersonasWindow({ ...opts(s.now() + 60 * 60_000, ac.signal), kind: "continued" }, s.deps).then((r) => (result = r));
      await jest.advanceTimersByTimeAsync(60_000);
      expect(result).toBeNull();
      ac.abort();
      await jest.advanceTimersByTimeAsync(0);
      expect(result).toEqual<WindowEnd>({ moreLeft: true, reason: "aborted" });
      expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ kind: "continued", end: "aborted" }), undefined);
      fg();
    } finally {
      jest.useRealTimers();
    }
  });

  it("foreground takes over", async () => {
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    const s = setup({ w1: e });
    const p = runPersonasWindow(opts(s.now() + 600_000), s.deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(acquireReadLock("foreground")).toBeNull();
    s.goActive();
    const end = await p;
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "aborted" });
    expect(e.calls[0].signal?.aborted).toBe(true);
    const fg = acquireReadLock("foreground");
    expect(fg).not.toBeNull();
    // While the foreground reads, no window starts.
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "busy" });
    fg!();
  });

  it("unloads models when the window ends", async () => {
    const order: string[] = [];
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    const s = setup({ w1: e }, { unload: jest.fn(async () => { order.push(`unload after ${e.settled} settled`); }) });
    const ac = new AbortController();
    const p = runPersonasWindow(opts(s.now() + 600_000, ac.signal), s.deps);
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await p;
    expect(order).toEqual(["unload after 1 settled"]);
    // And for a window that read to the end.
    const done = new FakeEngine(ready(), 3);
    const s2 = setup({ w1: done });
    await runPersonasWindow(opts(s2.now() + 600_000), s2.deps);
    expect(s2.unload).toHaveBeenCalledTimes(1);
  });

  it("the cut-off aborts the batch in flight", async () => {
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    const s = setup({ w1: e });
    const started = Date.now();
    // The clock does not move: only the timer can end this window.
    const end = await runPersonasWindow(opts(s.now() + 10_000 + 50), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "deadline" });
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0].signal?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("a readSome that never settles does not keep the window past the cut-off", async () => {
    const hung: WindowEngine = {
      status: async () => ready(),
      readSome: () => new Promise<number>(() => undefined),
      subscribe: () => () => undefined,
    };
    const s = setup({ w1: hung as never }, { abortGraceMs: 100 });
    const started = Date.now();
    // The clock does not move: the cut-off timer fires after 50 ms.
    const end = await runPersonasWindow({ ...opts(s.now() + 10_000 + 50), kind: "processing" }, s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "deadline" });
    expect(Date.now() - started).toBeLessThan(100 + 1_000);
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ end: "deadline" }), undefined);
    const next = acquireReadLock("worker");
    expect(next).not.toBeNull();
    next!();
  });

  it("an engine still reading for an abandoned call is skipped, not called, and the window says busy", async () => {
    const e = new FakeEngine({ state: "ready", read: 0, total: 0, reading: true, paused: false }, 10);
    // settled() measures its wait on the window's clock (d.now()).
    const s = setup({ w1: e }, { settleWaitMs: 50, now: () => Date.now() });
    const started = Date.now();
    expect(await runPersonasWindow(opts(Date.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "busy" });
    expect(e.calls).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("a hung unload does not keep the window from ending", async () => {
    const e = new FakeEngine(ready(), 5);
    const s = setup({ w1: e }, { unload: () => new Promise<void>(() => undefined), unloadTimeoutMs: 50 });
    const started = Date.now();
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(s.record).toHaveBeenCalledTimes(1);
    const next = acquireReadLock("worker");
    expect(next).not.toBeNull();
    next!();
  });

  it("a policy() that never answers does not keep an aborted window: it ends within the grace, lets the lock go and records", async () => {
    const e = new FakeEngine(ready(), 10);
    const s = setup({ w1: e }, { policy: () => new Promise<DevicePolicy>(() => undefined), abortGraceMs: 50 });
    const ac = new AbortController();
    const p = runPersonasWindow({ ...opts(s.now() + 600_000, ac.signal), kind: "service" }, s.deps);
    await new Promise((r) => setTimeout(r, 20));
    const started = Date.now();
    ac.abort();
    expect(await p).toEqual<WindowEnd>({ moreLeft: true, reason: "aborted" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(e.calls).toHaveLength(0);
    expect(s.unload).toHaveBeenCalledTimes(1);
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ end: "aborted" }), undefined);
    const next = acquireReadLock("worker");
    expect(next).not.toBeNull();
    next!();
  });

  it("a hydrate that never answers does not keep a window past its cut-off", async () => {
    const s = setup({ w1: new FakeEngine(ready(), 10) }, { hydrate: () => new Promise<void>(() => undefined), abortGraceMs: 50 });
    const started = Date.now();
    expect(await runPersonasWindow(opts(s.now() + 10_000 + 50), s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "deadline" });
    expect(Date.now() - started).toBeLessThan(1_000);
    const next = acquireReadLock("worker");
    expect(next).not.toBeNull();
    next!();
  });

  it("a read that fails as unavailable aborts the window's reads before the engine sees it, and ends the window", async () => {
    const e = new FakeEngine(ready(), 100);
    const s = setup({ w1: e });
    e.during = (n) => { if (n === 2) s.unavailable(); };
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "error" });
    expect(e.calls).toHaveLength(2);
    expect(e.calls[1].signal?.aborted).toBe(true);
    // Not a bug: no Sentry event.
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ end: "error" }), undefined);
  });

  it("a record that never finishes does not keep the window from ending", async () => {
    const s = setup({ w1: new FakeEngine(ready(), 3) }, { record: () => new Promise<void>(() => undefined), unloadTimeoutMs: 50 });
    const started = Date.now();
    expect((await runPersonasWindow(opts(s.now() + 600_000), s.deps)).reason).toBe("done");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("stops at maxPhotosPerWindow", async () => {
    const e = new FakeEngine(ready(), 1000);
    const s = setup({ w1: e });
    s.setPolicy({ background: "on", maxPhotosPerWindow: 25 });
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "cap" });
    expect(e.calls.map((c) => c.max)).toEqual([10, 10, 5]);
    expect(e.left).toBe(975);
  });

  it("a nonsense maxPhotosPerWindow still reads", async () => {
    const e = new FakeEngine(ready(), 5);
    const s = setup({ w1: e });
    s.setPolicy({ background: "on", maxPhotosPerWindow: 0 });
    await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(e.calls.length).toBeGreaterThan(0);
  });

  it("stops when memory is high", async () => {
    let footprint = 100 * 1024 * 1024;
    const e = new FakeEngine(ready(), 1000);
    const s = setup({ w1: e }, { memoryFootprint: () => footprint });
    e.during = () => { footprint = 700 * 1024 * 1024; };
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: true, reason: "memory" });
    expect(e.calls).toHaveLength(1);
    // Android does not use the footprint check.
    const e2 = new FakeEngine(ready(), 20);
    const s2 = setup({ w1: e2 }, { memoryFootprint: () => 900 * 1024 * 1024, platform: "android" });
    expect((await runPersonasWindow(opts(s2.now() + 600_000), s2.deps)).reason).toBe("done");
  });

  it("a memory warning ends the window with memory", async () => {
    const e = new FakeEngine(ready(), 100);
    e.block = true;
    let warn: () => void = () => {};
    const s = setup({ w1: e }, { onMemoryWarning: (fn) => { warn = fn; return () => {}; } });
    const p = runPersonasWindow(opts(s.now() + 600_000), s.deps);
    await new Promise((r) => setTimeout(r, 10));
    warn();
    expect(await p).toEqual<WindowEnd>({ moreLeft: true, reason: "memory" });
  });

  it("remote off stops a running window at the next batch", async () => {
    const e = new FakeEngine(ready(), 1000);
    const s = setup({ w1: e });
    e.during = (n) => { if (n === 2) s.setPolicy({ background: "off", maxPhotosPerWindow: 2000 }); };
    const end = await runPersonasWindow(opts(s.now() + 600_000), s.deps);
    expect(end).toEqual<WindowEnd>({ moreLeft: false, reason: "policy" });
    expect(e.calls).toHaveLength(2);
  });

  it("remote off refuses a window before it reads", async () => {
    const e = new FakeEngine(ready(), 1000);
    const s = setup({ w1: e });
    s.setPolicy({ background: "off", maxPhotosPerWindow: 2000 });
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "policy" });
    expect(e.calls).toHaveLength(0);
  });

  it("remote charging makes Any time wait for a charger", async () => {
    const e = new FakeEngine(ready(), 1000);
    let charging = true;
    const s = setup({ w1: e }, { mode: async () => "anytime", charging: async () => charging });
    s.setPolicy({ background: "charging", maxPhotosPerWindow: 2000 });
    e.during = (n) => { if (n === 2) charging = false; };
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "gate" });
    expect(e.calls).toHaveLength(2);
  });

  it("an unexpected error ends the window with error, unloads and is recorded with the error", async () => {
    const e = new FakeEngine(ready(), 100);
    const boom = new Error("boom");
    e.during = () => { throw boom; };
    const s = setup({ w1: e });
    expect(await runPersonasWindow({ ...opts(s.now() + 600_000), kind: "worker" }, s.deps)).toEqual<WindowEnd>({ moreLeft: true, reason: "error" });
    expect(s.unload).toHaveBeenCalledTimes(1);
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ kind: "worker", end: "error", platform: "ios", mode: "charging" }), boom);
  });

  it("records one row per window with its kind, photos and end", async () => {
    const e = new FakeEngine(ready(), 12);
    const s = setup({ w1: e });
    await runPersonasWindow({ ...opts(s.now() + 600_000), kind: "service" }, s.deps);
    expect(s.record).toHaveBeenCalledTimes(1);
    expect(s.record).toHaveBeenCalledWith({ at: expect.any(Number), kind: "service", ms: expect.any(Number), photos: 12, end: "done", platform: "ios", mode: "charging" }, undefined);
  });

  it("waits for a foreground read still settling instead of calling the engine done", async () => {
    const e = new FakeEngine({ state: "ready", read: 0, total: 0, reading: true, paused: false }, 10);
    const s = setup({ w1: e });
    setTimeout(() => { e.st = ready(); (e as unknown as { fns: Set<() => void> }).fns.forEach((f) => f()); }, 20);
    expect(await runPersonasWindow(opts(s.now() + 600_000), s.deps)).toEqual<WindowEnd>({ moreLeft: false, reason: "done" });
    expect(e.left).toBe(0);
  });
});

describe("personasWorkLeft", () => {
  it("is true while a ready, unpaused workspace has photos left", async () => {
    const deps = (m: Record<string, FakeEngine>) => ({ workspaces: async () => Object.keys(m), engine: (ws: string) => m[ws] });
    expect(await personasWorkLeft(deps({ a: new FakeEngine(ready(), 0, 10), b: new FakeEngine(ready(), 3, 10) }))).toBe(true);
    expect(await personasWorkLeft(deps({ a: new FakeEngine(ready(), 0, 10), b: new FakeEngine(ready(true), 3, 10) }))).toBe(false);
    expect(await personasWorkLeft(deps({ a: new FakeEngine({ state: "off" }) }))).toBe(false);
  });
});
