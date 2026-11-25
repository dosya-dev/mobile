// The Personas background schedule (./schedule.ts): which OS windows to ask
// for, from the read mode, the remote switch, the reader, the work left and
// the app state; and the sync that gathers that state and applies the plan.
jest.mock("@sentry/react-native", () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));

import type { DevicePolicy } from "./policy";
import type { ReadSettings } from "./settings";
import { planSchedule, syncPersonasSchedule, watchPersonasSchedule, type ScheduleAction, type ScheduleDeps, type ScheduleState, type WatchSources } from "./schedule";

const on: DevicePolicy = { background: "on", maxPhotosPerWindow: 2000 };
const base: ScheduleState = {
  platform: "android",
  appState: "background",
  settings: { mode: "charging", mobileData: false },
  policy: on,
  readerReady: true,
  workLeft: true,
  gateBackgroundOpen: true,
  notificationsOn: true,
  signedIn: true,
};
const st = (over: Partial<ScheduleState> = {}, settings: Partial<ReadSettings> = {}): ScheduleState => ({
  ...base,
  ...over,
  settings: { ...base.settings, ...settings },
});
const cancelAll: ScheduleAction = { kind: "cancelAll" };

describe("planSchedule", () => {
  it.each<[string, ScheduleState, ScheduleAction[]]>([
    ["ios background, charging", st({ platform: "ios" }), [{ kind: "iosSchedule", requiresPower: true }]],
    ["ios background, anytime", st({ platform: "ios" }, { mode: "anytime" }), [{ kind: "iosSchedule", requiresPower: false }]],
    ["ios active keeps what is asked for", st({ platform: "ios", appState: "active" }), []],
    ["ios inactive keeps what is asked for", st({ platform: "ios", appState: "inactive" }), []],
    ["ios ignores the gate", st({ platform: "ios", gateBackgroundOpen: false }), [{ kind: "iosSchedule", requiresPower: true }]],
    ["android active, gate open: service", st({ appState: "active" }), [{ kind: "androidService" }]],
    ["android active, gate closed: stop the service", st({ appState: "active", gateBackgroundOpen: false }), [{ kind: "stopService" }]],
    [
      "android background, gate open: worker only (the service was started while open)",
      st(),
      [{ kind: "androidWorker", requiresCharging: true, batteryNotLow: false, unmetered: true }],
    ],
    [
      "android background, gate closed: stop the service, keep the worker",
      st({ gateBackgroundOpen: false }),
      [{ kind: "stopService" }, { kind: "androidWorker", requiresCharging: true, batteryNotLow: false, unmetered: true }],
    ],
    [
      "android anytime with mobile data",
      st({}, { mode: "anytime", mobileData: true }),
      [{ kind: "androidWorker", requiresCharging: false, batteryNotLow: true, unmetered: false }],
    ],
    ["android active, notifications off: no service (the worker reads)", st({ appState: "active", notificationsOn: false }), [{ kind: "stopService" }]],
    [
      "android background, notifications off: stop the service, keep the worker",
      st({ notificationsOn: false }),
      [{ kind: "stopService" }, { kind: "androidWorker", requiresCharging: true, batteryNotLow: false, unmetered: true }],
    ],
    ["no work left", st({ workLeft: false }), [cancelAll]],
    ["no work left on ios", st({ platform: "ios", workLeft: false }), [cancelAll]],
  ])("%s", (_name, s, want) => {
    expect(planSchedule(s)).toEqual(want);
  });

  it("remote off cancels everything", () => {
    for (const platform of ["ios", "android"] as const) {
      for (const appState of ["active", "background"] as const) {
        expect(planSchedule(st({ platform, appState, policy: { ...on, background: "off" } }))).toEqual([cancelAll]);
      }
    }
  });

  it("remote charging turns anytime into charging", () => {
    const policy: DevicePolicy = { ...on, background: "charging" };
    expect(planSchedule(st({ platform: "ios", policy }, { mode: "anytime" }))).toEqual([{ kind: "iosSchedule", requiresPower: true }]);
    expect(planSchedule(st({ policy }, { mode: "anytime" }))).toEqual([
      { kind: "androidWorker", requiresCharging: true, batteryNotLow: false, unmetered: true },
    ]);
  });

  it("signed out cancels everything", () => {
    expect(planSchedule(st({ signedIn: false }))).toEqual([cancelAll]);
    expect(planSchedule(st({ platform: "ios", signedIn: false }))).toEqual([cancelAll]);
    expect(planSchedule(st({ appState: "active", signedIn: false }))).toEqual([cancelAll]);
  });

  it("open mode never schedules", () => {
    for (const platform of ["ios", "android"] as const) {
      for (const appState of ["active", "background", "inactive"] as const) {
        expect(planSchedule(st({ platform, appState }, { mode: "open" }))).toEqual([cancelAll]);
      }
    }
  });

  it("no models never schedules", () => {
    expect(planSchedule(st({ readerReady: false }))).toEqual([cancelAll]);
    expect(planSchedule(st({ platform: "ios", readerReady: false }))).toEqual([cancelAll]);
    expect(planSchedule(st({ appState: "active", readerReady: false }))).toEqual([cancelAll]);
  });

  it("android charging mode starts service only while charging", () => {
    // The background gate in "While charging" is open only on a charger.
    expect(planSchedule(st({ appState: "active", gateBackgroundOpen: true }))).toContainEqual({ kind: "androidService" });
    expect(planSchedule(st({ appState: "active", gateBackgroundOpen: false }))).not.toContainEqual({ kind: "androidService" });
    expect(planSchedule(st({ appState: "active", gateBackgroundOpen: false }))).toContainEqual({ kind: "stopService" });
  });

  it("the service is never started from the background (Android 12+ forbids it)", () => {
    expect(planSchedule(st({ appState: "background" }))).not.toContainEqual({ kind: "androidService" });
    expect(planSchedule(st({ appState: "inactive" }))).not.toContainEqual({ kind: "androidService" });
  });

  // Ruling 1 replaces the plan's "return to foreground stops the service": the
  // service is started while the app is open and stays up when it comes back.
  it("return to foreground keeps the service", () => {
    const back = planSchedule(st({ appState: "active" }));
    expect(back).not.toContainEqual({ kind: "stopService" });
    expect(back).not.toContainEqual(cancelAll);
    expect(back).toEqual([{ kind: "androidService" }]);
  });

  it("return to foreground keeps the worker and the iOS request", () => {
    expect(planSchedule(st({ appState: "active" }))).not.toContainEqual(cancelAll);
    expect(planSchedule(st({ platform: "ios", appState: "active" }))).toEqual([]);
  });
});

function deps(over: Partial<ScheduleDeps> = {}) {
  const applied: ScheduleAction[][] = [];
  const calls: string[] = [];
  const d: ScheduleDeps = {
    platform: "android",
    appState: () => "background",
    signedIn: () => true,
    settings: async () => ({ mode: "charging", mobileData: false }),
    readerReady: async () => {
      calls.push("readerReady");
      return true;
    },
    policy: async () => {
      calls.push("policy");
      return on;
    },
    workLeft: async () => {
      calls.push("workLeft");
      return true;
    },
    gateBackgroundOpen: () => {
      calls.push("gate");
      return true;
    },
    notificationsOn: async () => {
      calls.push("notifications");
      return true;
    },
    apply: async (a) => {
      applied.push(a);
    },
    boundMs: 50,
    quickBoundMs: 20,
    ...over,
  };
  return { d, applied, calls };
}

describe("syncPersonasSchedule", () => {
  it("with notifications denied, does not start the Android service in front", async () => {
    const { d, applied, calls } = deps({ appState: () => "active", notificationsOn: async () => (calls.push("notifications"), false) });
    await syncPersonasSchedule(d);
    expect(calls).toContain("notifications");
    expect(applied).toEqual([[{ kind: "stopService" }]]);
  });

  it("with notifications allowed, starts it", async () => {
    const { d, applied } = deps({ appState: () => "active" });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[{ kind: "androidService" }]]);
  });

  it("gathers the state and applies the plan", async () => {
    const { d, applied } = deps();
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[{ kind: "androidWorker", requiresCharging: true, batteryNotLow: false, unmetered: true }]]);
  });

  it("signed out cancels without asking the reader, the server or the engines", async () => {
    const { d, applied, calls } = deps({ signedIn: () => false });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[cancelAll]]);
    expect(calls).toEqual([]);
  });

  it("open mode cancels without asking the server", async () => {
    const { d, applied, calls } = deps({ settings: async () => ({ mode: "open", mobileData: false }) });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[cancelAll]]);
    expect(calls).toEqual([]);
  });

  it("no models cancels without asking the server (most users never read on this phone)", async () => {
    const { d, applied, calls } = deps({ readerReady: async () => (calls.push("readerReady"), false) });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[cancelAll]]);
    expect(calls).toEqual(["readerReady"]);
  });

  it("remote off cancels, and never reads the gate", async () => {
    const { d, applied, calls } = deps({ policy: async () => ({ ...on, background: "off" }) });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[cancelAll]]);
    expect(calls).not.toContain("gate");
  });

  it("iOS going to the background asks the remote switch and the work together, under one short bound, then schedules anyway", async () => {
    jest.useFakeTimers();
    try {
      const { d, applied } = deps({
        platform: "ios",
        boundMs: 4_000,
        quickBoundMs: 2_000,
        policy: () => new Promise<DevicePolicy>(() => undefined),
        workLeft: () => new Promise<boolean>(() => undefined),
      });
      const done = syncPersonasSchedule(d);
      await jest.advanceTimersByTimeAsync(1_999);
      expect(applied).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      await done;
      // Not 2 x 4 s one after the other: iOS would have suspended the app.
      expect(applied).toEqual([[{ kind: "iosSchedule", requiresPower: true }]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("the short bound is only for iOS going to the background", async () => {
    jest.useFakeTimers();
    try {
      const { d, applied } = deps({
        boundMs: 4_000,
        quickBoundMs: 2_000,
        appState: () => "active",
        workLeft: () => new Promise<boolean>(() => undefined),
      });
      const done = syncPersonasSchedule(d);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(applied).toEqual([]);
      await jest.advanceTimersByTimeAsync(2_000);
      await done;
      expect(applied).toEqual([[{ kind: "androidService" }]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("iOS never reads the gate", async () => {
    const { d, applied, calls } = deps({ platform: "ios" });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[{ kind: "iosSchedule", requiresPower: true }]]);
    expect(calls).not.toContain("gate");
  });

  it("a work count that does not answer in time counts as work left (the window finds out)", async () => {
    const { d, applied } = deps({ platform: "ios", workLeft: () => new Promise<boolean>(() => undefined) });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[{ kind: "iosSchedule", requiresPower: true }]]);
  });

  it("a remote switch that does not answer in time does not hold the sync", async () => {
    const { d, applied } = deps({ platform: "ios", policy: () => new Promise<DevicePolicy>(() => undefined) });
    await syncPersonasSchedule(d);
    expect(applied).toEqual([[{ kind: "iosSchedule", requiresPower: true }]]);
  });

  it("syncs asked for while one runs are folded into one more", async () => {
    let release: () => void = () => undefined;
    let n = 0;
    const { d, applied } = deps({
      workLeft: async () => {
        n++;
        if (n === 1) await new Promise<void>((r) => (release = r));
        return true;
      },
    });
    const a = syncPersonasSchedule(d);
    const b = syncPersonasSchedule(d);
    const c = syncPersonasSchedule(d);
    await Promise.resolve();
    release();
    await Promise.all([a, b, c]);
    expect(applied).toHaveLength(2);
  });

  it("a failing apply does not break the next sync", async () => {
    let fail = true;
    const { d, applied } = deps({
      apply: async (a) => {
        if (fail) {
          fail = false;
          throw new Error("native");
        }
        applied.push(a);
      },
    });
    await syncPersonasSchedule(d);
    await syncPersonasSchedule(d);
    expect(applied).toHaveLength(1);
  });
});

describe("watchPersonasSchedule", () => {
  function sources() {
    const subs: Record<"appState" | "settings" | "reader" | "user" | "host", Set<() => void>> = {
      appState: new Set(),
      settings: new Set(),
      reader: new Set(),
      user: new Set(),
      host: new Set(),
    };
    const on = (k: keyof typeof subs) => (fn: () => void) => {
      subs[k].add(fn);
      return () => {
        subs[k].delete(fn);
      };
    };
    const sync = jest.fn();
    const src: WatchSources = {
      sync,
      onAppState: on("appState"),
      onSettings: on("settings"),
      onReader: on("reader"),
      onUser: on("user"),
      onHost: on("host"),
    };
    const fire = (k: keyof typeof subs) => {
      for (const fn of [...subs[k]]) fn();
    };
    return { src, sync, subs, fire };
  }

  it("syncs once at the start", () => {
    const { src, sync } = sources();
    const off = watchPersonasSchedule(src);
    expect(sync).toHaveBeenCalledTimes(1);
    off();
  });

  it.each(["appState", "settings", "reader", "user", "host"] as const)("one %s change triggers exactly one sync", (k) => {
    const { src, sync, fire } = sources();
    const off = watchPersonasSchedule(src);
    sync.mockClear();
    fire(k);
    expect(sync).toHaveBeenCalledTimes(1);
    off();
  });

  it("unsubscribes everything", () => {
    const { src, subs } = sources();
    watchPersonasSchedule(src)();
    for (const set of Object.values(subs)) expect(set.size).toBe(0);
  });
});
