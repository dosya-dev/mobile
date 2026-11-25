import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { useWorkspaces } from "./hooks";
import { useWorkspaceStore } from "./workspaceStore";

jest.mock("./hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

const mockUseWorkspaces = useWorkspaces as jest.Mock;

// The switcher creates workspaces, so it needs a real query client to invalidate with.
// gcTime: 0 keeps jest from holding the cache timer open.
let qc: QueryClient;
function renderSwitcher(ui: ReactElement) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => qc?.clear());

const WS = [
  { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: 1700000000 },
  { id: "w2", name: "Beta", slug: "beta", icon_initials: "BE", icon_color: "#2f6fd0", icon_image_url: null, role_id: "role_member", joined_at: 1700000000 },
];

beforeEach(() => {
  mockUseWorkspaces.mockReset();
  useWorkspaceStore.setState({ activeId: "w1" });
});

it("shows the active workspace name and role", () => {
  mockUseWorkspaces.mockReturnValue({ data: WS, isLoading: false });
  renderSwitcher(<WorkspaceSwitcher />);
  expect(screen.getByText("Acme")).toBeTruthy();
  expect(screen.getByText("Owner")).toBeTruthy(); // regression: web shows "Member" for owners
});

it("opens the sheet and switches workspace", async () => {
  mockUseWorkspaces.mockReturnValue({ data: WS, isLoading: false });
  const setActive = jest.fn();
  useWorkspaceStore.setState({ activeId: "w1", setActive } as never);
  renderSwitcher(<WorkspaceSwitcher />);
  fireEvent.press(screen.getByTestId("ws-trigger"));
  fireEvent.press(screen.getByTestId("ws-item-w2"));
  await waitFor(() => expect(setActive).toHaveBeenCalledWith("w2"));
});

it("shows the switching splash with the workspace you picked", async () => {
  mockUseWorkspaces.mockReturnValue({ data: WS, isLoading: false });
  useWorkspaceStore.setState({ activeId: "w1", setActive: jest.fn() } as never);
  renderSwitcher(<WorkspaceSwitcher />);
  fireEvent.press(screen.getByTestId("ws-trigger"));
  fireEvent.press(screen.getByTestId("ws-item-w2"));
  await waitFor(() => expect(screen.getByTestId("ws-switch-splash")).toBeTruthy());
  expect(screen.getByText("Switching workspace…")).toBeTruthy();
});

it("does not flash the splash when picking the workspace you're already in", async () => {
  mockUseWorkspaces.mockReturnValue({ data: WS, isLoading: false });
  const setActive = jest.fn();
  useWorkspaceStore.setState({ activeId: "w1", setActive } as never);
  renderSwitcher(<WorkspaceSwitcher />);
  fireEvent.press(screen.getByTestId("ws-trigger"));
  fireEvent.press(screen.getByTestId("ws-item-w1"));
  await waitFor(() => expect(screen.queryByTestId("ws-sheet")).toBeNull());
  expect(screen.queryByTestId("ws-switch-splash")).toBeNull();
  expect(setActive).not.toHaveBeenCalled();
});

it("shows a loading placeholder before workspaces resolve", () => {
  mockUseWorkspaces.mockReturnValue({ data: undefined, isLoading: true });
  renderSwitcher(<WorkspaceSwitcher />);
  expect(screen.getByText("Loading…")).toBeTruthy();
});

it("persists the first workspace as active when none is stored", async () => {
  const setActive = jest.fn();
  // hydrated: the auto-pick fence only opens once the persisted read landed.
  useWorkspaceStore.setState({ activeId: null, hydrated: true, setActive } as never);
  mockUseWorkspaces.mockReturnValue({ data: WS, isLoading: false });
  renderSwitcher(<WorkspaceSwitcher />);
  await waitFor(() => expect(setActive).toHaveBeenCalledWith("w1"));
});

describe("switcher backup status + storage", () => {
  it("shows the live indicator on the workspace being backed up and storage on the rest", async () => {
    const { useBackupRun } = require("@/backup/runState");
    const { useWorkspaces } = require("./hooks");
    (useWorkspaces as jest.Mock).mockReturnValue({
      data: [
        { id: "w1", name: "Personal", icon_initials: "P", icon_color: null, icon_image_url: null, storage: { used: 10, total: 100 } },
        { id: "w2", name: "Team", icon_initials: "T", icon_color: null, icon_image_url: null, storage: { used: 50, total: 100 } },
      ],
      isLoading: false,
    });
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", workspaceId: "w1", startedAt: 1 });

    renderSwitcher(<WorkspaceSwitcher />);
    fireEvent.press(screen.getByTestId("ws-trigger"));

    expect(await screen.findByTestId("ws-backing-w1")).toHaveTextContent(/Backing up/);
    expect(screen.getByTestId("ws-storage-w2")).toHaveTextContent(/50 B free of 100 B/);
    useBackupRun.setState({ phase: "idle", workspaceName: null, workspaceId: null, startedAt: null });
  });
});

