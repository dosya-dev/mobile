// Two halves: the real wrapper over a fake native module (what it forwards,
// how it degrades), and the manual mock in __mocks__ (what other modules'
// tests get from jest.mock("<this module>")), which keeps the native
// module's buffering contract.

type Listener = (e: Record<string, unknown>) => void;

function fakeNative(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    emit(name: string, body: Record<string, unknown>) {
      for (const fn of listeners.get(name) ?? []) fn(body);
    },
    addListener: jest.fn((name: string, fn: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
      return { remove: () => listeners.get(name)!.delete(fn) };
    }),
    windowDone: jest.fn(),
    scheduleWindow: jest.fn(async () => undefined),
    cancelWindows: jest.fn(async () => undefined),
    supportsContinued: jest.fn(() => true),
    startContinued: jest.fn(async () => true),
    setWindowProgress: jest.fn(),
    backgroundBlocks: jest.fn(async () => ["refreshOff"]),
    openAppSettings: jest.fn(async () => undefined),
    startService: jest.fn(async () => true),
    updateService: jest.fn(),
    stopService: jest.fn(),
    enqueueWorker: jest.fn(async () => undefined),
    requestNotificationPermission: jest.fn(async () => true),
    ...overrides,
  };
}

type Wrapper = typeof import("./index");

function load(native: unknown, os: "ios" | "android" = "ios"): Wrapper {
  let mod!: Wrapper;
  jest.isolateModules(() => {
    jest.doMock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native }));
    jest.doMock("react-native", () => ({ Platform: { OS: os } }));
    mod = jest.requireActual("./index") as Wrapper;
  });
  return mod;
}

afterEach(() => {
  jest.dontMock("expo-modules-core");
  jest.dontMock("react-native");
});

describe("dosya-personas-background wrapper", () => {
  it("delivers windows, expiries and memory warnings from native, and the disposer detaches", () => {
    const n = fakeNative();
    const m = load(n);
    expect(m.isPersonasBackgroundAvailable()).toBe(true);
    const seen: unknown[] = [];
    const offW = m.onWindow((w) => seen.push(["window", w]));
    const offE = m.onWindowExpired((id) => seen.push(["expired", id]));
    const offM = m.onMemoryWarning(() => seen.push(["memory"]));
    n.emit("onWindow", { id: "a", kind: "processing", deadlineMs: 123 });
    n.emit("onWindowExpired", { id: "a" });
    n.emit("onMemoryWarning", {});
    expect(seen).toEqual([["window", { id: "a", kind: "processing", deadlineMs: 123 }], ["expired", "a"], ["memory"]]);
    offW();
    offE();
    offM();
    n.emit("onWindow", { id: "b", kind: "processing", deadlineMs: 1 });
    expect(seen).toHaveLength(3);
  });

  it("forwards windowDone, schedule, cancel, continued and progress", async () => {
    const n = fakeNative();
    const m = load(n);
    m.windowDone("a", true);
    expect(n.windowDone).toHaveBeenCalledWith("a", true);
    await m.scheduleWindow({ requiresPower: true });
    expect(n.scheduleWindow).toHaveBeenCalledWith(true);
    await m.cancelWindows();
    expect(n.cancelWindows).toHaveBeenCalled();
    expect(m.supportsContinued()).toBe(true);
    await expect(m.startContinued({ title: "Reading photos for Personas", subtitle: "0 of 10" })).resolves.toBe(true);
    expect(n.startContinued).toHaveBeenCalledWith("Reading photos for Personas", "0 of 10");
    m.setWindowProgress("c", { read: 3, total: 10, text: "3 of 10" });
    expect(n.setWindowProgress).toHaveBeenCalledWith("c", 3, 10, "3 of 10");
    await expect(m.backgroundBlocks()).resolves.toEqual(["refreshOff"]);
    await m.openAppSettings("refreshOff");
    expect(n.openAppSettings).toHaveBeenCalledWith("refreshOff");
  });

  it("a refused or failing continued start is false, and a failing native call does not throw", async () => {
    const n = fakeNative({
      startContinued: jest.fn(async () => {
        throw new Error("refused");
      }),
      windowDone: jest.fn(() => {
        throw new Error("gone");
      }),
      backgroundBlocks: jest.fn(async () => {
        throw new Error("x");
      }),
    });
    const m = load(n);
    await expect(m.startContinued({ title: "t", subtitle: "s" })).resolves.toBe(false);
    expect(() => m.windowDone("a", false)).not.toThrow();
    await expect(m.backgroundBlocks()).resolves.toEqual([]);
  });

  it("never offers the continued task on Android", async () => {
    const n = fakeNative();
    const m = load(n, "android");
    expect(m.supportsContinued()).toBe(false);
    await expect(m.startContinued({ title: "t", subtitle: "s" })).resolves.toBe(false);
    expect(n.startContinued).not.toHaveBeenCalled();
  });

  it("Android: forwards the service, the worker and the permission request", async () => {
    const n = fakeNative({ backgroundBlocks: jest.fn(async () => ["notificationsOff", "batteryOptimized"]) });
    const m = load(n, "android");
    await expect(m.startService({ title: "Personas", text: "Reading photos", pauseLabel: "Pause", channelName: "Personas" })).resolves.toBe(true);
    expect(n.startService).toHaveBeenCalledWith("Personas", "Reading photos", "Pause", "Personas");
    m.updateService({ read: 3, total: 10, text: "3 of 10" });
    expect(n.updateService).toHaveBeenCalledWith(3, 10, "3 of 10");
    m.stopService();
    expect(n.stopService).toHaveBeenCalled();
    await m.enqueueWorker({ requiresCharging: true, batteryNotLow: false, unmetered: true, tapText: "Tap to keep reading photos for Personas" });
    expect(n.enqueueWorker).toHaveBeenCalledWith(true, false, true, "Tap to keep reading photos for Personas");
    await m.enqueueWorker({ requiresCharging: false, batteryNotLow: true, unmetered: false, tapText: "" });
    expect(n.enqueueWorker).toHaveBeenLastCalledWith(false, true, false, "");
    await expect(m.requestNotificationPermission()).resolves.toBe(true);
    await expect(m.backgroundBlocks()).resolves.toEqual(["notificationsOff", "batteryOptimized"]);
    await m.openAppSettings("batteryOptimized");
    expect(n.openAppSettings).toHaveBeenCalledWith("batteryOptimized");
  });

  it("Android: startService is false when native refuses (no Activity in front) or throws", async () => {
    const refused = load(fakeNative({ startService: jest.fn(async () => false) }), "android");
    await expect(refused.startService({ title: "t", text: "x", pauseLabel: "p", channelName: "c" })).resolves.toBe(false);
    const failing = load(
      fakeNative({
        startService: jest.fn(async () => {
          throw new Error("ForegroundServiceStartNotAllowedException");
        }),
        updateService: jest.fn(() => {
          throw new Error("x");
        }),
        stopService: jest.fn(() => {
          throw new Error("x");
        }),
        requestNotificationPermission: jest.fn(async () => {
          throw new Error("x");
        }),
      }),
      "android",
    );
    await expect(failing.startService({ title: "t", text: "x", pauseLabel: "p", channelName: "c" })).resolves.toBe(false);
    expect(() => failing.updateService({ read: 1, total: 2, text: "" })).not.toThrow();
    expect(() => failing.stopService()).not.toThrow();
    await expect(failing.requestNotificationPermission()).resolves.toBe(false);
  });

  it("Android: delivers Pause presses and service windows, and the disposer detaches", () => {
    const n = fakeNative();
    const m = load(n, "android");
    const seen: unknown[] = [];
    const offP = m.onPausePressed(() => seen.push("pause"));
    const offW = m.onWindow((w) => seen.push(w));
    n.emit("onWindow", { id: "s", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
    n.emit("onPausePressed", {});
    expect(seen).toEqual([{ id: "s", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER }, "pause"]);
    offP();
    offW();
    n.emit("onPausePressed", {});
    expect(seen).toHaveLength(2);
  });

  it("Android: delivers the service's stop; iOS never listens for it", () => {
    const n = fakeNative();
    const m = load(n, "android");
    let stops = 0;
    const off = m.onServiceStopped(() => stops++);
    n.emit("onServiceStopped", {});
    expect(stops).toBe(1);
    off();
    n.emit("onServiceStopped", {});
    expect(stops).toBe(1);
    const i = fakeNative();
    load(i, "ios").onServiceStopped(() => stops++);
    expect(i.addListener).not.toHaveBeenCalled();
  });

  it("the Android calls do nothing on iOS: no service, no worker, no permission prompt", async () => {
    const n = fakeNative();
    const m = load(n, "ios");
    await expect(m.startService({ title: "t", text: "x", pauseLabel: "p", channelName: "c" })).resolves.toBe(false);
    m.updateService({ read: 1, total: 2, text: "" });
    m.stopService();
    await m.enqueueWorker({ requiresCharging: true, batteryNotLow: true, unmetered: true, tapText: "t" });
    await expect(m.requestNotificationPermission()).resolves.toBe(true);
    expect(n.startService).not.toHaveBeenCalled();
    expect(n.updateService).not.toHaveBeenCalled();
    expect(n.stopService).not.toHaveBeenCalled();
    expect(n.enqueueWorker).not.toHaveBeenCalled();
    expect(n.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it("without the native module every call is a no-op that returns false or nothing", async () => {
    const m = load(null);
    expect(m.isPersonasBackgroundAvailable()).toBe(false);
    expect(m.supportsContinued()).toBe(false);
    await expect(m.startContinued({ title: "t", subtitle: "s" })).resolves.toBe(false);
    await expect(m.scheduleWindow({ requiresPower: false })).resolves.toBeUndefined();
    await expect(m.cancelWindows()).resolves.toBeUndefined();
    await expect(m.backgroundBlocks()).resolves.toEqual([]);
    await expect(m.openAppSettings("refreshOff")).resolves.toBeUndefined();
    expect(() => m.windowDone("a", true)).not.toThrow();
    expect(() => m.setWindowProgress("a", { read: 1, total: 2, text: "" })).not.toThrow();
    const off = [m.onWindow(() => undefined), m.onWindowExpired(() => undefined), m.onMemoryWarning(() => undefined), m.onPausePressed(() => undefined)];
    for (const f of off) expect(() => f()).not.toThrow();
  });

  it("without the native module the Android calls report no background", async () => {
    const m = load(null, "android");
    await expect(m.startService({ title: "t", text: "x", pauseLabel: "p", channelName: "c" })).resolves.toBe(false);
    expect(() => m.updateService({ read: 1, total: 2, text: "" })).not.toThrow();
    expect(() => m.stopService()).not.toThrow();
    await expect(m.enqueueWorker({ requiresCharging: true, batteryNotLow: true, unmetered: true, tapText: "t" })).resolves.toBeUndefined();
    await expect(m.requestNotificationPermission()).resolves.toBe(false);
  });
});

describe("dosya-personas-background manual mock", () => {
  type Mock = typeof import("./__mocks__/index");
  let mock: Mock;
  beforeEach(() => {
    jest.isolateModules(() => {
      mock = jest.requireActual("./__mocks__/index") as Mock;
    });
  });

  it("buffers windows and expiries until the first listener, then delivers each once, in order", () => {
    mock.__native.emitWindow({ id: "a", kind: "processing", deadlineMs: 1 });
    mock.__native.emitExpired("a");
    mock.__native.emitWindow({ id: "b", kind: "continued", deadlineMs: 2 });
    const windows: string[] = [];
    const expired: string[] = [];
    mock.onWindow((w) => windows.push(w.id));
    expect(windows).toEqual(["a", "b"]);
    mock.onWindowExpired((id) => expired.push(id));
    expect(expired).toEqual(["a"]);
    const late: string[] = [];
    mock.onWindow((w) => late.push(w.id));
    expect(late).toEqual([]);
    mock.__native.emitWindow({ id: "c", kind: "processing", deadlineMs: 3 });
    expect(windows).toEqual(["a", "b", "c"]);
    expect(late).toEqual(["c"]);
  });

  it("buffers again once every listener has gone", () => {
    const off = mock.onWindow(() => undefined);
    off();
    mock.__native.emitWindow({ id: "z", kind: "processing", deadlineMs: 1 });
    const got: string[] = [];
    mock.onWindow((w) => got.push(w.id));
    expect(got).toEqual(["z"]);
  });

  it("buffers Pause presses until the first listener, like windows", () => {
    mock.__native.emitPause();
    mock.__native.emitPause();
    let presses = 0;
    mock.onPausePressed(() => presses++);
    expect(presses).toBe(2);
    mock.__native.emitPause();
    expect(presses).toBe(3);
  });

  it("Android defaults: the service starts, the worker enqueues, notifications are allowed", async () => {
    await expect(mock.startService({ title: "t", text: "x", pauseLabel: "p", channelName: "c" })).resolves.toBe(true);
    mock.updateService({ read: 1, total: 2, text: "1 of 2" });
    expect(mock.updateService).toHaveBeenCalledWith({ read: 1, total: 2, text: "1 of 2" });
    mock.stopService();
    expect(mock.stopService).toHaveBeenCalled();
    await mock.enqueueWorker({ requiresCharging: true, batteryNotLow: false, unmetered: true, tapText: "t" });
    expect(mock.enqueueWorker).toHaveBeenCalledWith({ requiresCharging: true, batteryNotLow: false, unmetered: true, tapText: "t" });
    await expect(mock.requestNotificationPermission()).resolves.toBe(true);
  });

  it("records windowDone, and is available with no continued task by default", async () => {
    mock.windowDone("a", true);
    expect(mock.windowDone).toHaveBeenCalledWith("a", true);
    expect(mock.isPersonasBackgroundAvailable()).toBe(true);
    expect(mock.supportsContinued()).toBe(false);
    await expect(mock.startContinued({ title: "t", subtitle: "s" })).resolves.toBe(false);
    await expect(mock.backgroundBlocks()).resolves.toEqual([]);
  });
});
