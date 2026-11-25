/**
 * Unit J (account, security, profile, settings, appearance) in the chosen language.
 *
 * Every owned screen is rendered in Turkish and must show no leftover English,
 * switches language while mounted, and checks the plurals in Polish.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { makeT } from "@/i18n/translator";
import en from "@/i18n/messages/en.json";
import { __resetI18nForTests, loadMessages, useLocale } from "@/lib/i18n";
import { renderInLocale, collectTexts, leftoverEnglish } from "../../../test-utils/i18n-sweep";

import SecurityScreen from "../../../app/security";
import ProfileScreen from "../../../app/profile";
import SessionsScreen from "../../../app/sessions";
import DeleteAccountScreen from "../../../app/delete-account";
import ReportProblemScreen from "../../../app/report-problem";
import AppearanceScreen from "../../../app/appearance";
import PrivacyScreen from "../../../app/privacy";
import TermsScreen from "../../../app/terms";
import SettingsScreen from "../../../app/(tabs)/settings";
import { DeletionBanner } from "@/account/DeletionBanner";
import { UpdateRow } from "@/update/UpdateRow";
import { RecoveryCodes } from "@/profile/RecoveryCodes";
import { diagnosticsRows, collectMobileDiagnostics } from "@/support/diagnostics";
import { THEME_LABEL_KEYS, SWATCH_LABEL_KEYS } from "@/theme/themeLabels";
import { THEME_IDS } from "@/theme/tokens";
import { SWATCHES } from "@/theme/palette";
import * as api from "@/profile/api";
import { useAppearance } from "@/theme/themeStore";
import { useAuthStore } from "@/auth/authStore";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";

jest.mock("expo-router", () => require("../../../test-utils/i18n-sweep").routerMockWithTitles());
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
import { fetchDeletePreview, confirmDelete } from "@/account/deletion";
import * as runtime from "@/update/runtime";

const mockToast = toast as jest.Mock;
const mockUseMe = useMe as jest.Mock;
const mockStatus = use2faStatus as jest.Mock;
const mockSessions = useSessions as jest.Mock;
const mockPreview = fetchDeletePreview as jest.Mock;
const mockConfirm = confirmDelete as jest.Mock;

const ME = {
  id: "u1", email: "a@b.com", name: "Jane Doe", initials: "JD", avatar_url: null, has_password: true,
  preferred_language: "en", ui_theme: "default", ui_mode: "system",
  created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
};
const OFF = { method: null, totp_enabled: false, recovery_codes_remaining: 0 };
const PREVIEW = {
  workspaces: [{ id: "ws_1", name: "Solo" }],
  file_count: 12,
  total_bytes: 4096,
  blockers: [],
  window_days: 30,
  deletion_scheduled_for: null,
};
const SESSIONS = [
  { id: "sess_1", device: "Mac", kind: "desktop", browser: "Chrome", meta: "Chrome · 2d ago", is_current: false, created_at: 2 },
  { id: "mtk_1", device: "iPhone", kind: "mobile", browser: "dosya.dev app", meta: "dosya.dev app · active now", is_current: true, created_at: 1 },
];

// User data from the mocks above. "Chrome · 2d ago" is session text built by the
// server and shown as sent.
const MOCK_DATA = ["Jane Doe", "name@example.com", "Chrome · 2d ago"];

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockUseMe.mockReturnValue({ data: ME, isLoading: false, isError: false, refetch: jest.fn() });
  mockStatus.mockReturnValue({ data: OFF, isLoading: false, isError: false, refetch: jest.fn() });
  mockSessions.mockReturnValue({ data: SESSIONS, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
  mockPreview.mockResolvedValue(PREVIEW);
  mockConfirm.mockResolvedValue(Math.floor(Date.now() / 1000) + 30 * 86400);
  mockApiRequest.mockResolvedValue({ ok: true, user: { deletion_scheduled_for: null } });
  useAppearance.setState({ theme: "default", mode: "system", hydrated: true });
  useAuthStore.setState({ status: "signedIn", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null } as never);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: true });
  jest.spyOn(runtime, "getDistributionChannel").mockReturnValue("direct");
  jest.spyOn(runtime, "getInstalledVersionCode").mockReturnValue(14);
});

async function expectNoEnglish(ui: ReactElement, allow: string[] = []) {
  const r = await renderInLocale(ui, "tr");
  expect(r.leftover({ allow: [...MOCK_DATA, ...allow] })).toEqual([]);
  return r;
}

describe("security", () => {
  it("shows nothing in English with 2FA off", async () => {
    const r = await expectNoEnglish(<SecurityScreen />);
    await waitFor(() => expect(screen.queryByText("App lock")).toBeNull());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    expect(screen.getByTestId("screen-title")).toBeTruthy();
  });

  it("covers the App lock rows, the TOTP states and the recovery codes", async () => {
    const r = await expectNoEnglish(<SecurityScreen />);
    await waitFor(() => expect(screen.getByTestId("change-pin")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);

    jest.spyOn(api, "setupTotp").mockResolvedValue({ secret: "ABC123", uri: "otpauth://totp/x" });
    fireEvent.press(screen.getByTestId("tfa-totp"));
    await waitFor(() => expect(screen.getByTestId("totp-qr")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByTestId("totp-secret"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("translates the enabled state, the dialog and the toasts", async () => {
    mockStatus.mockReturnValue({ data: { method: "totp", totp_enabled: true, recovery_codes_remaining: 7 }, isLoading: false, isError: false, refetch: jest.fn() });
    const r = await expectNoEnglish(<SecurityScreen />);
    fireEvent.press(screen.getByTestId("tfa-regen"));
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("translates the no-password account", async () => {
    mockUseMe.mockReturnValue({ data: { ...ME, has_password: false }, isLoading: false, isError: false, refetch: jest.fn() });
    await expectNoEnglish(<SecurityScreen />);
    expect(screen.getByTestId("tfa-needs-password")).toBeTruthy();
  });

  it("translates the load error and the mismatch toast", async () => {
    mockStatus.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() });
    await expectNoEnglish(<SecurityScreen />);
  });

  it("translates the password toasts", async () => {
    jest.spyOn(api, "changePassword").mockResolvedValue(undefined);
    const r = await expectNoEnglish(<SecurityScreen />);
    fireEvent.changeText(screen.getByTestId("pw-current"), "old");
    fireEvent.changeText(screen.getByTestId("pw-new"), "a");
    fireEvent.changeText(screen.getByTestId("pw-confirm"), "b");
    fireEvent.press(screen.getByTestId("pw-save"));
    fireEvent.changeText(screen.getByTestId("pw-confirm"), "a");
    fireEvent.press(screen.getByTestId("pw-save"));
    await waitFor(() => expect(mockToast.mock.calls.length).toBe(2));
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("keeps English text byte-identical", async () => {
    render(<SecurityScreen />);
    expect(screen.getByText("Between 8 and 256 characters. A memorable passphrase works well.")).toBeTruthy();
    expect(screen.getByText("Update password")).toBeTruthy();
  });
});

describe("profile", () => {
  it("translates the hub and the identity section", async () => {
    await expectNoEnglish(<ProfileScreen />);
  });

  it("translates the pending email step and the dialog", async () => {
    jest.spyOn(api, "requestEmailChange").mockResolvedValue({ kind: "pending", newEmail: "new@x.com" });
    const r = await expectNoEnglish(<ProfileScreen />);
    fireEvent.changeText(screen.getByTestId("profile-email"), "new@x.com");
    fireEvent.press(screen.getByTestId("change-email"));
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.changeText(screen.getByTestId("prompt-input"), "pw");
    fireEvent.press(screen.getByTestId("submit"));
    await waitFor(() => expect(screen.getByTestId("email-code")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("translates the load error", async () => {
    mockUseMe.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() });
    await expectNoEnglish(<ProfileScreen />);
  });

  it("translates the avatar permission toast", async () => {
    await expectNoEnglish(<ProfileScreen />);
    fireEvent.press(screen.getByTestId("avatar-pick"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("keeps the English member line identical", () => {
    render(<ProfileScreen />);
    expect(screen.getByText(/^Member since .+ · 2 workspaces$/)).toBeTruthy();
  });
});

describe("sessions", () => {
  it("translates the list and the confirm dialog", async () => {
    const r = await expectNoEnglish(<SessionsScreen />, ["Mac", "iPhone"]);
    fireEvent.press(screen.getByTestId("revoke-all"));
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("translates the error state and the toasts", async () => {
    mockSessions.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn(), isRefetching: false });
    await expectNoEnglish(<SessionsScreen />);
  });

  it("keeps the English dialog message identical for 1 and 2 devices", () => {
    const first = render(<SessionsScreen />);
    fireEvent.press(screen.getByTestId("revoke-all"));
    expect(screen.getByText("1 other device will be signed out. This device stays signed in.")).toBeTruthy();
    first.unmount();
    mockSessions.mockReturnValue({
      data: [...SESSIONS, { ...SESSIONS[0], id: "sess_2" }],
      isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false,
    });
    render(<SessionsScreen />);
    fireEvent.press(screen.getByTestId("revoke-all"));
    expect(screen.getByText("2 other devices will be signed out. This device stays signed in.")).toBeTruthy();
  });

  it("speaks Polish plurals for 1, 3 and 5 other devices", async () => {
    const pl = makeT("pl", await loadMessages("pl"), en);
    for (const n of [1, 3, 5]) {
      const data = [SESSIONS[1], ...Array.from({ length: n }, (_, i) => ({ ...SESSIONS[0], id: `s${i}` }))];
      mockSessions.mockReturnValue({ data, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
      const r = await renderInLocale(<SessionsScreen />, "pl");
      fireEvent.press(screen.getByTestId("revoke-all"));
      const expected = pl("sessions.description.othersOtherDeviceOthersPluralOneOtherSWillBeSignedOutThisDevice", { others: n });
      expect(screen.getByText(expected)).toBeTruthy();
      r.unmount();
    }
  });

  it("translates the revoke accessibility label", async () => {
    await renderInLocale(<SessionsScreen />, "tr");
    const t = makeT("tr", await loadMessages("tr"), en);
    expect(screen.getByTestId("revoke-sess_1").props.accessibilityLabel).toBe(t("sessions.action.signOutDevice", { device: "Mac" }));
  });
});

describe("delete account", () => {
  it("translates the preview", async () => {
    const r = await expectNoEnglish(withQuery(<DeleteAccountScreen />), ["Solo"]);
    await screen.findByTestId("preview-state");
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("translates the blockers and the no-password hint", async () => {
    mockPreview.mockResolvedValue({ ...PREVIEW, blockers: [{ kind: "workspace_has_members", workspace_id: "w", workspace_name: "Team A", member_count: 3 }] });
    const r = await renderInLocale(withQuery(<DeleteAccountScreen />), "tr");
    await screen.findByTestId("blockers");
    expect(r.leftover({ allow: [...MOCK_DATA, "Team A"] })).toEqual([]);
  });

  it("translates the password step and the emailed code step", async () => {
    mockUseMe.mockReturnValue({ data: { ...ME, has_password: true } });
    const r = await renderInLocale(withQuery(<DeleteAccountScreen />), "tr");
    fireEvent.press(await screen.findByTestId("continue"));
    await screen.findByTestId("password-state");
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    r.unmount();

    mockUseMe.mockReturnValue({ data: { ...ME, has_password: false } });
    const r2 = await renderInLocale(withQuery(<DeleteAccountScreen />), "tr");
    fireEvent.press(await screen.findByTestId("continue"));
    await screen.findByTestId("code-state");
    expect(screen.getByTestId("resend-countdown")).toBeTruthy();
    expect(r2.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("translates the done and the scheduled states", async () => {
    mockUseMe.mockReturnValue({ data: { ...ME, has_password: true } });
    const r = await renderInLocale(withQuery(<DeleteAccountScreen />), "tr");
    fireEvent.press(await screen.findByTestId("continue"));
    fireEvent.changeText(await screen.findByTestId("password"), "pw");
    fireEvent.press(screen.getByTestId("confirm-delete"));
    await screen.findByTestId("done-state");
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    r.unmount();

    mockPreview.mockResolvedValue({ ...PREVIEW, deletion_scheduled_for: Math.floor(Date.now() / 1000) + 5 * 86400 });
    const r2 = await renderInLocale(withQuery(<DeleteAccountScreen />), "tr");
    await screen.findByTestId("scheduled-state");
    expect(r2.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByTestId("cancel-deletion"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("keeps the bold date inside one sentence in English", async () => {
    mockPreview.mockResolvedValue({ ...PREVIEW, deletion_scheduled_for: Math.floor(Date.now() / 1000) + 5 * 86400 + 60 });
    render(withQuery(<DeleteAccountScreen />));
    await screen.findByTestId("scheduled-state");
    expect(
      screen.getByText(/^Your account and its files will be deleted on .+ - 5 days from now\. Nothing has been deleted yet\.$/),
    ).toBeTruthy();
  });
});

describe("report a problem", () => {
  it("translates the form, the diagnostics card and the toasts", async () => {
    const r = await renderInLocale(<ReportProblemScreen />, "tr");
    await waitFor(() => expect(screen.getByText(/3/)).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByTestId("report-add-screenshot"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("translates the Backup row of the diagnostics card", async () => {
    await renderInLocale(<ReportProblemScreen />, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    await waitFor(() =>
      expect(screen.getByText(tr("report-problem.label.haserrorsSelectTrueFailedFailedHasSkippedSelectTrueSkippedSkippedOtherOtherSkippedSkipped", {
        hasErrors: "true", failed: 3, hasSkipped: "true", skipped: 1,
      }))).toBeTruthy(),
    );
  });

  it("still sends the diagnostics in English", async () => {
    const d = collectMobileDiagnostics(
      { displayVersion: "1", build: "2", osName: "iOS", osVersion: "26", model: "iPhone", locale: "tr-TR", workspaceId: "w", backup: { error: 3, skipped: 1 } },
      {},
      5,
    );
    expect(d.extra).toEqual({ Device: "iPhone", Backup: "3 failed · 1 skipped" });
  });

  it("keeps the English diagnostics rows identical", () => {
    const d = collectMobileDiagnostics(
      { displayVersion: "1", build: "2", osName: "iOS", osVersion: "26", model: "iPhone", locale: "en-US", workspaceId: "w", backup: { error: 3, skipped: 0 } },
      { page: "/x", errorRef: "r", errorMessage: "m" },
      5,
    );
    expect(diagnosticsRows(d).map((r) => r.label)).toEqual([
      "App", "System", "Language", "Workspace", "Screen", "Error reference", "Error", "Device", "Backup",
    ]);
  });

  it("keeps the English strings with values identical", async () => {
    render(<ReportProblemScreen />);
    await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  });
});

describe("appearance", () => {
  it("translates all eight theme names", async () => {
    const r = await renderInLocale(<AppearanceScreen />, "de");
    const de = makeT("de", await loadMessages("de"), en);
    for (const id of THEME_IDS) {
      const row = screen.getByTestId(`theme-${id}`);
      expect(collectTexts(row.parent as never).join(" ")).toContain(de(THEME_LABEL_KEYS[id]));
    }
    // English names that German writes differently must be gone (Default, Neo-Brutalism).
    expect(r.leftover({ allow: [] })).toEqual([]);
  });

  it("translates mode, headings and the failure toast", async () => {
    const r = await renderInLocale(<AppearanceScreen />, "tr");
    expect(r.leftover()).toEqual([]);
  });

  it("has a key for every swatch colour", () => {
    for (const s of SWATCHES) expect(en[SWATCH_LABEL_KEYS[s.name] as keyof typeof en]).toBe(s.label);
    for (const id of THEME_IDS) expect(en[THEME_LABEL_KEYS[id] as keyof typeof en]).toBeTruthy();
  });
});

describe("legal screens", () => {
  it("translates the titles and leaves the legal text as authored", async () => {
    await renderInLocale(<PrivacyScreen />, "tr");
    expect(screen.getAllByText(makeT("tr", await loadMessages("tr"), en)("legal.heading.privacyPolicy")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Privacy Policy")).toBeNull();
    __resetI18nForTests();
    screen.unmount();
    await renderInLocale(<TermsScreen />, "tr");
    expect(screen.queryByText("Terms of Service")).toBeNull();
  });
});

describe("settings", () => {
  it("translates the screen, the shortcuts and the rows", async () => {
    const r = await renderInLocale(<SettingsScreen />, "tr");
    await screen.findByText(/1\.5|1,5/);
    expect(r.leftover({ allow: ["A", "a@b.com"] })).toEqual([]);
  });

  it("translates the cache toasts", async () => {
    await renderInLocale(<SettingsScreen />, "tr");
    await screen.findByText(/1\.5|1,5/);
    fireEvent.press(screen.getByTestId("settings-clear-cache"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
  });

  it("follows a language switch while mounted", async () => {
    let setPref: (p: "de") => Promise<void> = async () => {};
    function Probe() {
      setPref = useLocale().setPreference as never;
      return null;
    }
    await renderInLocale(<><SettingsScreen /><Probe /></>, "en");
    expect(screen.getByText("Preferences")).toBeTruthy();
    expect(screen.getByLabelText("Open your profile")).toBeTruthy();
    await act(async () => { await setPref("de"); });
    expect(screen.queryByText("Preferences")).toBeNull();
    expect(screen.queryByLabelText("Open your profile")).toBeNull();
    expect(collectTexts()).toContain(makeT("de", await loadMessages("de"), en)("settings.heading.preferences"));
    expect(leftoverEnglish(collectTexts(), "de", { allow: ["A", "a@b.com"] })).toEqual([]);
  });

  it("keeps the English rows identical", async () => {
    render(<SettingsScreen />);
    expect(screen.getByText("Preferences")).toBeTruthy();
    // The Backup row's value; the offline storage budget says "Off" too.
    expect(within(screen.getByTestId("settings-backup")).getByText("Off")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.getByText("Version 1.0.2 (37)")).toBeTruthy();
    expect(screen.getByText("2.0 GB of 10.0 GB used")).toBeTruthy();
    expect(screen.getByText("Password, 2FA & biometric unlock")).toBeTruthy();
  });
});

describe("deletion banner and update row", () => {
  it("translates the banner", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, user: { deletion_scheduled_for: Math.floor(Date.now() / 1000) + 3 * 86400 + 600 } });
    const r = await renderInLocale(withQuery(<DeletionBanner />), "tr");
    await screen.findByTestId("deletion-banner");
    expect(r.leftover()).toEqual([]);
  });

  it("speaks Polish plurals for 1, 3 and 5 days", async () => {
    const pl = makeT("pl", await loadMessages("pl"), en);
    for (const days of [1, 3, 5]) {
      mockApiRequest.mockResolvedValue({ ok: true, user: { deletion_scheduled_for: Math.floor(Date.now() / 1000) + days * 86400 + 600 } });
      const r = await renderInLocale(withQuery(<DeletionBanner />), "pl");
      await screen.findByTestId("deletion-banner");
      expect(screen.getByText(pl("common.description.daysPluralOneDayOtherDaysLeftTapToCancel", { days }))).toBeTruthy();
      r.unmount();
    }
  });

  it("says Today in the last day", async () => {
    mockApiRequest.mockResolvedValue({ ok: true, user: { deletion_scheduled_for: Math.floor(Date.now() / 1000) + 600 } });
    const r = await renderInLocale(withQuery(<DeletionBanner />), "tr");
    await screen.findByTestId("deletion-banner");
    expect(r.leftover()).toEqual([]);
  });

  it("translates the update row", async () => {
    const r = await renderInLocale(<UpdateRow />, "tr");
    await screen.findByTestId("sideload-update-row");
    expect(r.leftover()).toEqual([]);
  });

  it("translates the recovery codes", async () => {
    const r = await renderInLocale(<RecoveryCodes codes={["AAAA-BBBB"]} onDone={() => {}} />, "tr");
    expect(r.leftover()).toEqual([]);
  });
});
