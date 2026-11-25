const mockPerms = { granted: true, canAskAgain: true };
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ ...mockPerms })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "nid"),
  setNotificationChannelAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => {} })),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
// The server report is its own module and its own spec (alertReport.test.ts).
// What matters here is that the local alert and the report fire on the SAME
// transition and neither fires on a merely restored one.
jest.mock("./alertReport", () => ({ reportPause: jest.fn(async () => {}) }));

const secureStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { secureStore[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in secureStore ? secureStore[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete secureStore[k]; }),
}));

import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { startBackupAlerts, __resetBackupAlerts } from "./alerts";
import { useUploadBlock, __resetUploadBlockHydration, hydrateUploadBlock, UPLOAD_BLOCK_KEY } from "@/upload/uploadBlock";
import { reportPause } from "./alertReport";
import { useBackupRun } from "./runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "./settings";
import { useUploadStore } from "@/upload/store";
import type { UploadItem } from "@/upload/types";

const report = reportPause as jest.Mock;

const errItem = (id: string): UploadItem => ({
  id, name: id, uri: "u", size: 1, mime: "m", folderId: null, workspaceId: "w", status: "error", progress: 0, error: "boom",
});

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetBackupAlerts();
  __resetUploadBlockHydration();
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  mockPerms.granted = true;
  useUploadBlock.setState({ reason: null });
  useBackupRun.setState({ phase: "idle", workspaceName: null, workspaceId: null, startedAt: null });
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  useUploadStore.setState({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } });
  (AppState as { currentState: string }).currentState = "background";
  jest.clearAllMocks();
  report.mockImplementation(async () => {});
});

describe("backup alerts", () => {
  it("notifies ONCE when a fatal pause engages, again only after a retry re-fails", async () => {
    startBackupAlerts();
    useUploadBlock.setState({ reason: "Storage limit reached." });
    await flush();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect((Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content.title).toBe("Backup paused");

    useUploadBlock.setState({ reason: "Storage limit reached." }); // same engagement
    await flush();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    useUploadBlock.setState({ reason: null }); // manual retry clears…
    useUploadBlock.setState({ reason: "Storage limit reached." }); // …and re-fails
    await flush();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it("summarizes a drained run's failures only while the app is NOT active", async () => {
    startBackupAlerts();
    useUploadStore.setState({ items: [errItem("bk_1"), errItem("bk_2")] });
    useBackupRun.setState({ phase: "uploading", workspaceName: "P", startedAt: 1 });
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    await flush();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect((Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content.body).toContain("2 items failed");
  });

  it("stays silent for foreground drains and for clean runs", async () => {
    startBackupAlerts();
    (AppState as { currentState: string }).currentState = "active";
    useUploadStore.setState({ items: [errItem("bk_1")] });
    useBackupRun.setState({ phase: "uploading", workspaceName: "P", startedAt: 1 });
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    await flush();

    (AppState as { currentState: string }).currentState = "background";
    useUploadStore.setState({ items: [] }); // clean run
    useBackupRun.setState({ phase: "scanning", workspaceName: "P", startedAt: 1 });
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    await flush();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("suppresses the run summary when a fatal notification already covered it", async () => {
    startBackupAlerts();
    useUploadStore.setState({ items: [errItem("bk_1")] });
    useUploadBlock.setState({ reason: "Storage limit reached." });
    useBackupRun.setState({ phase: "uploading", workspaceName: "P", startedAt: 1 });
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    await flush();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1); // fatal only
  });

  it("asks for permission at the moment auto-backup is enabled", async () => {
    mockPerms.granted = false;
    startBackupAlerts();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    await flush();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  });

  it("never notifies without permission (and cannot prompt from the background)", async () => {
    mockPerms.granted = false;
    startBackupAlerts();
    useUploadBlock.setState({ reason: "Storage limit reached." });
    await flush();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled(); // background - no prompt
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

/**
 * The durable half of spec §5.9's `backup_failed`. The local alert reaches
 * whoever is holding this phone; the report reaches the inbox, honours the
 * user's preferences and is still there tomorrow. Both hang off one transition.
 */
describe("the server report hangs off the same transition", () => {
  it("reports the pause alongside the local alert", async () => {
    startBackupAlerts();
    useUploadBlock.setState({ reason: "Workspace storage limit reached." });
    await flush();

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("Workspace storage limit reached.");
  });

  /**
   * The bug this guard was written for. `hydrateUploadBlock` resolves AFTER
   * `startBackupAlerts` has subscribed, so a RESTORED pause looked exactly like
   * a fresh one - a local alert on every single launch, and now a notification
   * with it, about a pause the user was told about days ago.
   */
  it("says nothing when a persisted pause is merely restored at launch", async () => {
    secureStore[UPLOAD_BLOCK_KEY] = "Workspace storage limit reached.";
    startBackupAlerts();
    await hydrateUploadBlock();
    await flush();

    expect(useUploadBlock.getState().reason).toBe("Workspace storage limit reached.");
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("still reports when the local alert is refused permission", async () => {
    mockPerms.granted = false;
    startBackupAlerts();
    useUploadBlock.setState({ reason: "Workspace storage limit reached." });
    await flush();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
