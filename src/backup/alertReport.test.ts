jest.mock("expo-device", () => ({ deviceType: 1, DeviceType: { PHONE: 1, TABLET: 2 } }));
jest.mock("./api", () => ({ reportBackupPause: jest.fn(async () => {}) }));
jest.mock("./ledger", () => ({ pendingTotals: jest.fn(async () => ({ count: 412, bytes: 3_400_000_000 })) }));

const secureStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { secureStore[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in secureStore ? secureStore[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete secureStore[k]; }),
}));

import { Platform } from "react-native";
import * as Device from "expo-device";
import { clearBackupAlertReport, deviceKind, reportPause, REPORT_KEY } from "./alertReport";
import { reportBackupPause } from "./api";
import { pendingTotals } from "./ledger";
import { useBackupRun } from "./runState";
import { useWorkspaceStore } from "@/files/workspaceStore";

const report = reportBackupPause as jest.Mock;
const backlog = pendingTotals as jest.Mock;

beforeEach(() => {
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  jest.clearAllMocks();
  report.mockImplementation(async () => {});
  backlog.mockImplementation(async () => ({ count: 412, bytes: 3_400_000_000 }));
  useBackupRun.setState({ workspaceId: null });
  useWorkspaceStore.setState({ activeId: "ws_active" });
  (Device as { deviceType: number }).deviceType = 1; // PHONE
  (Platform as { OS: string }).OS = "ios";
});

describe("reportPause", () => {
  it("sends a reason CODE and the ledger's backlog, never the engine's message", async () => {
    await reportPause("Workspace storage limit reached.");

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toEqual({
      reasonCode: "storage_limit",
      deviceKind: "iphone",
      pendingCount: 412,
      pendingBytes: 3_400_000_000,
    });
    // The backlog is the LEDGER's, not the paused run's upload queue: the copy
    // asks what has not been backed up, and the queue holds only what
    // backpressure let through.
    expect(backlog).toHaveBeenCalledWith("ws_active");
  });

  it("prefers the running workspace over the merely active one", async () => {
    useBackupRun.setState({ workspaceId: "ws_running" });
    await reportPause("You are not a member of this workspace.");
    expect(backlog).toHaveBeenCalledWith("ws_running");
  });

  it("classifies every fatal cause the engine can reach", async () => {
    const cases: Array<[string, string]> = [
      ["Workspace storage limit reached.", "storage_limit"],
      ["You are not a member of this workspace.", "not_a_member"],
      ["No upload permission in this workspace.", "upload_permission"],
      ["Something nobody has classified yet.", "other"],
    ];
    for (const [message, code] of cases) {
      for (const k of Object.keys(secureStore)) delete secureStore[k];
      report.mockClear();
      await reportPause(message);
      expect(`${message} -> ${report.mock.calls[0][0].reasonCode}`).toBe(`${message} -> ${code}`);
    }
  });

  /**
   * Spec §5.9 asks for a 24 hour window; the engine's dedupe window is a fixed
   * hour, so the wider one is enforced here. The case it exists for is mundane
   * and constant: a phone that is out of storage stays out of storage, and
   * every retry re-enters the paused state.
   */
  it("reports the same cause once a day, and a different cause immediately", async () => {
    await reportPause("Workspace storage limit reached.");
    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(1);

    await reportPause("You are not a member of this workspace.");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("reports again once the window has passed", async () => {
    secureStore[REPORT_KEY] = JSON.stringify({
      reason: "storage_limit", at: Date.now() - 25 * 60 * 60 * 1000,
    });
    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reports rather than swallows when the throttle record is unreadable", async () => {
    secureStore[REPORT_KEY] = "{ not json";
    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("records nothing when the send fails, so the next pause tries again", async () => {
    report.mockRejectedValueOnce(new Error("Network request failed"));
    await reportPause("Workspace storage limit reached.");
    expect(secureStore[REPORT_KEY]).toBeUndefined();

    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("never throws - it runs inside the engine's own store subscription", async () => {
    backlog.mockRejectedValueOnce(new Error("database is locked"));
    await expect(reportPause("Workspace storage limit reached.")).resolves.toBeUndefined();
    // A backlog we cannot count is no reason to withhold the pause, but it IS a
    // reason not to invent a number - so nothing is sent.
    expect(report).not.toHaveBeenCalled();
  });

  it("still reports when the throttle cannot be written", async () => {
    const secure = jest.requireMock("expo-secure-store") as { setItemAsync: jest.Mock };
    secure.setItemAsync.mockRejectedValueOnce(new Error("keychain full"));
    await expect(reportPause("Workspace storage limit reached.")).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("deviceKind", () => {
  it("names the four devices the server knows how to render", () => {
    const kinds: Array<[string, number, string]> = [
      ["ios", 1, "iphone"],
      ["ios", 2, "ipad"],
      ["android", 1, "android_phone"],
      ["android", 2, "android_tablet"],
    ];
    for (const [os, type, expected] of kinds) {
      (Platform as { OS: string }).OS = os;
      (Device as { deviceType: number }).deviceType = type;
      expect(`${os}/${type} -> ${deviceKind()}`).toBe(`${os}/${type} -> ${expected}`);
    }
  });

  it("treats an unknown device type as a phone rather than inventing one", () => {
    (Platform as { OS: string }).OS = "ios";
    (Device as { deviceType: number | null }).deviceType = null;
    expect(deviceKind()).toBe("iphone");
  });
});

describe("clearBackupAlertReport", () => {
  it("forgets the throttle, so the next account on this handset is not silenced", async () => {
    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(1);

    await clearBackupAlertReport();
    await reportPause("Workspace storage limit reached.");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("never throws when the store is unavailable", async () => {
    const secure = jest.requireMock("expo-secure-store") as { deleteItemAsync: jest.Mock };
    secure.deleteItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(clearBackupAlertReport()).resolves.toBeUndefined();
  });
});
