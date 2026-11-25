import { Linking } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkspaceSettingsScreen from "./workspace-settings";
import { getWorkspaceDetail, getRoles, type WorkspaceDetail } from "@/workspace/api";
import { useWorkspaceStore } from "@/files/workspaceStore";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
// Covered by src/ai-search/AiSearchSection.test.tsx; it fetches on its own.
jest.mock("@/ai-search/AiSearchSection", () => ({ AiSearchSection: () => null }));
jest.mock("@/workspace/api", () => ({
  getWorkspaceDetail: jest.fn(),
  getRoles: jest.fn(),
  getTeam: jest.fn(),
  updateWorkspaceName: jest.fn(),
  updateWorkspaceSettings: jest.fn(),
  transferOwnership: jest.fn(),
  leaveWorkspace: jest.fn(),
}));

/** The caller's permission map, swapped per test. */
const mockMe = { current: {} as Record<string, boolean> };
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({
    roleId: "role_c1",
    permissions: mockMe.current,
    can: (p: string) => mockMe.current[p] ?? false,
  }),
}));

const mockDetail = getWorkspaceDetail as jest.MockedFunction<typeof getWorkspaceDetail>;
const mockRoles = getRoles as jest.MockedFunction<typeof getRoles>;

const DETAIL: WorkspaceDetail = {
  workspace: {
    id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null,
    owner_id: "u9", default_region: "eu", created_at: 1700000000, storage_used_bytes: 10,
  },
  settings: { max_file_size_gb: 5, max_total_storage_gb: 100, require_2fa: true, session_timeout_minutes: 30 },
  role_id: "role_c1",
  is_owner: false,
  plan: "team",
  storage: { used: 10, total: 100, free: 90 },
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><WorkspaceSettingsScreen /></QueryClientProvider>);
}

describe("WorkspaceSettingsScreen permission gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useWorkspaceStore.setState({ activeId: "w1" });
    mockDetail.mockResolvedValue(DETAIL);
    mockRoles.mockResolvedValue({ roles: [{ id: "role_c1", name: "Ops", is_custom: true, permissions: { upload_files: true } }], all_permissions: [] });
  });

  it("shows the name read-only without change_workspace_name", async () => {
    mockMe.current = {};
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("ws-name-readonly")).toBeTruthy());
    expect(screen.queryByTestId("ws-name")).toBeNull();
    expect(screen.queryByTestId("ws-name-save")).toBeNull();
  });

  it("keeps the name editable with change_workspace_name", async () => {
    mockMe.current = { change_workspace_name: true };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("ws-name")).toBeTruthy());
    expect(screen.queryByTestId("ws-name-readonly")).toBeNull();
  });

  it("gates each hard limit on its own change_* permission", async () => {
    mockMe.current = { change_total_storage_cap: true };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("limit-max_total_storage_gb")).toBeTruthy());
    // Editable field present for the granted one, read-only row for the rest.
    expect(screen.queryByTestId("limit-max_file_size_gb")).toBeNull();
    expect(screen.getByTestId("limit-readonly-max_file_size_gb")).toBeTruthy();
    expect(screen.getByText("5 GB")).toBeTruthy();
  });

  it("makes the security section read-only without manage_settings", async () => {
    mockMe.current = {};
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("sec-require_2fa")).toBeTruthy());
    expect(screen.getByTestId("sec-require_2fa").props.disabled).toBe(true);
    expect(screen.queryByTestId("sec-session_timeout_minutes")).toBeNull();
    expect(screen.getByTestId("sec-readonly-session_timeout_minutes")).toBeTruthy();
  });

  it("points at the web app for editing roles", async () => {
    mockMe.current = {};
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("roles-open-web")).toBeTruthy());
    fireEvent.press(screen.getByTestId("roles-open-web"));
    expect(open).toHaveBeenCalledWith("https://app.dosya.dev/settings#roles");
  });

  it("has no Personas entry: Personas settings are each member's own, reached from Personas itself", async () => {
    mockMe.current = {};
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("ws-name-readonly")).toBeTruthy());
    expect(screen.queryByTestId("personas-settings-entry")).toBeNull();
    expect(screen.queryByText("Personas settings")).toBeNull();
  });
});
