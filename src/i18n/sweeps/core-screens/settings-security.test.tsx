/**
 * Core-screen sweep: the Settings tab and Security in tr, de, pl and
 * zh-Hans with no leftover English. Mocks follow ../j.test.tsx.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { __resetI18nForTests } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";
import { renderInLocale, leftoverEnglish } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";
import SecurityScreen from "../../../../app/security";
import { PinCheck, PinSetup } from "@/auth/PinScreens";
import SettingsScreen from "../../../../app/(tabs)/settings";
import * as api from "@/profile/api";
import { useAppearance } from "@/theme/themeStore";
import { useAuthStore } from "@/auth/authStore";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";

jest.mock("expo-router", () => require("../../../../test-utils/i18n-sweep").routerMockWithTitles());
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/auth/biometric", () => ({
  isBiometricAvailable: jest.fn(async () => true),
  getBiometricEnabled: jest.fn(async () => false),
  setBiometricEnabled: jest.fn(async () => {}),
}));
// A PIN is set, so every App lock row (biometrics, Lock after, Change PIN) is swept.
jest.mock("@/auth/appLock", () => ({
  ...jest.requireActual("@/auth/appLock"),
  hasPin: jest.fn(async () => true),
  getLockAfter: jest.fn(async () => 60),
}));
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: jest.fn(async () => ({ exists: true, size: 10 })) }));
jest.mock("expo-device", () => ({ osName: "iOS", osVersion: "26.0", modelName: "iPhone 15" }));
jest.mock("expo-application", () => ({ nativeBuildVersion: "37", nativeApplicationVersion: "1.0.2" }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.0.0-config" } } }));
jest.mock("@/lib/appVersion", () => ({ getDisplayVersion: () => "1.0.2 (37)" }));
jest.mock("@/backup/ledger", () => ({
  countByStatus: jest.fn(async () => ({ pending: 0, queued: 0, uploaded: 10, skipped_large: 1, error: 3 })),
}));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { activeId: string | null }) => unknown) => sel({ activeId: "ws_1" }),
}));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/files/cacheControl", () => ({
  getCacheSizeBytes: jest.fn(async () => 1.5 * 1_073_741_824),
  clearCaches: jest.fn(async () => {}),
}));
jest.mock("@/workspace-dashboard/api", () => ({
  useWorkspaceDashboard: jest.fn(() => ({ data: { total: { used_bytes: 2_147_483_648, limit_bytes: 10_737_418_240 } } })),
}));
jest.mock("@/family/hooks", () => ({ useFamily: jest.fn(() => ({ data: undefined })), FAMILY_KEY: ["family"] }));
// Passkey copy stays English until its translation batch; PasskeysSection has its own tests.
jest.mock("@/profile/PasskeysSection", () => ({ PasskeysSection: () => null }));
jest.mock("@/profile/hooks", () => ({
  useMe: jest.fn(),
  use2faStatus: jest.fn(),
  useSessions: jest.fn(),
  ME_KEY: ["me"],
  TWO_FA_KEY: ["2fa-status"],
  SESSIONS_KEY: ["sessions"],
}));
jest.mock("@/account/deletion", () => ({
  ...jest.requireActual("@/account/deletion"),
  fetchDeletePreview: jest.fn(),
  requestDeleteCode: jest.fn(async () => {}),
  confirmDelete: jest.fn(),
  cancelDelete: jest.fn(async () => {}),
}));
const mockApiRequest = jest.fn();
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  apiRequest: (...a: unknown[]) => mockApiRequest(...a),
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("@/update/runtime");
jest.mock("@/update/sideloadUpdate", () => ({
  checkForUpdate: jest.fn(async () => ({
    status: "available",
    version: "1.2.0",
    versionCode: 20,
    sizeBytes: 68_000_000,
    downloadPageUrl: "https://dosya.dev/mobile/",
  })),
}));

import { toast } from "@/ui/toast";
import { useMe, use2faStatus, useSessions } from "@/profile/hooks";
import * as runtime from "@/update/runtime";

const mockToast = toast as jest.Mock;
const mockUseMe = useMe as jest.Mock;
const mockStatus = use2faStatus as jest.Mock;
const mockSessions = useSessions as jest.Mock;

const ME = {
  id: "u1", email: "a@b.com", name: "Jane Doe", initials: "JD", avatar_url: null, has_password: true,
  preferred_language: "en", ui_theme: "default", ui_mode: "system",
  created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
};
const OFF = { method: null, totp_enabled: false, recovery_codes_remaining: 0 };
const SESSIONS = [
  { id: "sess_1", device: "Mac", kind: "desktop", browser: "Chrome", meta: "Chrome · 2d ago", is_current: false, created_at: 2 },
  { id: "mtk_1", device: "iPhone", kind: "mobile", browser: "dosya.dev app", meta: "dosya.dev app · active now", is_current: true, created_at: 1 },
];

// User data from the mocks above. "Chrome · 2d ago" is session text built by the
// server and shown as sent.
const MOCK_DATA = ["Jane Doe", "name@example.com", "Chrome · 2d ago"];

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockUseMe.mockReturnValue({ data: ME, isLoading: false, isError: false, refetch: jest.fn() });
  mockStatus.mockReturnValue({ data: OFF, isLoading: false, isError: false, refetch: jest.fn() });
  mockSessions.mockReturnValue({ data: SESSIONS, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
  mockApiRequest.mockResolvedValue({ ok: true, user: { deletion_scheduled_for: null } });
  useAppearance.setState({ theme: "default", mode: "system", hydrated: true });
  useAuthStore.setState({ status: "signedIn", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null } as never);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: true });
  jest.spyOn(runtime, "getDistributionChannel").mockReturnValue("direct");
  jest.spyOn(runtime, "getInstalledVersionCode").mockReturnValue(14);
});


async function expectNoEnglish(ui: ReactElement, locale: Locale, allow: string[] = []) {
  const r = await renderInLocale(ui, locale);
  expect(r.leftover({ allow: [...MOCK_DATA, ...allow] })).toEqual([]);
  return r;
}

describe.each(SWEEP_LOCALES)("Security in %s", (locale) => {
  it("the App lock PIN screens", async () => {
    await expectNoEnglish(<PinCheck onSuccess={() => {}} onCancel={() => {}} />, locale);
    await expectNoEnglish(<PinSetup onDone={() => {}} secondary={{ label: "x", onPress: () => {} }} />, locale, ["x"]);
  });

  it("with two-factor off, then the authenticator setup", async () => {
    const r = await expectNoEnglish(<SecurityScreen />, locale);
    await waitFor(() => expect(screen.getByTestId("change-pin")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    jest.spyOn(api, "setupTotp").mockResolvedValue({ secret: "ABC123", uri: "otpauth://totp/x" });
    fireEvent.press(screen.getByTestId("tfa-totp"));
    await waitFor(() => expect(screen.getByTestId("totp-qr")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByTestId("totp-secret"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), locale)).toEqual([]);
  });

  it("with two-factor on, and the recovery codes dialog", async () => {
    mockStatus.mockReturnValue({ data: { method: "totp", totp_enabled: true, recovery_codes_remaining: 7 }, isLoading: false, isError: false, refetch: jest.fn() });
    const r = await expectNoEnglish(<SecurityScreen />, locale);
    fireEvent.press(screen.getByTestId("tfa-regen"));
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("an account without a password", async () => {
    mockUseMe.mockReturnValue({ data: { ...ME, has_password: false }, isLoading: false, isError: false, refetch: jest.fn() });
    await expectNoEnglish(<SecurityScreen />, locale);
    expect(screen.getByTestId("tfa-needs-password")).toBeTruthy();
  });

  it("the load error", async () => {
    mockStatus.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() });
    await expectNoEnglish(<SecurityScreen />, locale);
  });

  it("the password toasts", async () => {
    jest.spyOn(api, "changePassword").mockResolvedValue(undefined);
    const r = await expectNoEnglish(<SecurityScreen />, locale);
    fireEvent.changeText(screen.getByTestId("pw-current"), "old");
    fireEvent.changeText(screen.getByTestId("pw-new"), "a");
    fireEvent.changeText(screen.getByTestId("pw-confirm"), "b");
    fireEvent.press(screen.getByTestId("pw-save"));
    fireEvent.changeText(screen.getByTestId("pw-confirm"), "a");
    fireEvent.press(screen.getByTestId("pw-save"));
    await waitFor(() => expect(mockToast.mock.calls.length).toBe(2));
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), locale)).toEqual([]);
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });
});

describe.each(SWEEP_LOCALES)("Settings tab in %s", (locale) => {
  it("the screen, the shortcuts and the rows", async () => {
    const r = await renderInLocale(<SettingsScreen />, locale);
    await screen.findByText(/1\.5|1,5/);
    expect(r.leftover({ allow: ["A", "a@b.com"] })).toEqual([]);
  });

  it("the cache toasts", async () => {
    await renderInLocale(<SettingsScreen />, locale);
    await screen.findByText(/1\.5|1,5/);
    fireEvent.press(screen.getByTestId("settings-clear-cache"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), locale)).toEqual([]);
  });
});
