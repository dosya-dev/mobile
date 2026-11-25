/**
 * Unit F sweep: the Backup tab and its screens (settings, folders, failed
 * items, free up space), the ring, the attention list, the activity feed, the
 * alerts and the strings the engine writes into the ledger, rendered in a
 * language other than English.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { readFileSync } from "fs";
import { join } from "path";
import { AppState } from "react-native";
import type { ReactElement } from "react";
import * as Notifications from "expo-notifications";
import BackupScreen from "../../../app/(tabs)/backup";
import BackupFailed from "../../../app/backup-failed";
import BackupFreeSpace from "../../../app/backup-free-space";
import BackupFolders from "../../../app/backup-folders";
import BackupSettingsScreen from "../../../app/backup-settings";
import { ActivityFeed } from "../../backup/ui/ActivityFeed";
import { AttentionList } from "../../backup/ui/AttentionList";
import { CoverageRing } from "../../backup/ui/CoverageRing";
import { CoverageFigures } from "../../backup/ui/CoverageFigures";
import { StorageBar } from "../../backup/ui/StorageBar";
import { deriveAttention, attentionHeading } from "../../backup/ui/attention";
import { engineLabel } from "../../backup/ui/engineStatus";
import { coverageSummary, DEFAULT_BACKUP_FILTERS } from "../../backup/filters";
import { startBackupAlerts, __resetBackupAlerts } from "../../backup/alerts";
import { useBackupRun } from "../../backup/runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "../../backup/settings";
import { useUploadStore } from "../../upload/store";
import { useUploadBlock } from "../../upload/uploadBlock";
import { usePacing } from "../../upload/pacing";
import { useWorkspaceStore } from "../../files/workspaceStore";
import { loadMessages, t, useLocale, __resetI18nForTests } from "../../lib/i18n";
import { renderInLocale } from "../../../test-utils/i18n-sweep";

// Mock user data that happens to equal a catalog message.
const DATA = { allow: ["Personal"] };
// The catalogs use no-break spaces; the matcher normalises whitespace.
const norm = (s: string) => s.replace(/\u00a0/g, " ");

jest.mock("@/backup/ledger", () => ({
  countByStatus: jest.fn(async () => ({ pending: 2, queued: 0, uploaded: 5, skipped_large: 1, error: 1 })),
  listByStatus: jest.fn(async () => []),
  resetForRetry: jest.fn(async () => 3),
  setStatus: jest.fn(async () => {}),
}));
jest.mock("@/backup/transport/backgroundTransport", () => ({ queuedJobCount: jest.fn(async () => 0) }));
jest.mock("../../../modules/dosya-background-upload", () => ({ backgroundUploadNative: () => null }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/backup/scanner", () => ({
  isPhotoAccessLimited: jest.fn(async () => false),
  countLibraryAssets: jest.fn(async () => 120),
  hasPhotoAccess: jest.fn(async () => true),
  listBackupAlbums: jest.fn(async () => []),
}));
jest.mock("@/backup/albumDefaults", () => ({ ensureAlbumDefaults: jest.fn(async () => {}) }));
jest.mock("@/onboarding/permissions", () => ({ requestPhotoAccess: jest.fn(async () => "granted") }));
jest.mock("@/backup/policy", () => {
  const actual = jest.requireActual("@/backup/policy");
  return { ...actual, readPolicyInputs: jest.fn(async () => ({ connected: true, onWifi: false, charging: true, batteryPercent: 90 })) };
});
jest.mock("@/backup/orchestrator", () => ({
  runBackup: jest.fn(async () => ({})),
  stopBackup: jest.fn(),
  clearManualStop: jest.fn(),
}));
jest.mock("@/backup/history", () => ({
  getBackupHistory: jest.fn(async () => [
    { id: "run_1", workspace_name: "Personal", uploaded: 3, deduped: 1, skipped_large: 0, failed: 2, at: 1710000500 },
    { id: "run_2", workspace_name: null, uploaded: 0, deduped: 0, skipped_large: 0, failed: 0, at: 1709990000 },
  ]),
}));
jest.mock("@/backup/settings", () => {
  const actual = jest.requireActual("@/backup/settings");
  return { ...actual, getLastRunAt: jest.fn(async () => 1710000000), setLastRunAt: jest.fn(async () => {}) };
});
jest.mock("@/backup/reclaim", () => ({
  buildReclaimPlan: jest.fn(async () => ({ ids: ["a", "b"], bytes: 4_509_715_660, unverifiable: 6 })),
  runReclaim: jest.fn(async () => 2),
}));
jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(() => ({
    data: [
      { id: "w1", name: "Personal", default_region: "eu-west-1" },
      { id: "w2", name: "Team" },
    ],
  })),
  useWorkspaceStorage: jest.fn(() => ({
    data: { used: 12_884_901_888, total: 53_687_091_200, free: 40_802_189_312 },
    refetch: jest.fn(),
  })),
  useRegions: jest.fn(() => ({
    data: [{ code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" }],
  })),
}));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/onboarding/onboardingState", () => ({
  readOnboarding: jest.fn(async () => ({ completedAt: null, skippedAt: null, photoPermission: "unasked" })),
  writeOnboarding: jest.fn(async () => ({})),
}));
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return { ...base, useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []) };
});
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationChannelAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => {} })),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));
jest.mock("@/backup/alertReport", () => ({ reportPause: jest.fn(async () => {}) }));

/* eslint-disable @typescript-eslint/no-require-imports */
const ledger = require("@/backup/ledger") as { listByStatus: jest.Mock; countByStatus: jest.Mock };
const scanner = require("@/backup/scanner") as { hasPhotoAccess: jest.Mock; isPhotoAccessLimited: jest.Mock; listBackupAlbums: jest.Mock };
const reclaim = require("@/backup/reclaim") as { buildReclaimPlan: jest.Mock };
const toastMod = require("@/ui/toast") as { toast: jest.Mock };
const orchestrator = require("@/backup/orchestrator") as { runBackup: jest.Mock };
const hooks = require("@/files/hooks") as { useWorkspaces: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

const probe: { setPreference: (p: "de" | "en" | "pl" | "tr") => Promise<void> } = { setPreference: async () => {} };
function Probe(): null {
  probe.setPreference = useLocale().setPreference as (p: "de" | "en" | "pl" | "tr") => Promise<void>;
  return null;
}

const failedRow = (over: Record<string, unknown> = {}) => ({
  workspace_id: "w1", local_id: "a", filename: "IMG_1.HEIC", size: 4_100_000, created_at: 1,
  fingerprint: null, status: "error", remote_file_id: null, attempts: 5, last_error: "iCloud original unavailable",
  mp_session: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  __resetBackupAlerts();
  useWorkspaceStore.setState({ activeId: "w1" } as never);
  useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null, backgroundJobs: 0, lastUnreadable: 0 } as never);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  useUploadStore.setState({ items: [], batchStartedAt: null });
  useUploadBlock.setState({ reason: null });
  usePacing.setState({ thermal: "nominal", charging: true, connected: true, onWifi: true, policyOverride: { wifi: false, charging: false } });
  scanner.hasPhotoAccess.mockResolvedValue(true);
  scanner.isPhotoAccessLimited.mockResolvedValue(false);
  scanner.listBackupAlbums.mockResolvedValue([
    { id: "wa", title: "WhatsApp Images", count: 11300 },
    { id: "cam", title: "Camera", count: 6100 },
  ]);
  ledger.listByStatus.mockImplementation(async (_ws: string, statuses: string[]) =>
    statuses.includes("error") ? [failedRow()] : statuses.includes("skipped_large") ? [failedRow({ local_id: "b", filename: "BIG.MOV", status: "skipped_large", last_error: "Larger than your limit" })] : [],
  );
  reclaim.buildReclaimPlan.mockResolvedValue({ ids: ["a", "b"], bytes: 4_509_715_660, unverifiable: 6 });
});

/** Switches the module language for non-render tests (alerts, ledger text, helpers). */
async function useLanguage(locale: "de" | "pl" | "tr"): Promise<void> {
  await renderInLocale(<Probe />, locale);
}

async function settle(ui: ReactElement, locale: "tr" | "de" | "pl") {
  const r = await renderInLocale(ui, locale);
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe("the Backup tab in Turkish", () => {
  it("shows no leftover English: attention rows, ring, figures, storage, scope row, history", async () => {
    scanner.hasPhotoAccess.mockResolvedValue(false);
    scanner.isPhotoAccessLimited.mockResolvedValue(true);
    useBackupRun.setState({ lastUnreadable: 4 } as never);
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: false, filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"], albumMode: "include", albumIds: ["a"], dateFloor: 1700000000 } },
    });
    const r = await settle(<BackupScreen />, "tr");
    await screen.findByTestId("backup-now");
    await screen.findByTestId("backup-history");
    expect(r.leftover(DATA)).toEqual([]);
  });

  it("shows the running ring, the nothing-selected row and the cellular confirm in Turkish", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true, filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] } },
    });
    const r = await settle(<BackupScreen />, "tr");
    await screen.findByTestId("backup-now");
    expect(r.leftover(DATA)).toEqual([]);
    fireEvent.press(screen.getByTestId("backup-now"));
    await screen.findByText(t("backup.heading.backUpOverMobileDataThisTime"));
    // The dialog's own Cancel button is the shared ConfirmDialog (unit K).
    expect(r.leftover({ allow: ["Personal"] })).toEqual([]);
    expect(screen.getByText(t("backup.action.useMobileData"))).toBeTruthy();
  });

  it("toasts are translated: photo access first, backup failed, unknown error", async () => {
    scanner.hasPhotoAccess.mockResolvedValue(false);
    await settle(<BackupScreen />, "tr");
    await screen.findByTestId("backup-now");
    await waitFor(() => expect(screen.getByTestId("attention-photo-access")).toBeTruthy());
    fireEvent.press(screen.getByTestId("backup-now"));
    await waitFor(() => expect(toastMod.toast).toHaveBeenCalled());
    expect(toastMod.toast.mock.calls[0][0]).toBe(t("backup.error.allowPhotoAccessFirstSeeTheListAtTheTopOfThisScreen"));
    expect(toastMod.toast.mock.calls[0][0]).not.toBe("Allow photo access first - see the list at the top of this screen.");
  });

  it("a failed run toasts the translated 'Backup failed: {msg}', with a translated unknown error", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: false } });
    orchestrator.runBackup.mockRejectedValueOnce("not an Error");
    await settle(<BackupScreen />, "tr");
    fireEvent.press(await screen.findByTestId("backup-now"));
    await waitFor(() => expect(toastMod.toast).toHaveBeenCalled());
    expect(toastMod.toast.mock.calls[0][0]).toBe(t("backup.error.backupFailedMsg", { msg: t("sync.error.unknownError") }));
  });

  it("switches language while mounted (English, then German in place)", async () => {
    await renderInLocale(<><Probe /><BackupScreen /></>, "tr");
    await screen.findByTestId("backup-now");
    await act(async () => { await probe.setPreference("en"); });
    await waitFor(() => expect(screen.getByText("Activity")).toBeTruthy());
    expect(screen.getByText("What gets backed up")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    const de = await loadMessages("de");
    await waitFor(() => expect(screen.getByText(de["common.heading.activity"])).toBeTruthy());
    expect(screen.queryByText("Activity")).toBeNull();
    expect(screen.getByText(de["backup.label.whatGetsBackedUp"])).toBeTruthy();
  });
});

describe("English stays byte-identical on the Backup tab", () => {
  it("renders the known English strings", async () => {
    await renderInLocale(<BackupScreen />, "en");
    await screen.findByTestId("backup-now");
    await screen.findByTestId("backup-history");
    expect(screen.getByText("What gets backed up")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByTestId("backup-coverage")).toHaveTextContent("5 of 120 protected");
    expect(screen.getByTestId("storage-label")).toHaveTextContent("12.0 GB of 50.0 GB used");
    expect(screen.getByTestId("choose-what-summary")).toHaveTextContent("Photos and videos from every folder");
  });
});

describe("the ring caption", () => {
  const ring = (over: Record<string, unknown> = {}) => (
    <CoverageRing
      status="backing-up" buttonState="running" hasPending uploaded={5} total={20} startedAt={1_000}
      lastRun={null} bytesPerSec={1_048_576} etaSec={120} onPress={() => {}} {...over}
    />
  );

  it("keeps speed, time left and the clock addressable in German", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_010_000);
    await settle(ring(), "de");
    const de = await loadMessages("de");
    expect(screen.getByTestId("stat-speed")).toBeTruthy();
    expect(screen.getByTestId("stat-eta")).toHaveTextContent(/\S/);
    expect(screen.getByTestId("engine-time")).toBeTruthy();
    expect(norm(screen.getByTestId("engine-caption").props.children.toString?.() ?? "")).toBeDefined();
    expect(screen.getByTestId("engine-caption")).toHaveTextContent(/^Zum Anhalten tippen · 1,0 MB\/s · noch 2 Min\. · 00:00:10$/);
    expect(de["backup.description.tapToStopHasSpeedSelectTrueSpeedOtherHasEtaSelectTrueEtaLeftOther"]).toContain("Zum Anhalten tippen");
    (Date.now as jest.Mock).mockRestore();
  });

  it("holding, cooling, paused, disabled and idle captions have no leftover English in Turkish", async () => {
    const states: Record<string, unknown>[] = [
      { status: "holding", holdReason: "waiting for Wi-Fi" },
      { status: "cooling" },
      { status: "paused", buttonState: "paused", lastRun: 1_710_000_500 },
      { status: "ready", buttonState: "disabled" },
      { status: "protected", buttonState: "idle", hasPending: true, lastRun: 1_710_000_500 },
      { status: "ready", buttonState: "idle", hasPending: false, lastRun: null, scope: null },
    ];
    for (const s of states) {
      const r = await settle(ring(s), "tr");
      expect(r.leftover()).toEqual([]);
      r.unmount();
    }
  });

  it("names the hold reason in the core through the catalog", async () => {
    const r = await settle(ring({ status: "holding", holdReason: "waiting for charger" }), "tr");
    expect(screen.getByTestId("engine-status")).toHaveTextContent(t("backup.status.pausedWaitingForCharger"));
    r.unmount();
  });

  it("speaks the ring's accessibility label in the language", async () => {
    await settle(ring(), "de");
    const de = await loadMessages("de");
    expect(screen.getByTestId("coverage-ring").props.accessibilityLabel).toBe(
      de["backup.label.minOfTotalProtected"].replace("{min}", "5").replace("{total}", "20"),
    );
  });
});

describe("attention, figures, storage and the feed", () => {
  it("every attention row variant has no leftover English in Turkish", async () => {
    await useLanguage("tr");
    const base = { unfinishedSetup: null, photoAccess: true, limited: false, filtersMigrated: true, nothingSelected: false, excluded: null, blockReason: null, network: null, runActive: false } as const;
    const variants = [
      { ...base, unfinishedSetup: "denied" as const },
      { ...base, unfinishedSetup: "other" as const },
      { ...base, photoAccess: false, limited: true, nothingSelected: true, filtersMigrated: false },
      { ...base, blockReason: "Storage is full.", network: "offline" as const },
      { ...base, network: "waiting-for-wifi" as const },
      { ...base, network: "cellular-data" as const, blockReason: "Quota reached" },
    ];
    for (const v of variants) {
      const items = deriveAttention(v);
      const r = await settle(<AttentionList items={items} firstRun={false} onPress={() => {}} />, "tr");
      expect(r.leftover()).toEqual([]);
      r.unmount();
    }
    expect(attentionHeading(3, true)).toBe(t("backup.label.countThingsBeforeTheFirstBackup", { count: "3" }));
    expect(attentionHeading(3, false)).not.toMatch(/things need attention/);
    expect(attentionHeading(1, false)).toBeNull();
  });

  it("figures, storage and engine labels", async () => {
    const r = await settle(<><CoverageFigures uploaded={3} pending={2} failed={1} skipped={4} /><StorageBar used={1024} total={4096} /></>, "tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByTestId("count-skipped")).toHaveTextContent(t("backup.label.skippedTooLarge", { skipped: "4" }));
    for (const s of ["scanning", "backing-up", "cooling", "holding", "paused", "protected", "ready"] as const) {
      expect(engineLabel(s, s === "holding" ? "offline" : null)).not.toMatch(/^(Scanning|Backing up|Cooling|Paused|Protected|Ready)/);
    }
  });

  it("an unknown hold reason shows the generic paused label", async () => {
    await useLanguage("tr");
    expect(engineLabel("holding", "something else")).toBe(t("common.status.paused"));
  });

  it("the activity feed: live rows, errors, report, history", async () => {
    const items = [
      { id: "bk_1", name: "a.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 },
      { id: "bk_2", name: "b.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: undefined },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `bk_e${i}`, name: `e${i}.jpg`, uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "boom" })),
    ] as never;
    const history = [
      { id: "r1", workspace_name: "Personal", uploaded: 3, deduped: 1, skipped_large: 0, failed: 2, at: 1710000500 },
      { id: "r2", workspace_name: null, uploaded: 0, deduped: 0, skipped_large: 0, failed: 0, at: 1709990000 },
      { id: "r3", workspace_name: "X", uploaded: 7, deduped: 0, skipped_large: 0, failed: 0, at: 1709980000 },
    ];
    const r = await settle(<ActivityFeed phase="idle" items={items} history={history as never} />, "tr");
    expect(r.leftover(DATA)).toEqual([]);
    expect(screen.getByText(new RegExp(t("common.label.workspace")))).toBeTruthy();
    expect(screen.getByText(t("backup.error.countMoreFailed", { count: "2" }))).toBeTruthy();
    const empty = await settle(<ActivityFeed phase="scanning" items={[]} history={[]} />, "tr");
    expect(empty.leftover()).toEqual([]);
  });

  it("the history line joins its parts through one message, parts only when present", async () => {
    await settle(
      <ActivityFeed phase="idle" items={[]} history={[{ id: "r1", workspace_name: "P", uploaded: 3, deduped: 1, skipped_large: 0, failed: 0, at: 1710000500 }] as never} />,
      "de",
    );
    // uploaded and deduped present, failed absent: no failed part, no stray separator.
    const line = screen.getByText(/^3 /).props.children as string;
    expect(line).toBe(t("backup.status.uploadedBackedUpHasDedupedSelectTrueDedupedAlreadyBackedUpOtherHasFailedSelectTrue", {
      uploaded: "3", hasDeduped: "true", deduped: "1", hasFailed: "false", failed: "0",
    }));
    expect(line).toMatch(/ · /);
    expect(line).not.toMatch(/ · .* · /);
  });

  it("the report link carries the plural message in Polish for 1, 3 and 5", async () => {
    const pl = await loadMessages("pl");
    for (const n of [1, 3, 5]) {
      const items = Array.from({ length: n }, (_, i) => ({ id: `bk_${i}`, name: `f${i}`, uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0, error: "boom" })) as never;
      const r = await settle(<ActivityFeed phase="idle" items={items} history={[]} />, "pl");
      fireEvent.press(screen.getByTestId("backup-report"));
      const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
      const sent = router.push.mock.calls.at(-1)[0].params.errorMessage as string;
      expect(sent).toBe(t("backup.error.erroredcountPluralOneUploadOtherUploadsFailed", { erroredCount: n }));
      expect(sent).toMatch(/\d/);
      expect(pl["backup.error.erroredcountPluralOneUploadOtherUploadsFailed"]).toBeTruthy();
      r.unmount();
    }
  });
});

describe("the Backup screens in Turkish", () => {
  it("failed items", async () => {
    ledger.countByStatus.mockResolvedValue({ pending: 0, queued: 0, uploaded: 0, skipped_large: 300, error: 250 });
    const r = await settle(<BackupFailed />, "tr");
    await screen.findByTestId("retry-all");
    await screen.findByTestId("raise-limit");
    await screen.findByTestId("failed-truncated");
    expect(r.leftover()).toEqual([]);
  });

  it("failed items: empty state", async () => {
    ledger.listByStatus.mockResolvedValue([]);
    const r = await settle(<BackupFailed />, "tr");
    await screen.findByTestId("no-failures");
    expect(r.leftover()).toEqual([]);
  });

  it("failed items: retry toasts and report text are translated", async () => {
    ledger.countByStatus.mockResolvedValue({ pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 1 });
    await settle(<BackupFailed />, "tr");
    expect(await screen.findByTestId("retry-all")).toHaveTextContent(t("backup.action.retry1Item"));
    fireEvent.press(screen.getByTestId("retry-all"));
    await waitFor(() => expect(toastMod.toast).toHaveBeenCalled());
    expect(toastMod.toast.mock.calls[0][0]).toBe(t("backup.status.countPluralOneRetryingItemOtherRetryingItems", { count: 3 }));
    orchestrator.runBackup.mockRejectedValueOnce(new Error("boom"));
    fireEvent.press(screen.getByTestId("retry-all"));
    await waitFor(() => expect(toastMod.toast.mock.calls.length).toBe(2));
    expect(toastMod.toast.mock.calls[1][0]).toBe(t("backup.error.retryFailedHasErrorSelectTrueErrorOtherUnknownError", { hasError: "true", error: "boom" }));
  });

  it("failed items: plurals in Polish for 1, 3 and 5", async () => {
    const pl = await loadMessages("pl");
    for (const n of [1, 3, 5]) {
      ledger.countByStatus.mockResolvedValue({ pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: n });
      const r = await settle(<BackupFailed />, "pl");
      await screen.findByTestId("report-failures");
      fireEvent.press(screen.getByTestId("report-failures"));
      const { useRouter: routerOf } = jest.requireMock("expo-router") as { useRouter: () => { push: jest.Mock } };
      const sent = routerOf().push.mock.calls.at(-1)[0].params.errorMessage as string;
      expect(sent).toBe(t("backup.error.errorBackupErrorPluralOneItemOtherItemsFailed", { error: n }));
      expect(pl["backup.error.errorBackupErrorPluralOneItemOtherItemsFailed"]).toContain("plural");
      r.unmount();
    }
  });

  it("free up space, with the plural forms in Polish for 1, 3 and 5", async () => {
    const r = await settle(<BackupFreeSpace />, "tr");
    await screen.findByTestId("reclaim");
    expect(r.leftover()).toEqual([]);
    r.unmount();
    for (const n of [1, 3, 5]) {
      reclaim.buildReclaimPlan.mockResolvedValue({ ids: Array.from({ length: n }, (_, i) => `i${i}`), bytes: 100, unverifiable: 0 });
      const p = await settle(<BackupFreeSpace />, "pl");
      const button = await screen.findByTestId("reclaim");
      expect(button).toHaveTextContent(t("backup.action.countPluralOneRemoveOriginalOtherRemoveOriginals", { count: n }));
      expect(screen.getByText(t("backup.description.countPluralOnePhotoOrVideoOtherPhotosAndVideos", { count: n }))).toBeTruthy();
      p.unmount();
    }
  });

  it("free up space: empty state, loading and the removed toast", async () => {
    reclaim.buildReclaimPlan.mockResolvedValue({ ids: [], bytes: 0, unverifiable: 0 });
    const r = await settle(<BackupFreeSpace />, "tr");
    await screen.findByTestId("nothing-to-reclaim");
    expect(r.leftover()).toEqual([]);
    r.unmount();
    reclaim.buildReclaimPlan.mockResolvedValue({ ids: ["a", "b"], bytes: 5, unverifiable: 0 });
    await settle(<BackupFreeSpace />, "tr");
    fireEvent.press(await screen.findByTestId("reclaim"));
    await waitFor(() => expect(toastMod.toast).toHaveBeenCalled());
    expect(toastMod.toast.mock.calls[0][0]).toBe(t("backup.status.removedRemovedOriginalsFromThisDevice", { removed: "2" }));
  });

  it("device folders: list, none selected, empty and loading", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] } } });
    const r = await settle(<BackupFolders />, "tr");
    await screen.findByText("WhatsApp Images");
    expect(r.leftover()).toEqual([]);
    r.unmount();
    scanner.listBackupAlbums.mockResolvedValue([]);
    const e = await settle(<BackupFolders />, "tr");
    await screen.findByTestId("no-albums");
    expect(e.leftover()).toEqual([]);
  });

  it("backup settings: every row, both sheets, the destinations section", async () => {
    const r = await settle(<BackupSettingsScreen />, "tr");
    await screen.findByTestId("backup-auto");
    expect(r.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("filter-max-size"));
    await waitFor(() => expect(screen.getByText(t("backup.action.skipFilesOver200MB"))).toBeTruthy());
    expect(r.leftover()).toEqual([]);
  });

  it("backup settings: start-from sheet and summaries in Turkish", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, dateFloor: 1700000000, maxBytes: 3 * 1024 * 1024 * 1024, albumMode: "include", albumIds: ["a"] } },
    });
    const r = await settle(<BackupSettingsScreen />, "tr");
    await screen.findByTestId("filter-start-from");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByTestId("filter-max-size")).toHaveTextContent(/3[.,]0/);
    fireEvent.press(screen.getByTestId("filter-start-from"));
    await waitFor(() => expect(screen.getByText(t("backup.label.theLast30Days"))).toBeTruthy());
    expect(r.leftover()).toEqual([]);
  });

  it("backup settings: folder-count plural in Polish for 1, 3 and 5", async () => {
    for (const n of [1, 3, 5]) {
      useBackupSettings.setState({
        settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: Array.from({ length: n }, (_, i) => `a${i}`) } },
      });
      const r = await settle(<BackupSettingsScreen />, "pl");
      await screen.findByTestId("filter-folders");
      expect(screen.getByTestId("filter-folders")).toHaveTextContent(new RegExp(`${norm(t("backup.label.countPluralOneFolderOtherFolders", { count: n }))}$`));
      r.unmount();
    }
  });

  it("backup settings: switches language while mounted", async () => {
    await renderInLocale(<><Probe /><BackupSettingsScreen /></>, "tr");
    await screen.findByTestId("backup-auto");
    await act(async () => { await probe.setPreference("en"); });
    await waitFor(() => expect(screen.getByText("When to back up")).toBeTruthy());
    expect(screen.getByText("Wi-Fi only")).toBeTruthy();
    await act(async () => { await probe.setPreference("de"); });
    const de = await loadMessages("de");
    await waitFor(() => expect(screen.getByText(de["backup.heading.whenToBackUp"])).toBeTruthy());
    expect(hooks.useWorkspaces).toHaveBeenCalled();
  });
});

describe("the helpers and the engine's own text", () => {
  it("coverageSummary picks the whole sentence per language, folder plural in Polish for 1, 3 and 5", async () => {
    await useLanguage("pl");
    const f = (over = {}) => ({ ...DEFAULT_BACKUP_FILTERS, ...over });
    expect(coverageSummary(f())).toBe(t("common.label.photosAndVideosFromEveryFolder"));
    expect(coverageSummary(f({ mediaTypes: ["video"] }))).toBe(t("common.label.videosFromEveryFolder"));
    expect(coverageSummary(f({ mediaTypes: ["photo"], albumMode: "include" }))).toBe(t("common.label.photosNoFoldersSelected"));
    for (const n of [1, 3, 5]) {
      const ids = Array.from({ length: n }, (_, i) => `a${i}`);
      expect(coverageSummary(f({ albumMode: "include", albumIds: ids }))).toBe(
        t("common.label.photosAndVideosFromAlbumIdsCountPluralOneFolderOtherFolders", { albumIdsCount: n }),
      );
    }
  });

  it("coverageSummary keeps its English", () => {
    const f = (over = {}) => ({ ...DEFAULT_BACKUP_FILTERS, ...over });
    expect(coverageSummary(f())).toBe("Photos and videos from every folder");
    expect(coverageSummary(f({ mediaTypes: ["video"], albumMode: "include", albumIds: [] }))).toBe("Videos - no folders selected");
    expect(coverageSummary(f({ mediaTypes: ["photo"], albumMode: "include", albumIds: ["a"] }))).toBe("Photos from 1 folder");
    expect(coverageSummary(f({ albumMode: "include", albumIds: ["a", "b"] }))).toBe("Photos and videos from 2 folders");
  });

  it("alerts: the notifications and the channel name follow the language, the channel is renamed on a switch", async () => {
    const platform = jest.requireActual("react-native").Platform;
    const old = platform.OS;
    platform.OS = "android";
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
    await renderInLocale(<Probe />, "tr");
    startBackupAlerts();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenLastCalledWith("backup-alerts", expect.objectContaining({ name: t("backup.label.backupAlerts") }));
    expect(t("backup.label.backupAlerts")).not.toBe("Backup alerts");
    await act(async () => { await probe.setPreference("de"); });
    const de = await loadMessages("de");
    await waitFor(() =>
      expect(Notifications.setNotificationChannelAsync).toHaveBeenLastCalledWith("backup-alerts", expect.objectContaining({ name: de["backup.label.backupAlerts"] })),
    );
    // A fatal pause notifies in the language.
    await act(async () => { useUploadBlock.setState({ reason: "Storage is full." }); });
    await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled());
    const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
    expect(content.title).toBe(de["backup.status.backupPaused"]);
    expect(content.body).toContain("Storage is full.");
    expect(content.body).not.toContain("Open the app");
    // A run that drains with failures.
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    useUploadBlock.setState({ reason: null });
    useUploadStore.setState({ items: [{ id: "bk_1", name: "a", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "error", progress: 0 }] as never });
    await act(async () => { useBackupRun.setState({ phase: "scanning" } as never); });
    await act(async () => { useBackupRun.setState({ phase: "idle" } as never); });
    await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled());
    const done = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].content;
    expect(done.title).toBe(de["backup.status.backupFinishedWithProblems"]);
    platform.OS = old;
  });

  it("alerts: failed-item plural in Polish for 1, 3 and 5", async () => {
    await useLanguage("pl");
    const pl = await loadMessages("pl");
    const m = pl["backup.error.failedPluralOneItemOtherItemsFailedToBackUpOpenDosyaDevTo"];
    expect(m).toContain("plural");
    for (const n of [1, 3, 5]) {
      expect(t("backup.error.failedPluralOneItemOtherItemsFailedToBackUpOpenDosyaDevTo", { failed: n })).toMatch(String(n));
    }
  });

  it("the ledger text the engine writes is produced in the current language", async () => {
    // The engine runs headless, so its text is checked at the source: none of
    // the English literals may remain in the files that write it, and the keys
    // that replace them translate.
    const literals: Record<string, string[]> = {
      "backup/orchestrator.ts": ["Looking for new photos", "This file is empty on this device", "Large upload failed", "byte limit`"],
      "backup/transport/backgroundTransport.ts": [
        "Not enough free space on this device", "This file is empty on this device", "Could not read this item from the library",
        "object never registered", "job missing after relaunch", '"Stopped"', "byte limit`", "`HTTP ${",
      ],
      "backup/completion.ts": ["Upload completed without a file id", '"Upload failed"', "size mismatch (local"],
      "backup/ledger.ts": ['"Gave up after repeated failures"'],
      "backup/folders.ts": ["Failed to resolve folder"],
      "backup/statusBridge.ts": ['?? "Workspace"'],
    };
    for (const [file, list] of Object.entries(literals)) {
      const source = readFileSync(join(__dirname, "..", "..", file), "utf8");
      for (const literal of list) expect({ file, literal, found: source.includes(literal) }).toEqual({ file, literal, found: false });
    }
    await useLanguage("tr");
    expect(t("common.error.gaveUpAfterRepeatedFailures")).not.toBe("Gave up after repeated failures");
    expect(t("backup.error.notEnoughFreeSpaceOnThisDeviceToStageTheNextPhotos")).not.toBe("Not enough free space on this device to stage the next photos");
    expect(t("backup.label.largerThanYourMaxBytesByteLimit", { maxBytes: "1234" })).toContain("1234");
    expect(t("backup.error.sizeMismatchLocalLocalSizeServerServerSize", { localSize: "10", serverSize: "7" })).not.toBe("size mismatch (local 10, server 7)");
  });
});
