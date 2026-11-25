/**
 * Core-screen sweep: workspace settings in tr, de, pl and zh-Hans with no
 * leftover English. Mocks follow ../k.test.tsx.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { __resetI18nForTests, t } from "@/lib/i18n";
import { renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";
import WorkspaceSettingsScreen from "../../../../app/workspace-settings";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { getWorkspaceDetail, getRoles, getTeam, type WorkspaceDetail } from "@/workspace/api";

jest.mock("expo-router", () => require("../../../../test-utils/i18n-sweep").routerMockWithTitles());
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

const mockDetail = getWorkspaceDetail as jest.Mock;
const mockRoles = getRoles as jest.Mock;
const mockTeam = getTeam as jest.Mock;

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

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockPerms.current = {};
  useWorkspaceStore.setState({ activeId: "w1" });
  mockDetail.mockResolvedValue(DETAIL);
  mockRoles.mockResolvedValue(ROLES);
  mockTeam.mockResolvedValue(TEAM);
  useAuthStore.setState({ status: "signedIn", user: { id: "u1" }, hydrate: jest.fn(), pending2fa: null, pendingVerificationEmail: null } as never);
});

describe.each(SWEEP_LOCALES)("Workspace settings in %s", (locale) => {
  it("as a restricted member", async () => {
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("ws-name-readonly")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("roles-open-web")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("with every permission, editable fields", async () => {
    mockPerms.current = new Proxy({}, { get: () => true }) as never;
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("ws-name")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("ws-name"), "Acme 2");
    fireEvent.changeText(screen.getByTestId("limit-max_file_size_gb"), "9");
    expect(r.leftover({ allow: [...MOCK_DATA, "Acme 2"] })).toEqual([]);
  });

  it("as the owner: the danger zone and the transfer sheet", async () => {
    mockDetail.mockResolvedValue({ ...DETAIL, is_owner: true, role_id: "role_owner" });
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("ws-delete")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    fireEvent.press(screen.getByText(t("workspace-settings.action.transferOwnership")));
    await waitFor(() => expect(screen.getByTestId("transfer-sheet")).toBeTruthy());
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
  });

  it("the leave dialog and the load error", async () => {
    const r = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("ws-leave")).toBeTruthy());
    fireEvent.press(screen.getByTestId("ws-leave"));
    expect(r.leftover({ allow: MOCK_DATA })).toEqual([]);
    r.unmount();
    mockDetail.mockRejectedValue(new Error("x"));
    const failed = await renderInLocale(withQuery(<WorkspaceSettingsScreen />), locale);
    await waitFor(() => expect(screen.getByText(t("workspace-settings.error.couldnTLoadWorkspaceSettings"))).toBeTruthy());
    expect(failed.leftover()).toEqual([]);
  });
});
