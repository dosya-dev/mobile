/**
 * Core-screen sweep: the Backup tab in tr, de, pl and zh-Hans with no
 * leftover English. Mocks follow ../f.test.tsx.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import BackupScreen from "../../../../app/(tabs)/backup";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";
import { useBackupRun } from "@/backup/runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { useUploadStore } from "@/upload/store";
import { useUploadBlock } from "@/upload/uploadBlock";
import { usePacing } from "@/upload/pacing";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { __resetBackupAlerts } from "@/backup/alerts";
import { __resetI18nForTests } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";
import { renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";

// Mock user data that happens to equal a catalog message.
const DATA = { allow: ["Personal"] };

jest.mock("@/backup/ledger", () => ({
  countByStatus: jest.fn(async () => ({ pending: 2, queued: 0, uploaded: 5, skipped_large: 1, error: 1 })),
  listByStatus: jest.fn(async () => []),
  resetForRetry: jest.fn(async () => 3),
  setStatus: jest.fn(async () => {}),
}));
jest.mock("@/backup/transport/backgroundTransport", () => ({ queuedJobCount: jest.fn(async () => 0) }));
jest.mock("../../../../modules/dosya-background-upload", () => ({ backgroundUploadNative: () => null }));
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
  const base = require("../../../../test-utils/i18n-sweep").routerMockWithTitles();
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
const ledger = require("@/backup/ledger") as { listByStatus: jest.Mock };
const scanner = require("@/backup/scanner") as { hasPhotoAccess: jest.Mock; isPhotoAccessLimited: jest.Mock; listBackupAlbums: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

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
});


async function settle(ui: ReactElement, locale: Locale) {
  const r = await renderInLocale(ui, locale);
  await act(async () => { await Promise.resolve(); });
  return r;
}

describe.each(SWEEP_LOCALES)("Backup tab in %s", (locale) => {
  it("attention rows, ring, figures, storage, scope row and history", async () => {
    scanner.hasPhotoAccess.mockResolvedValue(false);
    scanner.isPhotoAccessLimited.mockResolvedValue(true);
    useBackupRun.setState({ lastUnreadable: 4 } as never);
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: false, filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"], albumMode: "include", albumIds: ["a"], dateFloor: 1700000000 } },
    });
    const r = await settle(<BackupScreen />, locale);
    await screen.findByTestId("backup-now");
    await screen.findByTestId("backup-history");
    expect(r.leftover(DATA)).toEqual([]);
  });

  it("nothing selected, and the mobile data confirm", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, wifiOnly: true, filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: [] } },
    });
    const r = await settle(<BackupScreen />, locale);
    await screen.findByTestId("backup-now");
    expect(r.leftover(DATA)).toEqual([]);
    fireEvent.press(screen.getByTestId("backup-now"));
    await screen.findByTestId("confirm");
    expect(r.leftover(DATA)).toEqual([]);
  });
});
