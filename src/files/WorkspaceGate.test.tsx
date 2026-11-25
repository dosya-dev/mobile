import type { ReactElement } from "react";
import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceGate } from "./WorkspaceGate";
import { useWorkspaces } from "./hooks";
import { useWorkspaceStore } from "./workspaceStore";

jest.mock("./hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

let qc: QueryClient;
function renderGate(ui: ReactElement) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => qc?.clear());

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: null, hydrated: true });
  jest.clearAllMocks();
});

describe("WorkspaceGate", () => {
  it("auto-selects the first workspace when none is selected (post-purge login)", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Personal" }], isLoading: false });
    renderGate(<WorkspaceGate><Text>APP</Text></WorkspaceGate>);
    expect(screen.getByText("APP")).toBeTruthy();
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe("w1"));
  });

  it("repairs a stale selection pointing at a workspace the user no longer has", async () => {
    useWorkspaceStore.setState({ activeId: "w_gone" });
    (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w2", name: "Team" }], isLoading: false });
    renderGate(<WorkspaceGate><Text>APP</Text></WorkspaceGate>);
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe("w2"));
  });

  it("renders children rather than a create form when the account has no workspace", () => {
    // Creating the first workspace is OnboardingFlow's job now; this gate only
    // guarantees a selection among workspaces that already exist.
    (useWorkspaces as jest.Mock).mockReturnValue({ data: [], isLoading: false });
    renderGate(<WorkspaceGate><Text>app</Text></WorkspaceGate>);
    expect(screen.queryByTestId("workspace-create-gate")).toBeNull();
  });

  it("passes through while loading (screens show their own loading states)", () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
    renderGate(<WorkspaceGate><Text>APP</Text></WorkspaceGate>);
    expect(screen.getByText("APP")).toBeTruthy();
  });

  // Confirmatory, not a fix: unlike OnboardingGate (see its own test for the
  // bug this guards against), this gate never conditions its render on
  // isLoading/isError/data at all - the auto-select effect just no-ops when
  // there's nothing to select from. So an errored fetch (retries exhausted,
  // data still undefined) can't strand this gate the way it could the other.
  it("passes through even when the workspaces fetch has settled to an error, never blocking on query state", () => {
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderGate(<WorkspaceGate><Text>APP</Text></WorkspaceGate>);
    expect(screen.getByText("APP")).toBeTruthy();
  });
});

it("never auto-picks before the persisted selection has hydrated", () => {
  useWorkspaceStore.setState({ activeId: null, hydrated: false });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w-first" }, { id: "w-mine" }], isLoading: false });
  renderGate(<WorkspaceGate><Text>child</Text></WorkspaceGate>);
  expect(useWorkspaceStore.getState().activeId).toBeNull();
});
