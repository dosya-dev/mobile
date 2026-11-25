import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react-native";
import BackupScreen from "./backup";
import { LIVE_COUNT_POLL_MS } from "@/backup/ui/CoverageRing";
import { useBackupRun } from "@/backup/runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { useUploadStore } from "@/upload/store";
import { useUploadBlock } from "@/upload/uploadBlock";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { countByStatus } from "@/backup/ledger";
import { Linking } from "react-native";
import { countLibraryAssets, hasPhotoAccess, isPhotoAccessLimited } from "@/backup/scanner";
import { requestPhotoAccess } from "@/onboarding/permissions";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";
import { toast } from "@/ui/toast";

jest.mock("@/backup/ledger", () => ({
  countByStatus: jest.fn(async () => ({ pending: 2, queued: 0, uploaded: 5, skipped_large: 0, error: 1 })),
}));
jest.mock("@/backup/transport/backgroundTransport", () => ({
  queuedJobCount: jest.fn(async () => 0),
}));
// The native module behind the background transport (iOS only). Off by
// default (mirrors Android / Expo Go / Jest with no native side, per
// backgroundUploadNative) - individual tests flip `mockNativePresent.value`
// to exercise the onProgress / onJobFinished wiring. `remove()` deletes the
// captured listener so a test can assert it was actually torn down.
const mockNativeListeners: Record<string, (p: never) => void> = {};
const mockNativePresent = { value: false };
const mockNative = {
  addListener: jest.fn((event: string, fn: (p: never) => void) => {
    mockNativeListeners[event] = fn;
    return { remove: () => { delete mockNativeListeners[event]; } };
  }),
};
jest.mock("../../modules/dosya-background-upload", () => ({
  backgroundUploadNative: () => (mockNativePresent.value ? mockNative : null),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/backup/scanner", () => ({
  isPhotoAccessLimited: jest.fn(async () => false),
  countLibraryAssets: jest.fn(async () => 120),
  // Reads the permission WITHOUT asking for it. Defaults to granted so every
  // pre-existing test in this file exercises the ordinary path.
  hasPhotoAccess: jest.fn(async () => true),
}));
jest.mock("@/onboarding/permissions", () => ({ requestPhotoAccess: jest.fn(async () => "granted") }));
// Wi-Fi by default, so every pre-existing spec takes the no-confirmation path.
jest.mock("@/backup/policy", () => {
  const actual = jest.requireActual("@/backup/policy");
  return { ...actual, readPolicyInputs: jest.fn(async () => ({ connected: true, onWifi: true, charging: true, batteryPercent: 90 })) };
});
jest.mock("@/backup/orchestrator", () => ({
  runBackup: jest.fn(async () => ({ scanned: 3, enqueued: 3, deduped: 0, largeUploaded: 0, largeFailed: 0 })),
  stopBackup: jest.fn(),
  clearManualStop: jest.fn(),
}));
jest.mock("@/backup/history", () => ({
  getBackupHistory: jest.fn(async () => [
    { id: "run_1", workspace_name: "Personal", uploaded: 3, deduped: 1, skipped_large: 0, failed: 0, at: 1710000500 },
    { id: "run_2", workspace_name: null, uploaded: 0, deduped: 0, skipped_large: 0, failed: 2, at: 1709990000 },
  ]),
}));
jest.mock("@/backup/settings", () => {
  const actual = jest.requireActual("@/backup/settings");
  return { ...actual, getLastRunAt: jest.fn(async () => 1710000000), setLastRunAt: jest.fn(async () => {}) };
});
jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(() => ({ data: [{ id: "w1", name: "Personal", default_region: "eu-west-1" }] })),
  useWorkspaceStorage: jest.fn(() => ({
    data: { used: 12_884_901_888, total: 53_687_091_200, free: 40_802_189_312 },
    refetch: jest.fn(),
  })),
  useRegions: jest.fn(() => ({
    data: [
      { code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" },
      { code: "ap-southeast-2", city: "Sydney", country: "Australia", continent: "Oceania", flag: "" },
    ],
  })),
}));
const mockDisposeMediaListener = jest.fn();
jest.mock("@/backup/background", () => ({
  startMediaChangeListener: jest.fn(() => mockDisposeMediaListener),
}));
// useFocusEffect fires the effect on mount and runs its cleanup on unmount,
// exactly like a focused-then-blurred screen - without a NavigationContainer.
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(cb, []);
  },
}));
// Stub the workspace context bar: it pulls in the router, a query client and
// secure-store, none of which this screen's behaviour depends on. Its own
// switching / create behaviour is covered by WorkspaceSwitcher.test. The
// `mock`-prefixed spy lets us assert the screen actually renders it as its
// header (the workspace picker must be reachable from the Backup tab).
const mockWorkspaceHeader = jest.fn(() => null);
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => mockWorkspaceHeader() }));
// useUnfinishedSetup's own behaviour (visibility rules) is covered by its
// test; here only readOnboarding needs a resolvable default so an accidental
// signed-in state in another test doesn't hang.
jest.mock("@/onboarding/onboardingState", () => ({
  readOnboarding: jest.fn(async () => ({ completedAt: null, skippedAt: null, photoPermission: "unasked" })),
  writeOnboarding: jest.fn(async () => ({})),
}));

import { useWorkspaces, useRegions } from "@/files/hooks";
import { runBackup, stopBackup } from "@/backup/orchestrator";
import { readPolicyInputs } from "@/backup/policy";
import { usePacing, getBackupConcurrencyCap } from "@/upload/pacing";
import { startMediaChangeListener } from "@/backup/background";
import { useAuthStore } from "@/auth/authStore";
import { readOnboarding, writeOnboarding } from "@/onboarding/onboardingState";
import { useOnboardingRefresh } from "@/onboarding/onboardingRefresh";

const transport = jest.requireMock("@/backup/transport/backgroundTransport") as { queuedJobCount: jest.Mock };

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: "w1" } as never);
  useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null, backgroundJobs: 0 });
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  useUploadStore.setState({ items: [], batchStartedAt: null });
  useUploadBlock.setState({ reason: null });
  jest.clearAllMocks();
  (hasPhotoAccess as jest.Mock).mockResolvedValue(true);
  (requestPhotoAccess as jest.Mock).mockResolvedValue("granted");
  (readPolicyInputs as jest.Mock).mockResolvedValue({ connected: true, onWifi: true, charging: true, batteryPercent: 90 });
  usePacing.setState({ thermal: "nominal", charging: true, connected: true, onWifi: true, policyOverride: { wifi: false, charging: false } });
  transport.queuedJobCount.mockResolvedValue(0);
  mockNativePresent.value = false;
  for (const k of Object.keys(mockNativeListeners)) delete mockNativeListeners[k];
});

describe("BackupScreen - manual run over mobile data", () => {
  const cellular = () => (readPolicyInputs as jest.Mock).mockResolvedValue({ connected: true, onWifi: false, charging: true, batteryPercent: 90 });

  it("asks before backing up over mobile data when wifiOnly is on, and runs only on confirm", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    const overrideSeen: unknown[] = [];
    (runBackup as jest.Mock).mockImplementation(async () => {
      overrideSeen.push(usePacing.getState().policyOverride);
      return { scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0 };
    });
    render(<BackupScreen />);
    await screen.findByTestId("backup-now");

    fireEvent.press(screen.getByTestId("backup-now"));
    expect(await screen.findByText("Back up over mobile data this time?")).toBeTruthy();
    expect(runBackup).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(runBackup).toHaveBeenCalledWith("w1", "Personal"));
    // The run itself carried the one-off permission.
    expect(overrideSeen).toEqual([{ wifi: true, charging: true }]);
    // Nothing was left in flight, so it is withdrawn once the sequence ends.
    await waitFor(() => expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false }));
  });

  it("keeps the permission - and the queue moving - after runBackup returns with uploads still in flight", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    // runBackup resolves when the SCAN ends (it calls startUpload, not idle);
    // its queue is still draining. Withdrawing here re-armed the Wi-Fi hold
    // against the run's own items, which then sat queued forever.
    (runBackup as jest.Mock).mockImplementation(async () => {
      useUploadStore.setState({
        items: [{ id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 }],
      });
      return { scanned: 1, enqueued: 1, deduped: 0, largeUploaded: 0, largeFailed: 0 };
    });
    render(<BackupScreen />);
    await screen.findByTestId("backup-now");
    fireEvent.press(screen.getByTestId("backup-now"));
    fireEvent.press(await screen.findByTestId("confirm"));

    await waitFor(() => expect(runBackup).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Back up over mobile data this time?")).toBeNull());
    expect(usePacing.getState().policyOverride).toEqual({ wifi: true, charging: true });
    expect(getBackupConcurrencyCap()).toBeGreaterThan(0); // the queue can still drain
  });

  it("does nothing when the user cancels", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    render(<BackupScreen />);
    await screen.findByTestId("backup-now");
    fireEvent.press(screen.getByTestId("backup-now"));
    await screen.findByText("Back up over mobile data this time?");
    fireEvent.press(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Back up over mobile data this time?")).toBeNull());
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("does not ask when wifiOnly is off", async () => {
    cellular();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false } });
    render(<BackupScreen />);
    await screen.findByTestId("backup-now");
    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(runBackup).toHaveBeenCalled());
    expect(screen.queryByText("Back up over mobile data this time?")).toBeNull();
  });

  it("shows the run as paused with the reason while a policy hold is in force", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true } });
    usePacing.setState({ connected: true, onWifi: false });
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({
      items: [{ id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 }],
    });
    render(<BackupScreen />);
    expect(await screen.findByTestId("engine-status")).toHaveTextContent("Paused - waiting for Wi-Fi");
  });
});

describe("BackupScreen", () => {
  it("counts pending down from the library, not from the rows the scan has reached", async () => {
    render(<BackupScreen />);
    expect(await screen.findByTestId("count-uploaded")).toHaveTextContent("5");
    // Library 120 (countLibraryAssets mock), 5 uploaded, 1 failed: the ledger's
    // own pending (2) is just what the throttled scan has materialised so far.
    expect(screen.getByTestId("count-pending")).toHaveTextContent("114");
    expect(screen.getByTestId("count-error")).toHaveTextContent("1");

    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(runBackup).toHaveBeenCalledWith("w1", "Personal"));
    // A manual start re-arms auto triggers after a manual stop.
    const { clearManualStop } = jest.requireMock("@/backup/orchestrator");
    expect(clearManualStop).toHaveBeenCalled();
  });

  it("shows Ready status when idle with auto-backup off, Protected when on", async () => {
    const { unmount } = render(<BackupScreen />);
    expect(await screen.findByTestId("engine-status")).toHaveTextContent("Ready");
    unmount();

    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    render(<BackupScreen />);
    expect(await screen.findByTestId("engine-status")).toHaveTextContent("Protected");
  });

  // A workspace's location is chosen once, when it is created, and every file
  // it holds lives there. The dashboard used to offer a per-run location the
  // server now ignores, so a run names the workspace and nothing else.
  it("starts a run without naming a location", async () => {
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("backup-now"));
    await waitFor(() => expect(runBackup).toHaveBeenCalledWith("w1", "Personal"));
    expect(screen.queryByTestId("region-select")).toBeNull();
  });

  it("shows live activity rows, speed and time left, and the stop control while a backup is in flight", async () => {
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({
      batchStartedAt: Date.now() - 10_000,
      items: [
        { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
        { id: "bk_b_2", name: "b.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 },
      ],
    });
    render(<BackupScreen />);
    await screen.findByTestId("backup-stop");
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Backing up");
    // Live rows replace the old embedded dock.
    expect(screen.getByText("photo.jpg")).toBeTruthy();
    expect(screen.getByTestId("queued-count")).toHaveTextContent("1 queued");
    // Speed and time left ride the ring's caption while running.
    expect(screen.getByTestId("stat-speed")).toBeTruthy();
    expect(screen.getByTestId("stat-eta")).toBeTruthy();
    // The scanning-only row is hidden once uploads are in flight.
    expect(screen.queryByTestId("backup-active")).toBeNull();
  });

  it("shows a scanning row and status while the media library is being scanned", async () => {
    useBackupRun.setState({ phase: "scanning", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({ items: [] });
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-active")).toHaveTextContent(/Scanning/);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Scanning…");
    expect(screen.getByTestId("backup-stop")).toBeTruthy();
  });

  it("surfaces the failure reason when a backup upload errors", async () => {
    useUploadStore.setState({
      items: [
        { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "Network request failed" },
      ],
    });
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-error")).toHaveTextContent(/Network request failed/);
  });

  it("renders recent-activity history rows", async () => {
    render(<BackupScreen />);
    const history = await screen.findByTestId("backup-history");
    expect(within(history).getByText(/Personal/)).toBeTruthy();
    expect(within(history).getByText(/3 backed up/)).toBeTruthy();
    expect(within(history).getByText(/2 failed/)).toBeTruthy();
  });

  it("does NOT own the media-change listener - the root layout runs it for the whole session", async () => {
    // Previously this screen started it on focus, so a new photo was only ever
    // picked up while the Backup tab happened to be open. It now lives in
    // app/_layout.tsx; starting it here too would double-fire every capture.
    const { unmount } = render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(startMediaChangeListener).not.toHaveBeenCalled();
    unmount();
  });

  it("shows 'Continue backup' when idle with pending assets", async () => {
    render(<BackupScreen />);
    // countByStatus mock returns pending: 2 -> idle caption reads "Continue backup".
    await waitFor(() => expect(screen.getByTestId("engine-caption")).toHaveTextContent(/^Continue backup/));
  });

  it("shows 'Start backup' on a fresh install even though the whole library is pending", async () => {
    const { getLastRunAt } = jest.requireMock("@/backup/settings");
    (getLastRunAt as jest.Mock).mockResolvedValueOnce(null);
    (countByStatus as jest.Mock).mockResolvedValueOnce({ pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0 });
    render(<BackupScreen />);
    // Library 120, nothing backed up: pending is 120, but there is no run to continue.
    expect(await screen.findByTestId("count-pending")).toHaveTextContent("120");
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/^Start backup/);
  });

  it("lists the block with its reason and shows Paused, and the ring clears the block", async () => {
    useUploadBlock.setState({ reason: "Storage limit reached." });
    render(<BackupScreen />);
    expect(await screen.findByTestId("attention-blocked")).toHaveTextContent(/Storage limit reached/);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Paused");
    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(useUploadBlock.getState().reason).toBeNull());
  });

  it("retries from the blocked row itself, not only from the ring", async () => {
    useUploadBlock.setState({ reason: "Storage limit reached." });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-blocked"));
    await waitFor(() => expect(useUploadBlock.getState().reason).toBeNull());
    await waitFor(() => expect(runBackup).toHaveBeenCalled());
  });

  it("re-reads the ledger while a run is live so the ring moves with it", async () => {
    jest.useFakeTimers();
    try {
      useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
      useUploadStore.setState({
        batchStartedAt: Date.now(),
        items: [
          { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
        ],
      });
      render(<BackupScreen />);
      await screen.findByTestId("backup-stop");
      await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("5 of 120 protected"));
      // The next ledger read reports more uploaded: the ring must follow it
      // without a focus change or the run ending.
      (countByStatus as jest.Mock).mockResolvedValueOnce({ pending: 1, queued: 0, uploaded: 6, skipped_large: 0, error: 1 });
      await act(async () => {
        jest.advanceTimersByTime(LIVE_COUNT_POLL_MS + 50);
      });
      await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("6 of 120 protected"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("stays running on the run phase alone, with nothing in the store and the OS queue not yet re-read", async () => {
    // iOS background transport: the scan ends, the uploads belong to the OS,
    // and the JS store holds nothing. The phase is the one owner of "running";
    // before this the ring dropped to idle here and came back a second later
    // once the screen had re-read the native queue (the "goes back and comes").
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1, backgroundJobs: 0 });
    transport.queuedJobCount.mockResolvedValue(0);
    render(<BackupScreen />);
    await screen.findByTestId("backup-stop");
    await screen.findByTestId("count-uploaded");
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Backing up");
    expect(screen.getAllByTestId("engine-halo")).toHaveLength(2);
  });

  it("never lets the ring step backwards while a run is live", async () => {
    jest.useFakeTimers();
    try {
      useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
      useUploadStore.setState({
        batchStartedAt: Date.now(),
        items: [
          { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
        ],
      });
      render(<BackupScreen />);
      await screen.findByTestId("backup-stop");
      await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("5 of 120 protected"));
      (countByStatus as jest.Mock).mockResolvedValueOnce({ pending: 0, queued: 0, uploaded: 8, skipped_large: 0, error: 1 });
      await act(async () => {
        jest.advanceTimersByTime(LIVE_COUNT_POLL_MS + 50);
      });
      await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("8 of 120 protected"));
      // A read that lands with fewer rows (a ledger write mid-count, or an
      // older read arriving late) must not pull the arc back.
      (countByStatus as jest.Mock).mockResolvedValueOnce({ pending: 2, queued: 0, uploaded: 6, skipped_large: 0, error: 1 });
      await act(async () => {
        jest.advanceTimersByTime(LIVE_COUNT_POLL_MS + 50);
      });
      await act(async () => {
        jest.advanceTimersByTime(50);
      });
      expect(screen.getByTestId("backup-coverage")).toHaveTextContent("8 of 120 protected");
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops an in-flight backup when the engine button is pressed", async () => {
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({
      items: [
        { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
      ],
    });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("backup-stop"));
    await waitFor(() => expect(stopBackup).toHaveBeenCalled());
  });

  it("refreshes ledger counts + history when an in-flight run drains (falling edge of isActive)", async () => {
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({
      batchStartedAt: Date.now(),
      items: [
        { id: "bk_a_1", name: "photo.jpg", uri: "x", size: 10, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
      ],
    });
    render(<BackupScreen />);
    await screen.findByTestId("backup-stop");
    const callsBefore = (countByStatus as jest.Mock).mock.calls.length;

    // The run settles: phase drops to idle and the uploading item clears -
    // exactly what happens once runBackup's promise resolves and its uploads finish.
    act(() => {
      useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
      useUploadStore.setState({ items: [] });
    });

    await waitFor(() => expect((countByStatus as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("recovers from a failed runBackup (e.g. offline) instead of leaving the engine stuck 'scanning'", async () => {
    (runBackup as jest.Mock).mockImplementationOnce(async () => {
      // Mirror the real orchestrator: phase flips to "scanning" before the
      // failure (e.g. a scan/openLedger call rejecting while offline).
      useBackupRun.setState({ phase: "scanning", workspaceName: "Personal", startedAt: Date.now() });
      throw new Error("Network request failed");
    });
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");

    fireEvent.press(screen.getByTestId("backup-now"));

    await waitFor(() => expect(useBackupRun.getState().phase).toBe("idle"));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Backup failed"), "error");
  });

  it("renders the workspace context bar as the header so the workspace can be changed here", async () => {
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(mockWorkspaceHeader).toHaveBeenCalled();
  });

  it("shows the workspace storage meter", async () => {
    render(<BackupScreen />);
    expect(await screen.findByTestId("storage-bar")).toBeTruthy();
    expect(screen.getByTestId("storage-label")).toHaveTextContent("12.0 GB of 50.0 GB used");
  });
});

describe("BackupScreen - coverage", () => {
  it("says what the denominator leaves out when a filter narrows the library", async () => {
    // A 12-month floor chosen in onboarding: 1380 eligible of 10062 on the phone.
    const floor = 1_758_067_200;
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true, filters: { ...DEFAULT_BACKUP_FILTERS, dateFloor: floor } },
    });
    (countLibraryAssets as jest.Mock).mockImplementation(async (f: { dateFloor: number | null }) => (f.dateFloor == null ? 10_062 : 1_380));
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-coverage")).toHaveTextContent("5 of 1380 protected");
    // The number's scope, in the same breath as the number.
    const scope = await screen.findByTestId("coverage-scope");
    expect(scope).toHaveTextContent(/^Since /);
    fireEvent.press(scope);
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-settings");
    // And the warning that explains it, with the cause and the count, in the
    // attention list where every other "why is this not backing up" lives.
    const row = screen.getByTestId("attention-excluded");
    expect(row).toHaveTextContent(/Only photos and videos since .* are backed up/);
    expect(row).toHaveTextContent(/8682 older photos and videos on this phone are not backed up/);
    fireEvent.press(row);
    expect(mockRouterPush).toHaveBeenLastCalledWith("/backup-settings");
    (countLibraryAssets as jest.Mock).mockImplementation(async () => 120);
  });

  it("sends a folder-limited user to the folder picker from the warning", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true, filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a", "b"] } },
    });
    (countLibraryAssets as jest.Mock).mockImplementation(async (f: { albumMode: string }) => (f.albumMode === "all" ? 10_062 : 1_380));
    render(<BackupScreen />);
    const row = await screen.findByTestId("attention-excluded");
    expect(row).toHaveTextContent(/Only 2 folders are backed up/);
    fireEvent.press(row);
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-folders");
    (countLibraryAssets as jest.Mock).mockImplementation(async () => 120);
  });

  it("shows no scope line and no warning when the filters cover everything", async () => {
    render(<BackupScreen />);
    await screen.findByTestId("backup-coverage");
    expect(screen.queryByTestId("coverage-scope")).toBeNull();
    expect(screen.queryByTestId("attention-excluded")).toBeNull();
  });

  it("shows library coverage so silent skips are visible", async () => {
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-coverage")).toHaveTextContent("5 of 120 protected");
  });

  it("falls back to ledger counts when the library cannot be counted", async () => {
    (countLibraryAssets as jest.Mock).mockResolvedValueOnce(null);
    render(<BackupScreen />);
    expect(await screen.findByTestId("count-uploaded")).toHaveTextContent("5");
    expect(screen.getByTestId("count-pending")).toHaveTextContent("2");
    // No denominator to show against, so the ring names the count alone.
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("5 backed up");
  });

  it("reads as complete once everything in the library is backed up", async () => {
    // Photos deleted from the device keep their uploaded rows: 7 rows, 5 items.
    (countLibraryAssets as jest.Mock).mockResolvedValueOnce(5);
    (countByStatus as jest.Mock).mockResolvedValueOnce({ pending: 0, queued: 0, uploaded: 7, skipped_large: 0, error: 0 });
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-coverage")).toHaveTextContent("5 of 5 protected");
    expect(screen.getByTestId("count-pending")).toHaveTextContent("0");
  });
});

// The per-run location selector is gone - the server ignores a region on an
// upload - but "where do my photos go?" still has to have an answer on the one
// screen where the user asks it. A statement about the WORKSPACE, which stays
// true with several destinations configured, unlike the card it replaced.
describe("BackupScreen - workspace location", () => {
  // The screen renders more than once per case, so these use mockReturnValue
  // rather than *Once - a single queued value would be spent by the first
  // render and the assertion would be made against the default. Restored after
  // each case: jest.clearAllMocks() clears calls, not implementations.
  const defaultWorkspaces = (useWorkspaces as jest.Mock).getMockImplementation()!;
  const defaultRegions = (useRegions as jest.Mock).getMockImplementation()!;
  afterEach(() => {
    (useWorkspaces as jest.Mock).mockImplementation(defaultWorkspaces);
    (useRegions as jest.Mock).mockImplementation(defaultRegions);
  });

  it("names the active workspace's location as a city, not a region code", async () => {
    render(<BackupScreen />);
    const line = await screen.findByTestId("backup-location");
    expect(line).toHaveTextContent(/Personal/);
    expect(line).toHaveTextContent(/Dublin, Ireland/);
    expect(line).not.toHaveTextContent(/eu-west-1/);
  });

  it("falls back to the stored code while the location catalog has not loaded", async () => {
    (useRegions as jest.Mock).mockReturnValue({ data: undefined });
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-location")).toHaveTextContent(/eu-west-1/);
  });

  // An older server does not send the column. A row with no location must show
  // no line at all rather than "Personal · undefined".
  it("says nothing when the workspace carries no location", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Personal" }] });
    render(<BackupScreen />);
    await screen.findByTestId("storage-bar");
    expect(screen.queryByTestId("backup-location")).toBeNull();
  });
});

describe("BackupScreen - filters", () => {
  it("counts coverage against the filtered library, not the whole one", async () => {
    useBackupSettings.setState({
      settings: {
        ...DEFAULT_BACKUP_SETTINGS,
        filtersMigrated: true,
        filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] },
      },
    });
    render(<BackupScreen />);
    await waitFor(() =>
      expect(countLibraryAssets).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["photo"] })),
    );
  });

  it("lists the one-time warning on an install that predates filters", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: false } });
    render(<BackupScreen />);
    expect(await screen.findByTestId("attention-choose-what")).toHaveTextContent(/media saved by other apps/);
    // The standing scope row is there too - the warning is extra, not a replacement.
    expect(screen.getByTestId("choose-what-card")).toBeTruthy();
  });

  it("keeps the row after the picker, switched to a standing coverage summary", async () => {
    // It used to disappear on first tap, which removed the only route into the
    // picker from this screen - the user's "I click and come back and it's
    // lost". The row is permanent now; only its wording is one-time.
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true } });
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(screen.getByTestId("choose-what-card")).toBeTruthy();
    expect(screen.getByTestId("choose-what-summary")).toHaveTextContent("Photos and videos from every folder");
  });

  it("still reaches the picker from the permanent row", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true } });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("choose-what-card"));
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-folders");
  });

  it("opens the folder picker from the warning and marks the migration seen", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: false } });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-choose-what"));
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-folders");
    await waitFor(() => expect(useBackupSettings.getState().settings.filtersMigrated).toBe(true));
  });

  it("warns when the filters currently exclude everything", async () => {
    useBackupSettings.setState({
      settings: {
        ...DEFAULT_BACKUP_SETTINGS,
        filtersMigrated: true,
        filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] },
      },
    });
    render(<BackupScreen />);
    // A backup that covers nothing must say so rather than reporting success.
    fireEvent.press(await screen.findByTestId("attention-nothing-selected"));
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-folders");
  });

  it("offers Settings when iOS limited the library", async () => {
    (isPhotoAccessLimited as jest.Mock).mockResolvedValueOnce(true);
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-limited-access"));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it("explains an idle wait for Wi-Fi and routes to Backup settings from it", async () => {
    (readPolicyInputs as jest.Mock).mockResolvedValue({ connected: true, onWifi: false, charging: true, batteryPercent: 90 });
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, wifiOnly: true } });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-waiting-for-wifi"));
    expect(mockRouterPush).toHaveBeenCalledWith("/backup-settings");
  });
});

// runBackup -> scanAssets calls MediaLibrary.requestPermissionsAsync ITSELF,
// so the engine button was a cold-prompt path: no rationale on screen, and on
// iOS that dialog only ever appears once per install. The cohort that can
// reach this screen without having answered the prompt did not exist before
// the redesign - the new photo step is skippable.
describe("BackupScreen never fires a cold media prompt", () => {
  it("routes an ungranted user to the rationale instead of starting a run", async () => {
    (hasPhotoAccess as jest.Mock).mockResolvedValue(false);
    render(<BackupScreen />);
    expect(await screen.findByTestId("attention-photo-access")).toBeTruthy();

    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/photo access/i), "error"));
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("asks only from the rationale's own row", async () => {
    (hasPhotoAccess as jest.Mock).mockResolvedValue(false);
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-photo-access"));
    await waitFor(() => expect(requestPhotoAccess).toHaveBeenCalled());
  });

  it("stops showing the rationale, and starts running again, once access is granted", async () => {
    (hasPhotoAccess as jest.Mock).mockResolvedValue(false);
    // Model the OS: once the request is granted, the permission READ changes
    // too. A double where those two disagree would let the screen look fixed
    // while the underlying state never moved.
    (requestPhotoAccess as jest.Mock).mockImplementation(async () => {
      (hasPhotoAccess as jest.Mock).mockResolvedValue(true);
      return "granted";
    });
    render(<BackupScreen />);
    fireEvent.press(await screen.findByTestId("attention-photo-access"));
    await waitFor(() => expect(requestPhotoAccess).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("attention-photo-access")).toBeNull();

    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(runBackup).toHaveBeenCalled());
  });

  it("shows nothing extra, and never asks, for a user who already granted it", async () => {
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(screen.queryByTestId("attention-photo-access")).toBeNull();
    expect(requestPhotoAccess).not.toHaveBeenCalled();
  });
});

describe("BackupScreen - resumable setup row", () => {
  afterEach(() => {
    // useUnfinishedSetup.test.tsx covers the visibility rules in isolation;
    // this real (unmocked) authStore is left signed-out for every
    // OTHER test in this file, so it must not leak a signed-in user past
    // whichever test here sets one.
    act(() => { useAuthStore.setState({ user: null } as never); });
  });

  it("renders it first, and resuming clears the skip, bumps the onboarding refresh signal, and routes to the root", async () => {
    useAuthStore.setState({ user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 } } as never);
    (readOnboarding as jest.Mock).mockResolvedValueOnce({ completedAt: null, skippedAt: 100, photoPermission: "unasked" });
    const epochBefore = useOnboardingRefresh.getState().epoch;

    render(<BackupScreen />);
    expect(await screen.findByTestId("attention-finish-setup")).toHaveTextContent(/not chosen what to back up/);

    fireEvent.press(screen.getByTestId("attention-finish-setup"));
    await waitFor(() => expect(writeOnboarding).toHaveBeenCalledWith("u1", { skippedAt: null }));
    // `router.replace` alone would NOT make OnboardingGate look again - it is
    // mounted above the whole navigator and only re-reads state when the
    // account changes (see onboardingRefresh.ts and OnboardingGate.test.tsx's
    // own regression test for the other half of this proof). This assertion
    // is what actually shows the resume button works, not just that it calls
    // something.
    expect(useOnboardingRefresh.getState().epoch).toBe(epochBefore + 1);
    expect(mockRouterReplace).toHaveBeenCalledWith("/");
  });
});

describe("BackupScreen - background uploads", () => {
  it("explains the background state while jobs are queued", async () => {
    transport.queuedJobCount.mockResolvedValue(3);
    render(<BackupScreen />);
    expect(await screen.findByTestId("backup-background-hint")).toHaveTextContent(/Uploading in the background/);
  });
  it("hides it when nothing is queued", async () => {
    transport.queuedJobCount.mockResolvedValue(0);
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(screen.queryByTestId("backup-background-hint")).toBeNull();
  });
});

// The native session (iOS only - see backgroundUploadNative). Off by default
// for every OTHER test in this file (matches Android / Jest-with-no-native),
// so these are the only specs that exercise its onProgress / onJobFinished
// wiring at all.
describe("BackupScreen - background upload progress (native present)", () => {
  afterEach(() => {
    // Date.now is spied per-test below; restored unconditionally so a failed
    // assertion never leaves a frozen clock for a later test.
    jest.restoreAllMocks();
  });

  const emitProgress = (p: { bytesSent: number; bytesTotal: number }) => {
    act(() => { (mockNativeListeners.onProgress as (p: unknown) => void)(p); });
  };
  const emitFinished = () => {
    act(() => { (mockNativeListeners.onJobFinished as (r: unknown) => void)({ jobId: "j1", ok: true }); });
  };

  it("shows a non-zero speed and ETA from two onProgress samples, and reads Backing up", async () => {
    mockNativePresent.value = true;
    transport.queuedJobCount.mockResolvedValue(3);
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    render(<BackupScreen />);
    await screen.findByTestId("backup-background-hint");

    emitProgress({ bytesSent: 1_000_000, bytesTotal: 5_000_000 });
    now += 1000; // advance the clock a full second between samples
    emitProgress({ bytesSent: 2_000_000, bytesTotal: 5_000_000 });

    // No in-process items are active, so the ring's caption falls back to
    // these background-transport samples rather than the (empty) in-process
    // stats. Neither segment renders at all until there is a reading.
    expect(screen.getByTestId("stat-speed")).not.toHaveTextContent("0 B/s");
    expect(screen.getByTestId("stat-eta")).toHaveTextContent(/left$/);
    expect(screen.getByTestId("engine-status")).toHaveTextContent("Backing up");
  });

  it("removes both native listeners on unmount", async () => {
    mockNativePresent.value = true;
    const { unmount } = render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    expect(mockNativeListeners.onProgress).toBeDefined();
    expect(mockNativeListeners.onJobFinished).toBeDefined();

    unmount();

    expect(mockNativeListeners.onProgress).toBeUndefined();
    expect(mockNativeListeners.onJobFinished).toBeUndefined();
  });

  it("treats onJobFinished as a nudge - it refreshes the ledger, not a status by itself", async () => {
    mockNativePresent.value = true;
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    const callsBefore = (countByStatus as jest.Mock).mock.calls.length;

    emitFinished();

    await waitFor(() => expect((countByStatus as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("drops an older ledger read that lands after a newer one", async () => {
    mockNativePresent.value = true;
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("5 of 120 protected"));

    // Two finished jobs nudge two reads. The first read is slow and reports
    // the older count; the second is fast and reports the newer one.
    let releaseSlow!: (v: unknown) => void;
    const slow = new Promise((r) => { releaseSlow = r; });
    (countByStatus as jest.Mock)
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce({ pending: 0, queued: 0, uploaded: 7, skipped_large: 0, error: 1 });
    emitFinished();
    emitFinished();
    await waitFor(() => expect(screen.getByTestId("backup-coverage")).toHaveTextContent("7 of 120 protected"));

    await act(async () => {
      releaseSlow({ pending: 1, queued: 0, uploaded: 6, skipped_large: 0, error: 1 });
      await Promise.resolve();
    });
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("7 of 120 protected");
  });

  it("re-reads only the ledger and the OS queue on a finished job, not the whole library", async () => {
    mockNativePresent.value = true;
    render(<BackupScreen />);
    await screen.findByTestId("count-uploaded");
    await waitFor(() => expect(countLibraryAssets).toHaveBeenCalled());
    const libraryCalls = (countLibraryAssets as jest.Mock).mock.calls.length;
    const ledgerCalls = (countByStatus as jest.Mock).mock.calls.length;

    emitFinished();

    await waitFor(() => expect((countByStatus as jest.Mock).mock.calls.length).toBeGreaterThan(ledgerCalls));
    expect((countLibraryAssets as jest.Mock).mock.calls.length).toBe(libraryCalls);
  });

  it("publishes the OS queue's size to the run state so the rest of the app sees the run", async () => {
    mockNativePresent.value = true;
    transport.queuedJobCount.mockResolvedValue(3);
    render(<BackupScreen />);
    await screen.findByTestId("backup-background-hint");
    expect(useBackupRun.getState().backgroundJobs).toBe(3);
  });

  it("does not leak a finished session's speed into the next one", async () => {
    mockNativePresent.value = true;
    transport.queuedJobCount.mockResolvedValue(3);
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    render(<BackupScreen />);
    await screen.findByTestId("backup-background-hint");

    emitProgress({ bytesSent: 1_000_000, bytesTotal: 5_000_000 });
    now += 1000;
    emitProgress({ bytesSent: 2_000_000, bytesTotal: 5_000_000 });
    expect(screen.getByTestId("stat-speed")).not.toHaveTextContent("0 B/s");

    // The session drains: nothing left queued.
    transport.queuedJobCount.mockResolvedValue(0);
    emitFinished();
    // Not `expect(queryByTestId(...)).toBeNull()`: while the hint is still
    // mounted, every failed poll pretty-formats the whole fiber for the error
    // message (~600ms), starving the microtasks that finish `refresh`, and the
    // 1s waitFor budget is gone before the hint can disappear.
    await waitFor(() => {
      if (screen.queryByTestId("backup-background-hint")) throw new Error("background hint still visible");
    });

    // A new session starts before its own first progress sample has landed -
    // the caption must not still be showing the old session's speed. With no
    // reading the speed segment is not drawn at all.
    transport.queuedJobCount.mockResolvedValue(3);
    emitFinished();
    await screen.findByTestId("backup-background-hint");

    expect(screen.queryByTestId("stat-speed")).toBeNull();
  });
});
