/**
 * Unit K (app shell, shared UI components, workspace screens) in the chosen language.
 *
 * Every owned screen and component is rendered in Turkish and must show no
 * leftover English; the workspace settings screen and the dialogs switch
 * language while mounted; the approved rewording ("or") is asserted.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";
import type { ReactElement } from "react";
import { makeT } from "@/i18n/translator";
import en from "@/i18n/messages/en.json";
import { __resetI18nForTests, loadMessages, useLocale } from "@/lib/i18n";
import { renderInLocale, collectTexts, leftoverEnglish, captureAlerts } from "../../../test-utils/i18n-sweep";

import WorkspaceSettingsScreen from "../../../app/workspace-settings";
import WorkspaceDashboardScreen from "../../../app/workspace-dashboard";
import WorkspacesScreen from "../../../app/workspaces";
import TabsLayout from "../../../app/(tabs)/_layout";
import RootLayout from "../../../app/_layout";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { PromptDialog } from "@/ui/PromptDialog";
import { TextField } from "@/ui/TextField";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { GateScreen, STALLED_AFTER_MS } from "@/ui/GateScreen";
import { ListPager, usePager } from "@/ui/ListPager";
import { MaintenanceScreen } from "@/ui/MaintenanceScreen";
import { OAuthButton } from "@/ui/OAuthButton";
import { OrDivider } from "@/ui/OrDivider";
import { toast } from "@/ui/toast";
import { formatBytes } from "@/lib/format";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useMaintenanceStore } from "@/ui/maintenanceStore";
import { getWorkspaceDetail, getRoles, getTeam, type WorkspaceDetail } from "@/workspace/api";
import { useWorkspaceDashboard } from "@/workspace-dashboard/api";
import { useWorkspaces } from "@/files/hooks";

// Records the options each Stack.Screen / Tabs.Screen declares (calling the
// function form the way the navigator would) and renders string titles.
const mockTitles: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockScreen(props: any) {
  const o = typeof props.options === "function" ? props.options({ route: { name: props.name } }) : props.options;
  if (!o || !o.title) return null;
  mockTitles.push(o.title);
  return <Text testID="screen-title">{o.title}</Text>;
}
jest.mock("expo-router", () => {
  const mock = require("../../../test-utils/i18n-sweep").routerMockWithTitles();
  mock.Stack.Screen = (props: unknown) => mockScreen(props);
  mock.Tabs.Screen = (props: unknown) => mockScreen(props);
  return mock;
});
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/workspace/api", () => ({
  getWorkspaceDetail: jest.fn(),
  getRoles: jest.fn(),
  getTeam: jest.fn(),
  updateWorkspaceName: jest.fn(),
  updateWorkspaceSettings: jest.fn(),
  transferOwnership: jest.fn(),
  leaveWorkspace: jest.fn(),
}));
const mockPerms = { current: {} as Record<string, boolean> };
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ roleId: "role_c1", permissions: mockPerms.current, can: (p: string) => mockPerms.current[p] ?? false }),
}));
jest.mock("@/workspace-dashboard/api", () => ({ useWorkspaceDashboard: jest.fn() }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("@/telemetry/sentry", () => ({
  ...jest.requireActual("@/telemetry/sentry"),
  reportError: jest.fn(() => "evt_1"),
}));
jest.mock("@/api", () => ({ ...jest.requireActual("@/api"), apiRequest: jest.fn(async () => ({})) }));

// The root layout's launch effects, mocked the way app/_layout.i18n.test.tsx does.
jest.mock("@/offline/background", () => ({ startOfflineForAccount: jest.fn(() => () => {}) }));
jest.mock("@/backup/background", () => ({
  registerBackupTask: jest.fn(async () => {}),
  startAutoBackupTriggers: jest.fn(() => () => {}),
  settleBackgroundUploads: jest.fn(async () => {}),
}));
jest.mock("@/auth/AppLockGate", () => ({ AppLockGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/onboarding/OnboardingGate", () => ({ OnboardingGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/files/WorkspaceGate", () => ({ WorkspaceGate: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/profile/hooks", () => ({ useAppearanceSync: () => {} }));
jest.mock("@/upload/runner", () => ({ sweepUploadCache: jest.fn(async () => {}) }));
jest.mock("@/upload/persist", () => ({
  hydrateUploadQueue: jest.fn(async () => new Set()),
  resumeUploadQueue: jest.fn(),
  startUploadQueuePersistence: jest.fn(),
}));
jest.mock("@/upload/uploadBlock", () => ({ hydrateUploadBlock: jest.fn(async () => {}) }));
jest.mock("@/backup/statusBridge", () => ({ startStatusBridge: jest.fn() }));
jest.mock("@/lib/queryPersist", () => ({
  restoreQueryCache: jest.fn(async () => true),
  startQueryPersistence: jest.fn(() => jest.fn()),
}));
jest.mock("@/files/cacheControl", () => ({ sweepSessionCaches: jest.fn(async () => {}) }));
jest.mock("@/backup/alerts", () => ({ startBackupAlerts: jest.fn() }));
jest.mock("@/auth/purge", () => ({ purgeAccountData: jest.fn(async () => {}), pendingOfflinePurge: jest.fn(() => null) }));
jest.mock("@/filesProvider/link", () => ({ linkFilesProvider: jest.fn(async () => {}) }));
jest.mock("@/auth/sessionDrop", () => ({ shouldPurgeOnSignOut: jest.fn(() => true) }));
jest.mock("@/onboarding/onboardingState", () => ({ hasSeenWelcome: jest.fn(async () => true) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@expo-google-fonts/space-grotesk", () => ({
  useFonts: () => [true],
  SpaceGrotesk_400Regular: "SpaceGrotesk_400Regular",
  SpaceGrotesk_500Medium: "SpaceGrotesk_500Medium",
  SpaceGrotesk_700Bold: "SpaceGrotesk_700Bold",
}));
jest.mock("@expo-google-fonts/space-mono", () => ({ SpaceMono_400Regular: "SpaceMono_400Regular" }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => "device"), setItem: jest.fn(async () => {}) }));
jest.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "tr-TR" }] }));
jest.mock("@/orbit/OrbitTabBar", () => ({ OrbitTabBar: () => null }));

const mockDetail = getWorkspaceDetail as jest.Mock;
const mockRoles = getRoles as jest.Mock;
const mockTeam = getTeam as jest.Mock;
const mockToast = toast as jest.Mock;

const DETAIL: WorkspaceDetail = {
  workspace: {
    id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null,
    owner_id: "u9", default_region: "eu", created_at: 1700000000, storage_used_bytes: 10,
  },
  settings: { max_file_size_gb: 5, max_total_storage_gb: 100, require_2fa: true, session_timeout_minutes: 30 },
  role_id: "role_admin",
  is_owner: false,
  plan: "team",
  storage: { used: 10, total: 100, free: 90 },
};
const ROLES = { roles: [{ id: "role_admin", name: "Admin", is_custom: false, permissions: { a: true, b: false } }], all_permissions: [] };
const TEAM = {
  members: [
    { membership_id: "m1", user_id: "u1", name: "Jane", email: "jane@x.com", role_id: "role_member" },
    { membership_id: "m2", user_id: "u9", name: "Boss", email: "boss@x.com", role_id: "role_owner" },
  ],
};

// User data in the mocks above, shown as sent.
const MOCK_DATA = ["Acme", "AC", "Admin", "Jane", "jane@x.com", "Boss", "boss@x.com", "eu"];

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

async function tr() {
  return makeT("tr", await loadMessages("tr"), en);
}

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockTitles.length = 0;
  mockPerms.current = {};
  useWorkspaceStore.setState({ activeId: "w1" });
  mockDetail.mockResolvedValue(DETAIL);
  mockRoles.mockResolvedValue(ROLES);
  mockTeam.mockResolvedValue(TEAM);
  useAuthStore.setState({ status: "signedIn", user: { id: "u1" }, hydrate: jest.fn(), pending2fa: null, pendingVerificationEmail: null } as never);
});

describe("shared dialogs and fields", () => {
  it("ConfirmDialog default buttons", async () => {
    const r = await renderInLocale(<ConfirmDialog visible title="x" onConfirm={() => {}} onCancel={() => {}} />, "tr");
    const t = await tr();
    expect(screen.getByText(t("common.cancel"))).toBeTruthy();
    expect(screen.getByText(t("common.action.confirm"))).toBeTruthy();
    expect(r.leftover({ allow: ["x"] })).toEqual([]);
  });

  it("PromptDialog default buttons and the password eye", async () => {
    const r = await renderInLocale(<PromptDialog visible title="x" secure onSubmit={() => {}} onCancel={() => {}} />, "tr");
    const t = await tr();
    expect(screen.getByText(t("common.cancel"))).toBeTruthy();
    expect(screen.getByText(t("common.save"))).toBeTruthy();
    expect(screen.getByLabelText(t("common.accessibility.showPassword"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("prompt-input-eye"));
    expect(screen.getByLabelText(t("common.accessibility.hidePassword"))).toBeTruthy();
    expect(r.leftover({ allow: ["x"] })).toEqual([]);
  });

  it("TextField eye labels", async () => {
    await renderInLocale(<TextField value="" onChangeText={() => {}} secureTextEntry testID="pw" />, "tr");
    expect(leftoverEnglish(collectTexts(), "tr")).toEqual([]);
    expect(screen.queryByLabelText("Show password")).toBeNull();
  });

  it("toast titles", async () => {
    // The real toast, not the module mock.
    const real = jest.requireActual("@/ui/toast") as { toast: typeof toast };
    await renderInLocale(<Text>x</Text>, "tr");
    const alerts = captureAlerts();
    real.toast("msg");
    real.toast("msg", "error");
    const t = await tr();
    expect(alerts.calls.map((c) => c.title)).toEqual([t("common.done"), t("report-problem.label.diagnosticError")]);
    expect(alerts.calls.map((c) => c.title)).not.toContain("Done");
    alerts.restore();
  });

  it("English toast titles stay Done and Error", () => {
    const real = jest.requireActual("@/ui/toast") as { toast: typeof toast };
    const alerts = captureAlerts();
    real.toast("msg");
    real.toast("msg", "error");
    expect(alerts.calls.map((c) => c.title)).toEqual(["Done", "Error"]);
    alerts.restore();
  });

  it("OrDivider uses the approved wording and the sign-in buttons translate", async () => {
    await renderInLocale(
      <>
        <OrDivider />
        <OAuthButton provider="google" onPress={() => {}} lastUsed testID="g" />
        <OAuthButton provider="github" onPress={() => {}} testID="h" />
        <OAuthButton provider="apple" onPress={() => {}} testID="a" />
      </>,
      "tr",
    );
    const t = await tr();
    expect(leftoverEnglish(collectTexts(), "tr")).toEqual([]);
    expect(screen.getByText(t("common.label.or"))).toBeTruthy();
    expect(screen.getByText(t("common.action.continueWithGoogle"))).toBeTruthy();
    expect(screen.getByText(t("common.action.signInWithApple"))).toBeTruthy();
    expect(screen.getByText(t("common.status.lastUsed"))).toBeTruthy();
  });

  it("English wording of the sign-in strip (approved rewording: or)", () => {
    render(<><OrDivider /><OAuthButton provider="google" onPress={() => {}} lastUsed /></>);
    expect(screen.getByText("or")).toBeTruthy();
    expect(screen.getByText("Continue with Google")).toBeTruthy();
    expect(screen.getByText("Last used")).toBeTruthy();
  });

  it("ErrorBoundary fallback", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("kaboom");
    }
    const r = await renderInLocale(<ErrorBoundary><Boom /></ErrorBoundary>, "tr");
    expect(screen.getByTestId("error-report")).toBeTruthy();
    expect(r.leftover()).toEqual([]);
    const t = await tr();
    expect(screen.getByLabelText(t("common.action.tryAgain"))).toBeTruthy();
    expect(screen.getByLabelText(t("common.action.reportThisProblem"))).toBeTruthy();
    spy.mockRestore();
  });

  it("GateScreen stalled state", async () => {
    jest.useFakeTimers();
    try {
      const r = await renderInLocale(<GateScreen onRetry={() => {}} />, "tr");
      act(() => { jest.advanceTimersByTime(STALLED_AFTER_MS + 1); });
      expect(screen.getByTestId("gate-stalled")).toBeTruthy();
      expect(r.leftover()).toEqual([]);
      r.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it("MaintenanceScreen", async () => {
    useMaintenanceStore.setState({ maintenance: { message: "Back at noon" } } as never);
    const r = await renderInLocale(<MaintenanceScreen />, "tr");
    expect(r.leftover({ allow: ["Back at noon"] })).toEqual([]);
    r.unmount();
    useMaintenanceStore.setState({ maintenance: null } as never);
  });

  it("ListPager range and button labels", async () => {
    function Host({ what }: { what: string }) {
      const pager = usePager(20);
      return <ListPager pager={pager} testID="p" what={what} />;
    }
    const t = await tr();
    for (const [what, kind] of [["failed items", "failed"], ["skipped items", "skipped"], ["items", "other"]] as const) {
      const r = await renderInLocale(<Host what={what} />, "tr");
      expect(screen.getByTestId("p-range").props.children).toBe(t("backup.label.firstLastOfTotal", { first: 1, last: 6, total: 20 }));
      expect(screen.getByLabelText(t("backup.label.nextKindSelectFailedFailedItemsSkippedSkippedItemsOtherItemsPage", { kind }))).toBeTruthy();
      expect(screen.getByLabelText(t("backup.label.previousKindSelectFailedFailedItemsSkippedSkippedItemsOtherItemsPage", { kind }))).toBeTruthy();
      expect(r.leftover()).toEqual([]);
      r.unmount();
    }
  });

  it("ListPager English is unchanged, including a list the catalog has no kind for", () => {
    function Host({ what }: { what: string }) {
      const pager = usePager(20);
      return <ListPager pager={pager} testID="p" what={what} />;
    }
    const { unmount } = render(<Host what="failed items" />);
    expect(screen.getByTestId("p-range").props.children).toBe("1-6 of 20");
    expect(screen.getByLabelText("Next failed items page")).toBeTruthy();
    unmount();
    render(<Host what="backups" />);
    expect(screen.getByLabelText("Previous backups page")).toBeTruthy();
  });
});

describe("workspace screens", () => {
  it("settings as a restricted member", async () => {
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("ws-name-readonly")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("roles-open-web")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("settings with every permission, editable fields", async () => {
    mockPerms.current = new Proxy({}, { get: () => true }) as never;
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    await waitFor(() => expect(screen.getByTestId("ws-name")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("ws-name"), "Acme 2");
    fireEvent.changeText(screen.getByTestId("limit-max_file_size_gb"), "9");
    expect(r.leftover({ allow: [...MOCK_DATA, "Acme 2"] })).toEqual([]);
  });

  it("settings as the owner: danger zone and transfer sheet", async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, is_owner: true, role_id: "role_owner" });
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    const t = await tr();
    await waitFor(() => expect(screen.getByTestId("ws-delete")).toBeTruthy());
    expect(screen.getByText(t("workspace-settings.description.permanentlyDeletesNameAndEverythingInItOnlyAvailableInTheWebAppIt", { name: "Acme" }))).toBeTruthy();
    fireEvent.press(screen.getByText(t("workspace-settings.action.transferOwnership")));
    await waitFor(() => expect(screen.getByTestId("transfer-sheet")).toBeTruthy());
    expect(screen.getByText(t("workspace-settings.label.transferOwnershipTo"))).toBeTruthy();
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("settings: leave dialog for a member", async () => {
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    const t = await tr();
    await waitFor(() => expect(screen.getByTestId("ws-leave")).toBeTruthy());
    fireEvent.press(screen.getByTestId("ws-leave"));
    expect(screen.getByText(t("workspace-settings.heading.leaveWorkspace"))).toBeTruthy();
    expect(screen.getByText(t("workspace-settings.description.youLlLoseAccessToNameUntilSomeoneInvitesYouBack", { name: "Acme" }))).toBeTruthy();
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("settings: the numbers line, role line and storage line follow the catalog", async () => {
    await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    const t = await tr();
    await waitFor(() => expect(screen.getByTestId("ws-name-readonly")).toBeTruthy());
    expect(screen.getByText(t("workspace-settings.label.rolePlanPlan", { role: t("common.label.admin"), plan: "team" }))).toBeTruthy();
    // The roles list is its own query and can land after the name row.
    expect(await screen.findByText(t("workspace-settings.label.grantedOfTotalPermissions", { granted: 1, total: 2 }))).toBeTruthy();
  });

  it("settings: the error state and the toasts", async () => {
    mockDetail.mockRejectedValue(new Error("x"));
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    const t = await tr();
    await waitFor(() => expect(screen.getByText(t("workspace-settings.error.couldnTLoadWorkspaceSettings"))).toBeTruthy());
    expect(r.leftover()).toEqual([]);
  });

  it("settings: validation toast", async () => {
    mockPerms.current = new Proxy({}, { get: () => true }) as never;
    await renderInLocale(withQuery(<WorkspaceSettingsScreen />), "tr");
    const t = await tr();
    await waitFor(() => expect(screen.getByTestId("limit-max_file_size_gb")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("limit-max_file_size_gb"), "");
    fireEvent.changeText(screen.getByTestId("limit-max_file_size_gb"), "abc");
    fireEvent.press(screen.getByTestId("limit-save-max_file_size_gb"));
    expect(mockToast).toHaveBeenCalledWith(t("workspace-settings.error.enterANumber"), "error");
  });

  it("settings follows a language switch while mounted", async () => {
    let setPref: (p: "de") => Promise<void> = async () => {};
    function Probe() {
      setPref = useLocale().setPreference as never;
      return null;
    }
    await renderInLocale(withQuery(<><WorkspaceSettingsScreen /><Probe /></>), "en");
    await waitFor(() => expect(screen.getByText("Hard limits")).toBeTruthy());
    expect(screen.getByText("Roles & permissions")).toBeTruthy();
    await act(async () => { await setPref("de"); });
    expect(screen.queryByText("Hard limits")).toBeNull();
    const de = makeT("de", await loadMessages("de"), en);
    expect(collectTexts()).toContain(de("workspace-settings.heading.hardLimits"));
    expect(leftoverEnglish(collectTexts(), "de", { allow: MOCK_DATA })).toEqual([]);
  });

  it("settings English is unchanged", async () => {
    render(withQuery(<WorkspaceSettingsScreen />));
    await waitFor(() => expect(screen.getByText("Hard limits")).toBeTruthy());
    expect(screen.getByText("Admin · team plan")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1 of 2 permissions")).toBeTruthy());
    expect(screen.getByText("10 B of 100 B used (10%)")).toBeTruthy();
    expect(screen.getAllByText("Your role can't change this.").length).toBeGreaterThan(0);
    expect(screen.getByText("Edit roles on the web")).toBeTruthy();
  });

  it("dashboard", async () => {
    (useWorkspaceDashboard as jest.Mock).mockReturnValue({
      isLoading: false, isError: false, refetch: jest.fn(),
      data: {
        total: { limit_bytes: 10_737_418_240, used_bytes: 2_147_483_648, free_bytes: 8_589_934_592 },
        sources: [{ kind: "plan", label: "Pro plan", bytes: 10_737_418_240, meta: {} }],
        owned: [{ id: "w1", name: "Acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, used_bytes: 1_073_741_824, share_pct: 50 }],
        shared: [{ id: "w2", name: "Other", icon_initials: "OT", icon_color: "#22c55e", icon_image_url: null, role_id: "role_member", owner_name: "Sam" }],
      },
    });
    const r = await renderInLocale(<WorkspaceDashboardScreen />, "tr");
    expect(r.leftover({ allow: ["Pro plan", "Acme", "Other", "Sam", "AC", "OT"] })).toEqual([]);
    expect(collectTexts().some((x) => x.includes("\u0000"))).toBe(false);
    const t = await tr();
    expect(screen.getByText(t("dashboard.heading.usedsizeUsed", { usedSize: formatBytes(2_147_483_648) }).replace(formatBytes(2_147_483_648), "").trim())).toBeTruthy();
    expect(screen.getByText(t("dashboard.heading.whereYourSpaceComesFrom"))).toBeTruthy();
    expect(screen.getByText(t("dashboard.label.pctOfYourTotalSpaceUsed", { pct: 20 }))).toBeTruthy();
    expect(screen.getByText(t("common.label.freeFreeOfTotal", { free: formatBytes(8_589_934_592), total: formatBytes(10_737_418_240) }))).toBeTruthy();
    expect(screen.getByText(t("workspaces.description.theseUseTheOwnerSStorageNotYours"))).toBeTruthy();
  });

  it("dashboard error and empty states", async () => {
    (useWorkspaceDashboard as jest.Mock).mockReturnValue({ isLoading: false, isError: true, refetch: jest.fn(), data: undefined });
    const r = await renderInLocale(<WorkspaceDashboardScreen />, "tr");
    expect(r.leftover()).toEqual([]);
    expect(screen.getByTestId("screen-title")).toBeTruthy();
  });

  it("dashboard English is unchanged", () => {
    (useWorkspaceDashboard as jest.Mock).mockReturnValue({
      isLoading: false, isError: false, refetch: jest.fn(),
      data: {
        total: { limit_bytes: 10_737_418_240, used_bytes: 2_147_483_648, free_bytes: 8_589_934_592 },
        sources: [], owned: [], shared: [],
      },
    });
    render(<WorkspaceDashboardScreen />);
    expect(screen.getByText("8.0 GB free of 10.0 GB")).toBeTruthy();
    expect(screen.getByText("20% of your total space used")).toBeTruthy();
    expect(screen.getByText("You don't own any workspaces yet.")).toBeTruthy();
    expect(screen.getByText("Where your space comes from")).toBeTruthy();
  });

  it("my workspaces", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({
      isLoading: false, isError: false, refetch: jest.fn(),
      data: [{ id: "w1", name: "Acme", slug: "a", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: Math.floor(Date.now() / 1000) - 86400 * 3 }],
    });
    const r = await renderInLocale(<WorkspacesScreen />, "tr");
    const t = await tr();
    expect(r.leftover({ allow: ["Acme", "AC"] })).toEqual([]);
    expect(screen.getByText(`${t("workspaces.label.joinedTimeAgo", { timeAgo: t("common.label.countPluralOneDayAgoOtherDaysAgo", { count: 3 }) })}`)).toBeTruthy();
  });

  it("my workspaces error and empty", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ isLoading: false, isError: true, refetch: jest.fn(), data: undefined });
    let r = await renderInLocale(<WorkspacesScreen />, "tr");
    expect(r.leftover()).toEqual([]);
    r.unmount();
    (useWorkspaces as jest.Mock).mockReturnValue({ isLoading: false, isError: false, refetch: jest.fn(), data: [] });
    r = await renderInLocale(<WorkspacesScreen />, "tr");
    expect(r.leftover()).toEqual([]);
  });
});

describe("navigation titles", () => {
  it("tab labels", async () => {
    await renderInLocale(<TabsLayout />, "tr");
    const t = await tr();
    expect(mockTitles).toContain(t("common.label.files"));
    expect(mockTitles).toContain(t("common.label.backup"));
    expect(mockTitles).toContain(t("common.label.settings"));
    expect(mockTitles).not.toContain("Files");
    expect(mockTitles).not.toContain("Settings");
    expect(mockTitles).not.toContain("Backup");
  });

  it("tab labels in English", () => {
    render(<TabsLayout />);
    expect(mockTitles).toEqual(["Files", "Vault", "Backup", "Settings"]);
  });

  it("root layout screen titles", async () => {
    const t = await tr();
    render(<RootLayout />);
    await waitFor(() => expect(screen.queryByTestId("app-loading")).toBeNull());
    expect(mockTitles).toContain(t("common.heading.reportAProblem"));
    expect(mockTitles).not.toContain("Report a problem");
    // "Vault diagnostics" has no catalog entry and stays English.
    expect(mockTitles).toContain("Vault diagnostics");
  });
});
