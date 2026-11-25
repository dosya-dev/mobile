const mockThermal = { state: "nominal" as string, listeners: [] as Array<(s: string) => void> };
jest.mock("@/perf/thermal", () => ({
  isThermalAvailable: () => true,
  getThermalState: jest.fn(() => mockThermal.state),
  getMemoryFootprint: jest.fn(() => -1),
  addThermalListener: jest.fn((cb: (s: string) => void) => {
    mockThermal.listeners.push(cb);
    return () => {};
  }),
}));
const mockBattery = { state: 1, listeners: [] as Array<(e: { batteryState: number }) => void> };
jest.mock("expo-battery", () => ({
  BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
  getBatteryStateAsync: jest.fn(async () => mockBattery.state),
  addBatteryStateListener: jest.fn((cb: (e: { batteryState: number }) => void) => {
    mockBattery.listeners.push(cb);
    return { remove: () => {} };
  }),
}));

const mockNet = {
  state: { type: "WIFI", isConnected: true, isInternetReachable: true } as { type: string; isConnected: boolean; isInternetReachable?: boolean },
  listeners: [] as Array<(e: { type: string; isConnected: boolean }) => void>,
};
jest.mock("expo-network", () => ({
  NetworkStateType: { WIFI: "WIFI", CELLULAR: "CELLULAR", NONE: "NONE", UNKNOWN: "UNKNOWN" },
  getNetworkStateAsync: jest.fn(async () => mockNet.state),
  addNetworkStateListener: jest.fn((cb: (e: { type: string; isConnected: boolean }) => void) => {
    mockNet.listeners.push(cb);
    return { remove: () => {} };
  }),
}));

import { usePacing, getConcurrencyCap, getBackupConcurrencyCap, getBackupHold, backupCoolingDown, setPolicyOverride, beginManualRunOverride, endManualRunSequence, maybeWithdrawPolicyOverride, resetManualRunOverride, isCoolingDown, startPacingMonitor, __resetPacingMonitor, BASE_CONCURRENCY } from "./pacing";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { useUploadStore } from "./store";
import { usePlayerStore } from "@/player/playerStore";

beforeEach(() => {
  usePacing.setState({ thermal: "nominal", charging: true, connected: true, onWifi: true, policyOverride: { wifi: false, charging: false } });
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  usePlayerStore.setState({ listening: false });
  mockNet.state = { type: "WIFI", isConnected: true, isInternetReachable: true };
  mockNet.listeners.length = 0;
  useUploadStore.setState({ items: [] });
  mockThermal.state = "nominal";
  mockThermal.listeners.length = 0;
  mockBattery.listeners.length = 0;
  __resetPacingMonitor();
  jest.clearAllMocks();
});

describe("music and heat holds on backup", () => {
  it("holds an automatic backup while music plays, and only the backup", () => {
    usePlayerStore.setState({ listening: true });
    expect(getBackupHold()).toBe("keeping cool");
    expect(getBackupConcurrencyCap()).toBe(0);
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
  });

  it("a backup the user started keeps going through the music", () => {
    usePlayerStore.setState({ listening: true });
    usePacing.setState({ policyOverride: { wifi: false, charging: true } });
    expect(getBackupHold()).toBeNull();
  });

  it("a named wait wins, so the screen can say what is missing", () => {
    usePlayerStore.setState({ listening: true });
    usePacing.setState({ connected: false });
    expect(getBackupHold()).toBe("offline");
  });

  it("heat holds an automatic backup but never ends a run the user started", () => {
    usePacing.setState({ thermal: "serious" });
    expect(getBackupHold()).toBe("keeping cool");
    usePacing.setState({ policyOverride: { wifi: false, charging: true } });
    expect(getBackupHold()).toBeNull();
  });

  it("backupCoolingDown says what the pump is doing", () => {
    expect(backupCoolingDown("nominal", false, false)).toBe(false);
    expect(backupCoolingDown("nominal", true, false)).toBe(true);
    expect(backupCoolingDown("nominal", true, true)).toBe(false);
    expect(backupCoolingDown("critical", false, true)).toBe(true);
  });
});

describe("getConcurrencyCap", () => {
  it("runs at full concurrency when cool (regardless of charging)", () => {
    usePacing.setState({ thermal: "nominal", charging: false });
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
  });
  it("drops to 1 when warm on battery, stays full when warm on power", () => {
    usePacing.setState({ thermal: "fair", charging: false });
    expect(getConcurrencyCap()).toBe(1);
    usePacing.setState({ thermal: "fair", charging: true });
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
  });
  it("pauses entirely at serious/critical thermal", () => {
    usePacing.setState({ thermal: "serious", charging: true });
    expect(getConcurrencyCap()).toBe(0);
    expect(isCoolingDown()).toBe(true);
    usePacing.setState({ thermal: "critical", charging: false });
    expect(getConcurrencyCap()).toBe(0);
  });
});

describe("startPacingMonitor", () => {
  it("tracks thermal events and kicks the pump when the cap rises again", async () => {
    const kick = jest.fn();
    startPacingMonitor(kick);
    await Promise.resolve(); // flush the initial battery read

    // Heat up: cap drops 3 -> 0. No kick.
    mockThermal.listeners.forEach((cb) => cb("serious"));
    expect(getConcurrencyCap()).toBe(0);
    expect(kick).not.toHaveBeenCalled();

    // Cool off: cap rises 0 -> 3 and the pump is kicked to auto-resume.
    mockThermal.listeners.forEach((cb) => cb("nominal"));
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("tracks charging state (unplugging while warm shrinks the cap)", async () => {
    const kick = jest.fn();
    startPacingMonitor(kick);
    await Promise.resolve();
    mockThermal.listeners.forEach((cb) => cb("fair"));
    mockBattery.listeners.forEach((cb) => cb({ batteryState: 1 })); // UNPLUGGED
    expect(getConcurrencyCap()).toBe(1);
    mockBattery.listeners.forEach((cb) => cb({ batteryState: 2 })); // CHARGING
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
    expect(kick).toHaveBeenCalled(); // rise 1 -> 3
  });

  it("on Android heat pauses backup but leaves the user's own uploads alone", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as typeof import("react-native");
    const was = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    try {
      mockThermal.state = "critical";
      startPacingMonitor(jest.fn());
      await Promise.resolve();
      expect(usePacing.getState().thermal).toBe("critical");
      expect(getBackupConcurrencyCap()).toBe(0);
      expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY);
      expect(isCoolingDown()).toBe(false);
    } finally {
      mockThermal.state = "nominal";
      Object.defineProperty(Platform, "OS", { value: was, configurable: true });
    }
  });

  it("re-arms the backup pump when the music stops", async () => {
    usePlayerStore.setState({ listening: true });
    const kick = jest.fn();
    startPacingMonitor(kick);
    await Promise.resolve();
    expect(getBackupConcurrencyCap()).toBe(0);
    expect(kick).not.toHaveBeenCalled();
    usePlayerStore.setState({ listening: false });
    expect(getBackupConcurrencyCap()).toBe(BASE_CONCURRENCY);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("is idempotent", () => {
    startPacingMonitor(jest.fn());
    startPacingMonitor(jest.fn());
    const { addThermalListener } = jest.requireMock("@/perf/thermal");
    expect((addThermalListener as jest.Mock).mock.calls.length).toBe(1);
  });
});

describe("network + charging policy during a run", () => {
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

  it("drops the BACKUP cap to 0 on cellular when wifiOnly is on, leaves manual uploads alone, and resumes on Wi-Fi", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    const kick = jest.fn();
    startPacingMonitor(kick);
    await flush();
    expect(getBackupHold()).toBeNull();

    mockNet.listeners.forEach((cb) => cb({ type: "CELLULAR", isConnected: true }));
    expect(getBackupHold()).toBe("waiting for Wi-Fi");
    expect(getBackupConcurrencyCap()).toBe(0);
    expect(getConcurrencyCap()).toBe(BASE_CONCURRENCY); // the user's own picks keep going
    expect(kick).not.toHaveBeenCalled();

    mockNet.listeners.forEach((cb) => cb({ type: "WIFI", isConnected: true }));
    expect(getBackupHold()).toBeNull();
    expect(getBackupConcurrencyCap()).toBe(BASE_CONCURRENCY);
    expect(kick).toHaveBeenCalledTimes(1); // the pump is re-armed
  });

  it("ignores cellular when wifiOnly is off", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false } });
    startPacingMonitor(jest.fn());
    await flush();
    mockNet.listeners.forEach((cb) => cb({ type: "CELLULAR", isConnected: true }));
    expect(getBackupHold()).toBeNull();
    expect(getBackupConcurrencyCap()).toBe(BASE_CONCURRENCY);
  });

  it("holds backups on unplug when chargingOnly is on, and resumes when the charger returns", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, chargingOnly: true } });
    const kick = jest.fn();
    startPacingMonitor(kick);
    await flush();
    mockBattery.listeners.forEach((cb) => cb({ batteryState: 1 })); // UNPLUGGED
    expect(getBackupHold()).toBe("waiting for charger");
    expect(getBackupConcurrencyCap()).toBe(0);
    mockBattery.listeners.forEach((cb) => cb({ batteryState: 2 })); // CHARGING
    expect(getBackupHold()).toBeNull();
    expect(kick).toHaveBeenCalled();
  });

  it("re-arms the pump when the user relaxes the setting mid-hold", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    const kick = jest.fn();
    startPacingMonitor(kick);
    await flush();
    mockNet.listeners.forEach((cb) => cb({ type: "CELLULAR", isConnected: true }));
    expect(getBackupConcurrencyCap()).toBe(0);
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false } });
    expect(getBackupConcurrencyCap()).toBe(BASE_CONCURRENCY);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("a confirmed 'this time over mobile data' override lifts the Wi-Fi hold only", async () => {
    mockBattery.state = 2; // plugged in to begin with
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true, chargingOnly: true } });
    const kick = jest.fn();
    startPacingMonitor(kick);
    await flush();
    mockNet.listeners.forEach((cb) => cb({ type: "CELLULAR", isConnected: true }));
    expect(getBackupHold()).toBe("waiting for Wi-Fi");

    setPolicyOverride({ wifi: true, charging: false });
    expect(getBackupHold()).toBeNull();
    expect(kick).toHaveBeenCalledTimes(1);

    mockBattery.listeners.forEach((cb) => cb({ batteryState: 1 })); // UNPLUGGED - still gated
    expect(getBackupHold()).toBe("waiting for charger");

    setPolicyOverride({ wifi: false, charging: false });
    expect(getBackupHold()).toBe("waiting for Wi-Fi");
  });

  it("keeps the thermal pause on top: a cool-down still wins for a manual run with no hold", () => {
    usePacing.setState({ thermal: "serious", policyOverride: { wifi: false, charging: true } });
    expect(getBackupHold()).toBeNull();
    expect(getBackupConcurrencyCap()).toBe(0);
  });

  it("seeds the network state from an initial read", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    mockNet.state = { type: "CELLULAR", isConnected: true };
    startPacingMonitor(jest.fn());
    await flush();
    expect(getBackupHold()).toBe("waiting for Wi-Fi");
  });
});

describe("manual run override lifecycle", () => {
  const bkItem = (id: string, status: "queued" | "uploading" | "done") => ({
    id, name: id, uri: "u", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status, progress: 0,
  });

  beforeEach(() => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    usePacing.setState({ connected: true, onWifi: false, charging: false });
  });

  it("holds the permission for the WHOLE run: the scan returning does not withdraw it while uploads are still in flight", () => {
    beginManualRunOverride(true);
    expect(getBackupHold()).toBeNull();

    // runBackup resolves when the SCAN ends; its queue is still draining.
    useUploadStore.setState({ items: [bkItem("bk_a_1", "queued"), bkItem("bk_b_2", "uploading")] });
    endManualRunSequence();
    expect(usePacing.getState().policyOverride).toEqual({ wifi: true, charging: true });
    expect(getBackupHold()).toBeNull();
    expect(getBackupConcurrencyCap()).toBe(BASE_CONCURRENCY);
  });

  it("withdraws it when the last backup upload settles", () => {
    beginManualRunOverride(true);
    useUploadStore.setState({ items: [bkItem("bk_a_1", "uploading")] });
    endManualRunSequence();
    expect(usePacing.getState().policyOverride.wifi).toBe(true);

    useUploadStore.setState({ items: [bkItem("bk_a_1", "done")] });
    maybeWithdrawPolicyOverride();
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
    expect(getBackupHold()).toBe("waiting for Wi-Fi"); // the setting is back in force
  });

  it("keeps it across a multi-destination sequence, even if one destination's queue drains first", () => {
    beginManualRunOverride(true);
    useUploadStore.setState({ items: [bkItem("bk_a_1", "done")] });
    // Destination 1 drained while destination 2 is still being scanned.
    maybeWithdrawPolicyOverride();
    expect(usePacing.getState().policyOverride.wifi).toBe(true);
    endManualRunSequence();
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
  });

  it("granting re-arms the pump; withdrawing never does (it can only lower the backup cap)", () => {
    const kick = jest.fn();
    startPacingMonitor(kick);
    beginManualRunOverride(true); // lifts the hold - the queue may move again
    expect(kick).toHaveBeenCalledTimes(1);
    kick.mockClear();
    endManualRunSequence(); // nothing in flight, so the permission lapses here
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
    expect(kick).not.toHaveBeenCalled();
  });
});

describe("resetManualRunOverride", () => {
  const bkItem = (id: string, status: "queued" | "uploading") => ({
    id, name: id, uri: "u", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status, progress: 0,
  });

  beforeEach(() => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    usePacing.setState({ connected: true, onWifi: false, charging: false });
  });

  it("withdraws unconditionally - the run is over, whatever the sequence or the queue thought", () => {
    beginManualRunOverride(true);
    // Both of the things that make maybeWithdrawPolicyOverride hold off.
    useUploadStore.setState({ items: [bkItem("bk_a_1", "uploading")] });
    maybeWithdrawPolicyOverride();
    expect(usePacing.getState().policyOverride.wifi).toBe(true);

    resetManualRunOverride();
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
    expect(getBackupHold()).toBe("waiting for Wi-Fi");
  });

  it("clears the sequence latch, so a later withdrawal check cannot re-open it", () => {
    beginManualRunOverride(true);
    resetManualRunOverride();
    // Nothing is in flight and the latch is down: the state must simply stay withdrawn.
    useUploadStore.setState({ items: [] });
    maybeWithdrawPolicyOverride();
    endManualRunSequence();
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
  });
});
