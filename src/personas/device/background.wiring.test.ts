// definePersonasBackground (./background.ts): the native module's windows go
// to the runner, end with windowDone, and the follow-ups (iOS reschedule, the
// Android service stop, the WorkManager fallback, Pause, sign-out) reach the
// native side.
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
// The real t() (English): the native strings are translated in JS.
jest.mock("@/lib/i18n", () => ({ ...jest.requireActual("@/lib/i18n"), ensureI18n: jest.fn(async () => {}) }));
jest.mock("../../../modules/dosya-personas-background");

import * as native from "../../../modules/dosya-personas-background";
import type * as mock from "../../../modules/dosya-personas-background/__mocks__";
import {
  __resetPersonasBackgroundForTests,
  definePersonasBackground,
  personasContinuedActive,
  personasHeadlessTask,
  startPersonasContinued,
  startPersonasService,
  subscribePersonasContinued,
  stopPersonasService,
  type BackgroundWiring,
  type WindowEnd,
  type WindowOptions,
} from "./background";

const n = native as jest.Mocked<typeof native>;
const { __native } = native as unknown as typeof mock;

type Call = { opts: WindowOptions; finish(e: WindowEnd): void };

function wire(over: Partial<BackgroundWiring> = {}) {
  const runs: Call[] = [];
  const teardown = new Set<() => void>();
  const pauseAll = jest.fn(async () => {});
  const replan = jest.fn(async () => {});
  let mode: { mode: "open" | "charging" | "anytime" | "none"; mobileData: boolean } = { mode: "charging", mobileData: false };
  let active = false;
  const w: BackgroundWiring = {
    run: (opts) =>
      new Promise<WindowEnd>((resolve) => {
        runs.push({ opts, finish: resolve });
      }),
    pauseAll,
    replan,
    backgroundMode: async () => mode,
    onTeardown: (fn) => {
      teardown.add(fn);
      return () => teardown.delete(fn);
    },
    appActive: () => active,
    ...over,
  };
  definePersonasBackground(w);
  return {
    runs,
    pauseAll,
    replan,
    setMode: (m: typeof mode) => (mode = m),
    setActive: (a: boolean) => (active = a),
    signOut: () => {
      for (const fn of [...teardown]) fn();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  __resetPersonasBackgroundForTests();
  __native.reset();
  jest.clearAllMocks();
});

describe("definePersonasBackground", () => {
  it("runs each window and ends it with windowDone(moreLeft)", async () => {
    const { runs } = wire();
    __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 123 });
    expect(runs).toHaveLength(1);
    expect(runs[0].opts).toMatchObject({ deadlineMs: 123, kind: "worker" });
    expect(runs[0].opts.signal.aborted).toBe(false);
    expect(n.windowDone).not.toHaveBeenCalled();
    runs[0].finish({ moreLeft: true, reason: "deadline" });
    await flush();
    expect(n.windowDone).toHaveBeenCalledWith("w1", true);
  });

  it("takes the windows native buffered before it listened, in order", async () => {
    __native.emitWindow({ id: "a", kind: "worker", deadlineMs: 1 });
    __native.emitWindow({ id: "b", kind: "worker", deadlineMs: 2 });
    const { runs } = wire();
    expect(runs.map((r) => r.opts.deadlineMs)).toEqual([1, 2]);
  });

  it("a runner that throws still ends the window, with more left", async () => {
    wire({ run: async () => { throw new Error("boom"); } });
    __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
    await flush();
    expect(n.windowDone).toHaveBeenCalledWith("w1", true);
  });

  it("expiry aborts the window", async () => {
    const { runs } = wire();
    __native.emitWindow({ id: "w1", kind: "processing", deadlineMs: 1 });
    __native.emitExpired("w1");
    expect(runs[0].opts.signal.aborted).toBe(true);
  });

  it("expiry for a window it never saw is ignored (after a JS reload)", async () => {
    const { runs } = wire();
    __native.emitWindow({ id: "w1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
    __native.emitExpired("old");
    await flush();
    expect(runs[0].opts.signal.aborted).toBe(false);
    expect(n.enqueueWorker).not.toHaveBeenCalled();
  });

  it("pause pressed pauses every engine, stops the service, cancels the work, and no window asks for more", async () => {
    const { runs, pauseAll } = wire();
    __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
    __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
    __native.emitPause();
    await flush();
    expect(pauseAll).toHaveBeenCalledTimes(1);
    expect(n.stopService).toHaveBeenCalled();
    expect(n.cancelWindows).toHaveBeenCalled();
    expect(runs.every((r) => r.opts.signal.aborted)).toBe(true);
    // The runner reports "aborted, more left"; after a pause nothing more is asked for.
    for (const r of runs) r.finish({ moreLeft: true, reason: "aborted" });
    await flush();
    expect(n.windowDone).toHaveBeenCalledWith("s1", false);
    expect(n.windowDone).toHaveBeenCalledWith("w1", false);
    // The service went down with the pause: its expiry is not a reason for the fallback worker.
    __native.emitExpired("s1");
    await flush();
    expect(n.enqueueWorker).not.toHaveBeenCalled();
  });

  it("a window after the pause may ask for more again", async () => {
    const { runs } = wire();
    __native.emitPause();
    await flush();
    __native.emitWindow({ id: "w2", kind: "worker", deadlineMs: 1 });
    runs[0].finish({ moreLeft: true, reason: "deadline" });
    await flush();
    expect(n.windowDone).toHaveBeenCalledWith("w2", true);
  });

  describe("iOS", () => {
    it("a window that ends with more left asks for the next one with the current mode", async () => {
      const { runs, setMode } = wire();
      __native.emitWindow({ id: "p1", kind: "processing", deadlineMs: 1 });
      setMode({ mode: "anytime", mobileData: false });
      runs[0].finish({ moreLeft: true, reason: "deadline" });
      await flush();
      expect(n.windowDone).toHaveBeenCalledWith("p1", true);
      expect(n.scheduleWindow).toHaveBeenCalledWith({ requiresPower: false });
    });

    it("a continued task that ends with more left leaves a processing request behind", async () => {
      const { runs } = wire();
      __native.emitWindow({ id: "c1", kind: "continued", deadlineMs: 1 });
      runs[0].finish({ moreLeft: true, reason: "gate" });
      await flush();
      expect(n.scheduleWindow).toHaveBeenCalledWith({ requiresPower: true });
    });

    it("done, or a mode with no background, asks for nothing", async () => {
      const { runs, setMode } = wire();
      __native.emitWindow({ id: "p1", kind: "processing", deadlineMs: 1 });
      runs[0].finish({ moreLeft: false, reason: "done" });
      await flush();
      setMode({ mode: "open", mobileData: false });
      __native.emitWindow({ id: "p2", kind: "processing", deadlineMs: 1 });
      runs[1].finish({ moreLeft: true, reason: "deadline" });
      await flush();
      setMode({ mode: "none", mobileData: false });
      __native.emitWindow({ id: "p3", kind: "processing", deadlineMs: 1 });
      runs[2].finish({ moreLeft: true, reason: "deadline" });
      await flush();
      expect(n.scheduleWindow).not.toHaveBeenCalled();
    });

    it("progress goes to the continued task's system UI", async () => {
      const { runs } = wire();
      __native.emitWindow({ id: "c1", kind: "continued", deadlineMs: 1 });
      runs[0].opts.onProgress?.({ read: 1240, total: 8000 });
      expect(n.setWindowProgress).toHaveBeenCalledWith("c1", { read: 1240, total: 8000, text: "1,240 of 8,000" });
      expect(n.updateService).not.toHaveBeenCalled();
    });
  });

  describe("continued task flag", () => {
    it("is set while the continued task is being started, until its window opens, and while that window runs", async () => {
      wire();
      const fn = jest.fn();
      subscribePersonasContinued(fn);
      expect(personasContinuedActive()).toBe(false);
      let resolve!: (ok: boolean) => void;
      n.startContinued.mockImplementationOnce(() => new Promise<boolean>((r) => { resolve = r; }));
      const started = startPersonasContinued({ title: "T", subtitle: "S" });
      expect(personasContinuedActive()).toBe(true);
      expect(fn).toHaveBeenCalled();
      // A second start while one is on its way submits nothing.
      expect(await startPersonasContinued({ title: "T", subtitle: "S" })).toBe(false);
      expect(n.startContinued).toHaveBeenCalledTimes(1);
      resolve(true);
      expect(await started).toBe(true);
      // Submitted: still set until iOS hands the window over.
      expect(personasContinuedActive()).toBe(true);
      __native.emitWindow({ id: "c1", kind: "continued", deadlineMs: 1 });
      expect(personasContinuedActive()).toBe(true);
      fn.mockClear();
    });

    it("clears when the continued window ends", async () => {
      const { runs } = wire();
      const fn = jest.fn();
      subscribePersonasContinued(fn);
      __native.emitWindow({ id: "c1", kind: "continued", deadlineMs: 1 });
      expect(personasContinuedActive()).toBe(true);
      runs[0].finish({ moreLeft: false, reason: "done" });
      await flush();
      expect(personasContinuedActive()).toBe(false);
      expect(fn).toHaveBeenCalled();
    });

    it("clears when iOS refuses the task, or when no window arrives in time", async () => {
      jest.useFakeTimers();
      try {
        wire();
        n.startContinued.mockResolvedValueOnce(false);
        expect(await startPersonasContinued({ title: "T", subtitle: "S" })).toBe(false);
        expect(personasContinuedActive()).toBe(false);
        n.startContinued.mockResolvedValueOnce(true);
        expect(await startPersonasContinued({ title: "T", subtitle: "S" })).toBe(true);
        expect(personasContinuedActive()).toBe(true);
        jest.advanceTimersByTime(60_000);
        expect(personasContinuedActive()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("other windows do not set it", () => {
      wire();
      __native.emitWindow({ id: "p1", kind: "processing", deadlineMs: 1 });
      expect(personasContinuedActive()).toBe(false);
    });
  });

  describe("Android service", () => {
    it.each(["gate", "policy", "done", "signedOut", "noReader", "busy", "cap", "memory", "error", "deadline"] as const)(
      "a service window ending with %s while the app is away stops the service (no notification with nothing reading), then plans again",
      async (reason) => {
        const { runs, replan } = wire();
        __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
        const more = !["policy", "done", "signedOut", "noReader"].includes(reason);
        runs[0].finish({ moreLeft: more, reason });
        await flush();
        expect(n.windowDone).toHaveBeenCalledWith("s1", more);
        expect(n.stopService).toHaveBeenCalledTimes(1);
        expect(replan).toHaveBeenCalledTimes(1);
        expect(n.stopService.mock.invocationCallOrder[0]).toBeLessThan(replan.mock.invocationCallOrder[0]);
      },
    );

    it("a service window the app took over (aborted) leaves the service up for the next background transition", async () => {
      const { runs, replan } = wire();
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      runs[0].finish({ moreLeft: true, reason: "aborted" });
      await flush();
      expect(n.windowDone).toHaveBeenCalledWith("s1", true);
      expect(n.stopService).not.toHaveBeenCalled();
      expect(replan).not.toHaveBeenCalled();
    });

    it("a service window at its deadline with the app back in front leaves the service up", async () => {
      const { runs, replan, setActive } = wire();
      setActive(true);
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      runs[0].finish({ moreLeft: true, reason: "deadline" });
      await flush();
      expect(n.stopService).not.toHaveBeenCalled();
      expect(replan).not.toHaveBeenCalled();
    });

    it.each([
      [{ moreLeft: false, reason: "done" } as const, true],
      [{ moreLeft: true, reason: "deadline" } as const, false],
      [{ moreLeft: true, reason: "busy" } as const, false],
    ])("after a worker window (%o) the plan is made again; the service stops when nothing is left: %s", async (e, stops) => {
      const { runs, replan } = wire();
      __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
      runs[0].finish(e);
      await flush();
      expect(n.windowDone).toHaveBeenCalledWith("w1", e.moreLeft);
      expect(replan).toHaveBeenCalledTimes(1);
      expect(n.stopService).toHaveBeenCalledTimes(stops ? 1 : 0);
      expect(n.windowDone.mock.invocationCallOrder[0]).toBeLessThan(replan.mock.invocationCallOrder[0]);
    });

    it("the service's expiry (Android 15's daily budget) aborts and falls back to WorkManager", async () => {
      const { runs, setMode } = wire();
      setMode({ mode: "anytime", mobileData: true });
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      __native.emitExpired("s1");
      await flush();
      expect(runs[0].opts.signal.aborted).toBe(true);
      expect(n.enqueueWorker).toHaveBeenCalledWith({
        requiresCharging: false,
        batteryNotLow: true,
        unmetered: false,
        tapText: "Tap to keep reading photos for Personas",
      });
    });

    it("the expiry of a service JS stopped is not a reason for the fallback worker", async () => {
      const { runs } = wire();
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      stopPersonasService();
      __native.emitExpired("s1");
      await flush();
      expect(runs[0].opts.signal.aborted).toBe(true);
      expect(n.enqueueWorker).not.toHaveBeenCalled();
    });

    it("a worker window's expiry does not enqueue (the worker re-enqueues itself)", async () => {
      wire();
      __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
      __native.emitExpired("w1");
      await flush();
      expect(n.enqueueWorker).not.toHaveBeenCalled();
    });

    it("progress goes to the notification", async () => {
      const { runs } = wire();
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      runs[0].opts.onProgress?.({ read: 3, total: 10 });
      expect(n.updateService).toHaveBeenCalledWith({ read: 3, total: 10, text: "3 of 10" });
      expect(n.setWindowProgress).not.toHaveBeenCalled();
    });

    it("starts the service once with its strings, and again after a stop", async () => {
      wire();
      expect(await startPersonasService()).toBe(true);
      expect(await startPersonasService()).toBe(true);
      expect(n.startService).toHaveBeenCalledTimes(1);
      expect(n.startService).toHaveBeenCalledWith({ title: "Reading photos for Personas", text: "", pauseLabel: "Pause", channelName: "Personas" });
      stopPersonasService();
      await startPersonasService();
      expect(n.startService).toHaveBeenCalledTimes(2);
    });

    it("a refused start is tried again next time", async () => {
      wire();
      n.startService.mockResolvedValueOnce(false);
      expect(await startPersonasService()).toBe(false);
      expect(await startPersonasService()).toBe(true);
      expect(n.startService).toHaveBeenCalledTimes(2);
    });

    it("native stopping the service with no window open lets the next start through", async () => {
      wire();
      await startPersonasService();
      __native.emitServiceStopped();
      await startPersonasService();
      expect(n.startService).toHaveBeenCalledTimes(2);
    });

    it("the service's expiry lets the next start through", async () => {
      wire();
      await startPersonasService();
      __native.emitWindow({ id: "s1", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
      __native.emitExpired("s1");
      await flush();
      await startPersonasService();
      expect(n.startService).toHaveBeenCalledTimes(2);
    });
  });

  it("sign-out cancels every request and stops the service", async () => {
    const { signOut } = wire();
    signOut();
    await flush();
    expect(n.cancelWindows).toHaveBeenCalled();
    expect(n.stopService).toHaveBeenCalled();
  });

  it("is defined once", () => {
    const { runs } = wire();
    definePersonasBackground();
    __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
    expect(runs).toHaveLength(1);
  });
});

describe("personasHeadlessTask", () => {
  it("hydrates the language, then lasts until its worker window has ended", async () => {
    const { ensureI18n } = jest.requireMock("@/lib/i18n") as { ensureI18n: jest.Mock };
    const { runs } = wire();
    let finished = false;
    const task = personasHeadlessTask({ id: "w9", deadlineMs: Date.now() + 60_000 }).then(() => (finished = true));
    await flush();
    expect(ensureI18n).toHaveBeenCalled();
    __native.emitWindow({ id: "other", kind: "service", deadlineMs: Number.MAX_SAFE_INTEGER });
    __native.emitWindow({ id: "w9", kind: "worker", deadlineMs: 1 });
    runs[0].finish({ moreLeft: false, reason: "done" });
    await flush();
    expect(finished).toBe(false);
    runs[1].finish({ moreLeft: true, reason: "deadline" });
    await task;
    expect(finished).toBe(true);
    expect(n.windowDone).toHaveBeenCalledWith("w9", true);
  });

  it("a window that already ended before the task asked ends the task at once", async () => {
    const { runs } = wire();
    __native.emitWindow({ id: "w1", kind: "worker", deadlineMs: 1 });
    runs[0].finish({ moreLeft: false, reason: "done" });
    await flush();
    await expect(personasHeadlessTask({ id: "w1", deadlineMs: Date.now() + 60_000 })).resolves.toBeUndefined();
  });

  it("does not outlast its deadline when the window never comes", async () => {
    jest.useFakeTimers();
    try {
      wire();
      let finished = false;
      void personasHeadlessTask({ id: "never", deadlineMs: Date.now() + 1_000 }).then(() => (finished = true));
      await jest.advanceTimersByTimeAsync(60_000);
      expect(finished).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("memory warnings", () => {
  it("the native warning ends a running window with memory", async () => {
    const { runPersonasWindow } = jest.requireActual("./background") as typeof import("./background");
    const gate = { allows: () => true, subscribe: () => () => undefined };
    let release: () => void = () => undefined;
    const engine = {
      status: async () => ({ state: "ready" as const, read: 0, total: 10, reading: false, paused: false }),
      readSome: (_n: number, signal?: AbortSignal) =>
        new Promise<number>((r) => {
          release = () => r(0);
          signal?.addEventListener("abort", () => r(0));
        }),
      subscribe: () => () => undefined,
    };
    const ending = runPersonasWindow(
      { deadlineMs: Date.now() + 600_000, signal: new AbortController().signal, kind: "worker" },
      {
        hydrate: async () => {},
        user: () => "u1",
        readerReady: async () => true,
        workspaces: async () => ["w1"],
        engine: () => engine as never,
        gate: () => gate,
        policy: async () => ({ background: "on", maxPhotosPerWindow: 2000 }),
        mode: async () => "anytime",
        charging: async () => true,
        onTeardown: () => () => undefined,
        onAppActive: () => () => undefined,
        memoryFootprint: () => -1,
        platform: "android",
        unload: async () => {},
        record: async () => {},
        // onMemoryWarning left to the app's: the native module's event.
      },
    );
    for (let i = 0; i < 50; i++) await Promise.resolve();
    __native.emitMemoryWarning();
    release();
    await expect(ending).resolves.toEqual({ moreLeft: true, reason: "memory" });
  });

  it("the engines' native reader listens to the native warning", () => {
    jest.isolateModules(() => {
      jest.doMock("./native-host", () => ({
        personasNativeReader: jest.fn(),
        setPersonasMemoryWarnings: jest.fn(),
        unloadPersonasNativeReader: jest.fn(async () => {}),
      }));
      const host = require("./native-host") as { setPersonasMemoryWarnings: jest.Mock };
      const bgNative = require("../../../modules/dosya-personas-background") as typeof native;
      require("./engine-host");
      expect(host.setPersonasMemoryWarnings).toHaveBeenCalledWith(bgNative.onMemoryWarning);
    });
  });
});
