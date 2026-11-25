jest.mock("expo-network", () => ({
  NetworkStateType: { WIFI: "WIFI", CELLULAR: "CELLULAR", NONE: "NONE" },
  getNetworkStateAsync: jest.fn(async () => ({ type: "WIFI", isConnected: true, isInternetReachable: true })),
}));
jest.mock("expo-battery", () => ({
  BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
  getPowerStateAsync: jest.fn(async () => ({ batteryLevel: 0.9, batteryState: 2, lowPowerMode: false })),
}));

import { shouldRunBackup, readPolicyInputs, backupHoldReason, type PolicyInputs } from "./policy";
import { DEFAULT_BACKUP_SETTINGS } from "./settings";
import * as Network from "expo-network";
import * as Battery from "expo-battery";

const base: PolicyInputs = { connected: true, onWifi: true, charging: true, batteryPercent: 90 };

describe("shouldRunBackup", () => {
  it("blocks when offline", () => {
    expect(shouldRunBackup(DEFAULT_BACKUP_SETTINGS, { ...base, connected: false })).toEqual({ ok: false, reason: "offline" });
  });
  it("blocks cellular when wifiOnly", () => {
    expect(shouldRunBackup({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true }, { ...base, onWifi: false })).toEqual({ ok: false, reason: "waiting-for-wifi" });
  });
  it("allows cellular when wifiOnly is off", () => {
    expect(shouldRunBackup({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false }, { ...base, onWifi: false }).ok).toBe(true);
  });
  it("blocks when chargingOnly and not charging", () => {
    expect(shouldRunBackup({ ...DEFAULT_BACKUP_SETTINGS, chargingOnly: true }, { ...base, charging: false })).toEqual({ ok: false, reason: "waiting-for-charge" });
  });
  it("blocks below the battery threshold when not charging", () => {
    expect(shouldRunBackup({ ...DEFAULT_BACKUP_SETTINGS, minBatteryPercent: 20 }, { ...base, charging: false, batteryPercent: 10, onWifi: true })).toEqual({ ok: false, reason: "low-battery" });
  });
  it("allows a healthy state", () => {
    expect(shouldRunBackup(DEFAULT_BACKUP_SETTINGS, base)).toEqual({ ok: true });
  });
});

describe("backupHoldReason (mid-run)", () => {
  it("names why an in-progress backup must wait, in the words the screen shows", () => {
    expect(backupHoldReason({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true }, { ...base, onWifi: false })).toBe("waiting for Wi-Fi");
    expect(backupHoldReason({ ...DEFAULT_BACKUP_SETTINGS, chargingOnly: true }, { ...base, charging: false })).toBe("waiting for charger");
    expect(backupHoldReason(DEFAULT_BACKUP_SETTINGS, { ...base, connected: false })).toBe("offline");
  });
  it("lets the run continue when the settings do not care", () => {
    expect(backupHoldReason({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false, chargingOnly: false }, { ...base, onWifi: false, charging: false })).toBeNull();
    expect(backupHoldReason({ ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true, chargingOnly: true }, base)).toBeNull();
  });
  it("does not hold for battery level - that gate is only applied before a run starts", () => {
    const low: PolicyInputs = { ...base, charging: false, batteryPercent: 5 };
    expect(backupHoldReason(DEFAULT_BACKUP_SETTINGS, low)).toBeNull();
  });
});

describe("readPolicyInputs", () => {
  it("normalizes wifi + charging into the snapshot", async () => {
    const inputs = await readPolicyInputs();
    expect(inputs).toEqual({ connected: true, onWifi: true, charging: true, batteryPercent: 90 });
  });
  it("maps cellular + unplugged", async () => {
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValueOnce({ type: "CELLULAR", isConnected: true, isInternetReachable: true });
    (Battery.getPowerStateAsync as jest.Mock).mockResolvedValueOnce({ batteryLevel: 0.42, batteryState: 1, lowPowerMode: false });
    const inputs = await readPolicyInputs();
    expect(inputs).toEqual({ connected: true, onWifi: false, charging: false, batteryPercent: 42 });
  });
});
