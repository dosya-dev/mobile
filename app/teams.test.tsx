import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeamsScreen from "./teams";
import { getTeam, getRoles, changeMemberRole, type TeamMember, type RoleInfo } from "@/workspace/api";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { toast } from "@/ui/toast";
import { finishSheetDismissal } from "@/ui/sheetTesting";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/workspace/api", () => ({
  getTeam: jest.fn(),
  getRoles: jest.fn(),
  inviteToWorkspace: jest.fn(),
  removeMember: jest.fn(),
  changeMemberRole: jest.fn(),
}));

/** The caller's role, swapped per test. `permissions` undefined = still loading. */
const mockMe = { current: { roleId: "role_admin", permissions: undefined as Record<string, boolean> | undefined } };
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({
    roleId: mockMe.current.roleId,
    permissions: mockMe.current.permissions,
    can: (p: string) => (mockMe.current.permissions ? mockMe.current.permissions[p] ?? false : true),
  }),
}));

const mockTeam = getTeam as jest.MockedFunction<typeof getTeam>;
const mockRoles = getRoles as jest.MockedFunction<typeof getRoles>;
const mockChange = changeMemberRole as jest.MockedFunction<typeof changeMemberRole>;

const member = (membership_id: string, over: Partial<TeamMember> = {}): TeamMember => ({
  membership_id, user_id: `u_${membership_id}`, role_id: "role_member", name: membership_id.toUpperCase(),
  email: `${membership_id}@x.com`, avatar_url: null, joined_at: Math.floor(Date.now() / 1000), is_you: false, ...over,
});

const ROLES: RoleInfo[] = [
  // /api/roles serves the full permission map for the built-in tiers too;
  // the grant rule reads it the same way it reads a custom role's.
  { id: "role_owner", name: "Owner", is_builtin: true, permissions: { manage_roles: true, invite_members: true, upload_files: true, download_files: true, lock_files: true } },
  { id: "role_admin", name: "Admin", is_builtin: true, permissions: { manage_roles: true, invite_members: true, upload_files: true, download_files: true, lock_files: false } },
  { id: "role_member", name: "Member", is_builtin: true, permissions: { upload_files: true, download_files: true } },
  { id: "role_viewer", name: "Viewer", is_builtin: true, permissions: { download_files: true } },
  { id: "role_c1", name: "Locker", is_custom: true, permissions: { upload_files: true, lock_files: true } },
  { id: "role_c2", name: "Uploader", is_custom: true, permissions: { upload_files: true } },
];

const ADMIN_PERMS = { manage_roles: true, invite_members: true, upload_files: true, download_files: true, lock_files: false };

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><TeamsScreen /></QueryClientProvider>);
}

describe("TeamsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useWorkspaceStore.setState({ activeId: "w1" });
    mockMe.current = { roleId: "role_admin", permissions: ADMIN_PERMS };
    mockRoles.mockResolvedValue({ roles: ROLES, all_permissions: [] });
    mockTeam.mockResolvedValue({
      members: [member("m1", { role_id: "role_admin", is_you: true }), member("m2"), member("m3", { role_id: "role_owner" })],
    });
  });

  it("never offers Remove or a role change on the caller's own row, even to a role manager", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("member-m1")).toBeTruthy());
    expect(screen.getByTestId("you-m1")).toBeTruthy();
    expect(screen.queryByTestId("remove-m1")).toBeNull();
    expect(screen.queryByTestId("role-m1")).toBeNull();
    // Another member's row keeps both controls.
    expect(screen.getByTestId("remove-m2")).toBeTruthy();
    expect(screen.getByTestId("role-m2")).toBeTruthy();
  });

  it("hides the caller's own controls while permissions are still loading (can() fails open)", async () => {
    mockMe.current = { roleId: "role_admin", permissions: undefined };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("member-m1")).toBeTruthy());
    expect(screen.queryByTestId("remove-m1")).toBeNull();
    expect(screen.queryByTestId("role-m1")).toBeNull();
  });

  it("hides the invite card without invite_members", async () => {
    mockMe.current = { roleId: "role_member", permissions: { invite_members: false } };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("member-m1")).toBeTruthy());
    expect(screen.queryByTestId("invite-email")).toBeNull();
  });

  it("offers only the roles the caller may grant", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("invite-role-role_admin")).toBeTruthy());
    // An admin lacks lock_files, so the custom role that grants it is off the menu.
    expect(screen.queryByTestId("invite-role-role_c1")).toBeNull();
    expect(screen.getByTestId("invite-role-role_c2")).toBeTruthy();
    expect(screen.queryByTestId("invite-role-role_owner")).toBeNull();
  });

  it("offers a custom-role caller only roles within their own permissions, and selects the first", async () => {
    // An Uploader may invite but cannot download, so every built-in tier
    // (each holds download_files) is off the menu, as is the Locker. The one
    // role within reach is their own, and the default of Member falls to it.
    mockMe.current = { roleId: "role_c2", permissions: { invite_members: true, upload_files: true } };
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("invite-role-role_c2")).toBeTruthy());
    expect(screen.queryByTestId("invite-role-role_viewer")).toBeNull();
    expect(screen.queryByTestId("invite-role-role_member")).toBeNull();
    expect(screen.queryByTestId("invite-role-role_admin")).toBeNull();
    expect(screen.queryByTestId("invite-role-role_c1")).toBeNull();
    expect(screen.getByTestId("invite-role-role_c2").props.accessibilityState.selected).toBe(true);
  });

  it("names a custom role in the success toast", async () => {
    mockChange.mockResolvedValue(undefined);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("role-m2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("role-m2"));
    // The invite chips also say "Uploader"; the sheet row is rendered last.
    const rows = await screen.findAllByText("Uploader");
    fireEvent.press(rows[rows.length - 1]);
    finishSheetDismissal();
    await waitFor(() => expect(mockChange).toHaveBeenCalledWith("m2", "role_c2"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("M2 is now Uploader"));
  });
});
