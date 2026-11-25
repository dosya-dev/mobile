jest.mock("expo-task-manager", () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => false) }));
jest.mock("expo-background-task", () => ({
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
const mockNet = { listeners: [] as ((e: { isConnected?: boolean; type?: string }) => void)[] };
jest.mock("expo-network", () => ({
  NetworkStateType: { NONE: "NONE", CELLULAR: "CELLULAR", WIFI: "WIFI", ETHERNET: "ETHERNET" },
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, type: "WIFI" })),
  addNetworkStateListener: jest.fn((fn: (e: unknown) => void) => {
    mockNet.listeners.push(fn);
    return { remove: () => { mockNet.listeners = mockNet.listeners.filter((l) => l !== fn); } };
  }),
}));
jest.mock("./sync", () => ({ runOfflineSync: jest.fn(async () => {}) }));
const mockUser = { value: { id: "acct" } as { id: string } | null };
jest.mock("@/auth/tokenStore", () => ({ loadUser: jest.fn(async () => mockUser.value) }));
const mockSession = { value: null as null | { accountId: string } };
jest.mock("./session", () => ({
  currentSession: jest.fn(() => mockSession.value),
  beginSession: jest.fn((id: string) => { mockSession.value = { accountId: id }; return mockSession.value; }),
}));
jest.mock("./offlineStore", () => {
  const listeners: ((s: { pins: unknown[] }) => void)[] = [];
  const state = { pins: [] as unknown[], refresh: jest.fn(async () => {}) };
  return {
    useOfflineStore: {
      getState: () => state,
      subscribe: (fn: (s: { pins: unknown[] }) => void) => { listeners.push(fn); return () => {}; },
      __emit: (pins: unknown[]) => { state.pins = pins; for (const l of listeners) l(state); },
    },
  };
});

import { AppState } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { runOfflineSync } from "./sync";
import { beginSession } from "./session";
import { useOfflineStore } from "./offlineStore";
import {
  OFFLINE_TASK, FOREGROUND_THROTTLE_MS, defineOfflineTask, syncRegistration, startOfflineTriggers,
  __resetOfflineTriggersForTests,
} from "./background";

type AppStateFn = (s: string) => void;
let appStateHandlers: AppStateFn[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockNet.listeners = [];
  appStateHandlers = [];
  mockSession.value = { accountId: "acct" };
  mockUser.value = { id: "acct" };
  __resetOfflineTriggersForTests();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, fn: AppStateFn) => {
    appStateHandlers.push(fn);
    return { remove: () => { appStateHandlers = appStateHandlers.filter((h) => h !== fn); } };
  }) as never);
});

const foreground = () => { for (const h of appStateHandlers) h("active"); };
const net = (e: { isConnected?: boolean; type?: string }) => { for (const l of mockNet.listeners) l(e); };
const reasons = () => (runOfflineSync as jest.Mock).mock.calls.map((c) => c[0].reason);

describe("offline triggers", () => {
  it("foreground throttle", () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const stop = startOfflineTriggers();
      expect(reasons()).toEqual(["foreground"]); // the launch itself
      foreground();
      expect(reasons()).toEqual(["foreground"]); // too soon
      jest.setSystemTime(1_000_000 + FOREGROUND_THROTTLE_MS);
      foreground();
      expect(reasons()).toEqual(["foreground", "foreground"]);
      stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it("network regained triggers", () => {
    const stop = startOfflineTriggers();
    (runOfflineSync as jest.Mock).mockClear();
    net({ isConnected: false, type: "NONE" });
    expect(reasons()).toEqual([]);
    net({ isConnected: true, type: "CELLULAR" });
    expect(reasons()).toEqual(["network"]);
    net({ isConnected: true, type: "CELLULAR" });
    expect(reasons()).toEqual(["network"]); // no change, no run
    net({ isConnected: true, type: "WIFI" }); // Wi-Fi back: transfers may resume
    expect(reasons()).toEqual(["network", "network"]);
    stop();
  });

  it("moving from cellular to Ethernet triggers, like Wi-Fi", () => {
    const stop = startOfflineTriggers();
    net({ isConnected: true, type: "CELLULAR" });
    (runOfflineSync as jest.Mock).mockClear();
    net({ isConnected: true, type: "ETHERNET" });
    expect(reasons()).toEqual(["network"]);
    stop();
  });

  it("stopping removes the listeners", () => {
    const stop = startOfflineTriggers();
    stop();
    (runOfflineSync as jest.Mock).mockClear();
    foreground();
    net({ isConnected: false });
    net({ isConnected: true, type: "WIFI" });
    expect(runOfflineSync).not.toHaveBeenCalled();
  });

  it("registered only with pins", async () => {
    await syncRegistration(true);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(OFFLINE_TASK, { minimumInterval: 60 });
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValueOnce(true);
    await syncRegistration(false);
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(OFFLINE_TASK);
  });

  it("unregistering a task that is not registered is a no-op", async () => {
    await syncRegistration(false);
    expect(BackgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it("registration failures are swallowed", async () => {
    (BackgroundTask.registerTaskAsync as jest.Mock).mockRejectedValueOnce(new Error("Expo Go"));
    await expect(syncRegistration(true)).resolves.toBeUndefined();
  });

  it("the triggers follow whether any pin exists", async () => {
    const stop = startOfflineTriggers();
    (useOfflineStore as unknown as { __emit(p: unknown[]): void }).__emit([{ id: "p" }]);
    await Promise.resolve();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalled();
    stop();
  });

  describe("the task", () => {
    const handler = () => {
      defineOfflineTask();
      const call = (TaskManager.defineTask as jest.Mock).mock.calls.find((c) => c[0] === OFFLINE_TASK);
      return call![1] as () => Promise<number>;
    };

    it("runs a background sync and reports success", async () => {
      expect(await handler()()).toBe(BackgroundTask.BackgroundTaskResult.Success);
      expect(reasons()).toEqual(["background"]);
    });

    it("starts the session from the stored user in a headless launch", async () => {
      mockSession.value = null;
      await handler()();
      expect(beginSession).toHaveBeenCalledWith("acct");
      expect(reasons()).toEqual(["background"]);
    });

    it("does nothing signed out", async () => {
      mockSession.value = null;
      mockUser.value = null;
      expect(await handler()()).toBe(BackgroundTask.BackgroundTaskResult.Success);
      expect(runOfflineSync).not.toHaveBeenCalled();
    });

    it("the task never throws", async () => {
      (runOfflineSync as jest.Mock).mockRejectedValueOnce(new Error("boom"));
      await expect(handler()()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Failed);
    });

    it("is defined once", () => {
      defineOfflineTask();
      defineOfflineTask();
      expect((TaskManager.defineTask as jest.Mock).mock.calls.filter((c) => c[0] === OFFLINE_TASK).length).toBeLessThanOrEqual(1);
    });
  });
});
