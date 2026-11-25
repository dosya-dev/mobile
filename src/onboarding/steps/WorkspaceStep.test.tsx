import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("@/files/api", () => ({ createWorkspace: jest.fn(), getRegions: jest.fn() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

const mockInvalidateQueries = jest.fn(async () => {});
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockSetActive = jest.fn(async () => {});
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: Object.assign(jest.fn(), { getState: () => ({ setActive: mockSetActive }) }),
}));
jest.mock("@/auth/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: "u1", name: "Firat" } }),
}));

import { createWorkspace, getRegions } from "@/files/api";
import { toast } from "@/ui/toast";
import { WorkspaceStep, defaultWorkspaceName } from "./WorkspaceStep";

const REGIONS = [
  { code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" },
  { code: "ap-southeast-2", city: "Sydney", country: "Australia", continent: "Oceania", flag: "" },
];

beforeEach(() => {
  jest.clearAllMocks();
  (getRegions as jest.Mock).mockResolvedValue({ regions: REGIONS, suggested: "eu-west-1" });
});

/** The locations have arrived and the step is interactive. */
const settled = () => screen.findByTestId("location-eu-west-1");

describe("defaultWorkspaceName", () => {
  it("uses the name captured at signup", () => {
    expect(defaultWorkspaceName("Firat")).toBe("Firat's Files");
  });
  it("falls back when there is no name", () => {
    expect(defaultWorkspaceName(null)).toBe("My Files");
    expect(defaultWorkspaceName("   ")).toBe("My Files");
  });
  it("uses the first word only, so a full name does not read as a sentence", () => {
    expect(defaultWorkspaceName("Firat Kaya")).toBe("Firat's Files");
  });
});

describe("WorkspaceStep", () => {
  it("pre-fills the field so the common case is one tap", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    expect(screen.getByTestId("workspace-name").props.value).toBe("Firat's Files");
  });

  it("creates, activates, and reports done", async () => {
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    const onDone = jest.fn();
    render(<WorkspaceStep onDone={onDone} />);
    await settled();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", "eu-west-1"));
    expect(mockSetActive).toHaveBeenCalledWith("ws1");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  // useWorkspaces has staleTime 5min and a mounted observer, so nothing
  // refetches on its own. Without this invalidation, for five minutes after a
  // new user named their workspace the header on every tab read "No
  // workspace", the photo step's subtitle degraded to "your workspace", and
  // that string was persisted as workspace_name in the first backup's history
  // row - on the primary new-user journey, every time.
  it("invalidates the workspaces query, so the rest of the app sees the new workspace at once", async () => {
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["workspaces"] }));
  });

  it("invalidates before it reports done, so nothing downstream reads the stale list", async () => {
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    const onDone = jest.fn();
    render(<WorkspaceStep onDone={onDone} />);
    await settled();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockInvalidateQueries.mock.invocationCallOrder[0]).toBeLessThan(onDone.mock.invocationCallOrder[0]);
  });

  it("applies a quick-pick chip to the field", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.press(screen.getByText("Photos"));
    expect(screen.getByTestId("workspace-name").props.value).toBe("Photos");
  });

  it("does not advance when creation fails", async () => {
    (createWorkspace as jest.Mock).mockRejectedValue(new Error("offline"));
    const onDone = jest.fn();
    render(<WorkspaceStep onDone={onDone} />);
    await settled();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("offline", "error"));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("refuses an empty name", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.changeText(screen.getByTestId("workspace-name"), "   ");
    fireEvent.press(screen.getByTestId("step-primary"));
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it("gives the workspace name field an accessible name", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    expect(screen.getByLabelText("Workspace name")).toBe(screen.getByTestId("workspace-name"));
  });

  it("disables Continue while the name is empty, so a required field never reads as broken", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.changeText(screen.getByTestId("workspace-name"), "   ");
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(true);
  });

  it("does not create a second workspace on a rapid double press", async () => {
    let resolveCreate!: (ws: { id: string; name: string }) => void;
    (createWorkspace as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    const primary = screen.getByTestId("step-primary");
    fireEvent.press(primary);
    fireEvent.press(primary);
    resolveCreate({ id: "ws1", name: "Firat's Files" });
    await waitFor(() => expect(mockSetActive).toHaveBeenCalled());
    expect(createWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does not create a second workspace even if both presses land before the button can disable itself", async () => {
    // Two fireEvent.press calls a tick apart are already caught by the button's
    // own disabled state (from primaryLoading) - that's the test above. This one
    // dispatches both presses inside a single act() batch, so no render commits
    // between them and the button is still "enabled" for the second dispatch too:
    // the same race a real device can hit if it queues a second touch before the
    // updated `disabled` prop reaches the native view. Only a same-tick guard
    // (not a useState value, which can't be read back until the next render) can
    // stop this one.
    let resolveCreate!: (ws: { id: string; name: string }) => void;
    (createWorkspace as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    const primary = screen.getByTestId("step-primary");
    await act(async () => {
      fireEvent.press(primary);
      fireEvent.press(primary);
    });
    resolveCreate({ id: "ws1", name: "Firat's Files" });
    await waitFor(() => expect(mockSetActive).toHaveBeenCalled());
    expect(createWorkspace).toHaveBeenCalledTimes(1);
  });
});

// Where a workspace's files live is settled here and nowhere else: the server
// refuses to move a workspace afterwards, and ignores a region on every upload.
describe("WorkspaceStep - location", () => {
  it("offers the locations the server lists, and preselects its suggestion", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    expect(await settled()).toBeTruthy();
    expect(screen.getByTestId("location-ap-southeast-2")).toBeTruthy();
    expect(screen.getByTestId("location-eu-west-1").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("location-ap-southeast-2").props.accessibilityState.selected).toBe(false);
  });

  it("says the choice is permanent, because it is", async () => {
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    expect(screen.getByTestId("location-explainer")).toHaveTextContent(
      "Where this workspace's files are stored. Chosen once.",
    );
  });

  it("creates in the suggested location without the user touching the picker", async () => {
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", "eu-west-1"));
  });

  it("creates in the location the user picked instead", async () => {
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    fireEvent.press(screen.getByTestId("location-ap-southeast-2"));
    expect(screen.getByTestId("location-ap-southeast-2").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", "ap-southeast-2"));
  });

  // The choice is permanent, so creating before the list has arrived would
  // silently spend it.
  it("holds Continue while the locations are still loading", async () => {
    let resolveRegions!: (r: { regions: typeof REGIONS; suggested: string }) => void;
    (getRegions as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { resolveRegions = resolve; }),
    );
    render(<WorkspaceStep onDone={jest.fn()} />);
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(true);
    await act(async () => { resolveRegions({ regions: REGIONS, suggested: "eu-west-1" }); });
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(false);
  });

  // A locations outage must not become "you cannot create a workspace". The
  // server picks the nearest location when the request carries none.
  it("says so when the locations cannot be loaded, and still creates - without one", async () => {
    (getRegions as jest.Mock).mockRejectedValue(new Error("offline"));
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    const onDone = jest.fn();
    render(<WorkspaceStep onDone={onDone} />);
    expect(await screen.findByTestId("location-error")).toHaveTextContent(/closest to you/i);
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", undefined));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  // An empty catalog is the same dead end as a failed request.
  it("treats an empty catalog the same way, rather than showing a picker with nothing in it", async () => {
    (getRegions as jest.Mock).mockResolvedValue({ regions: [], suggested: "" });
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    expect(await screen.findByTestId("location-error")).toBeTruthy();
    expect(screen.queryByTestId("location-search")).toBeNull();
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", undefined));
  });

  // Preselecting a code the list does not offer would show nothing chosen while
  // the step believed a location had been picked.
  it("ignores a suggestion the catalog does not contain", async () => {
    (getRegions as jest.Mock).mockResolvedValue({ regions: REGIONS, suggested: "mars-1" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    expect(screen.getByTestId("location-eu-west-1").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("location-ap-southeast-2").props.accessibilityState.selected).toBe(false);
  });

  // A loaded catalog with nothing chosen is the one case where a tap would
  // spend the permanent choice on the server's guess without the user ever
  // seeing a location. Web (create-workspace.tsx) and desktop
  // (CreateWorkspacePage.tsx) both hold the button here; so does this.
  it("holds Continue when the catalog loaded but nothing is selected", async () => {
    (getRegions as jest.Mock).mockResolvedValue({ regions: REGIONS, suggested: "mars-1" });
    (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "Firat's Files" });
    render(<WorkspaceStep onDone={jest.fn()} />);
    await settled();
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("step-primary"));
    expect(createWorkspace).not.toHaveBeenCalled();

    // Picking one releases it, and creates in exactly what was picked.
    fireEvent.press(screen.getByTestId("location-ap-southeast-2"));
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("Firat's Files", "ap-southeast-2"));
  });

  // The mirror case: with nothing to choose FROM, the same gate must not lock
  // the only button on the screen. Covered for creation above; asserted here
  // as the button state, next to the case it is the exception to.
  it("leaves Continue enabled when the catalog could not be loaded", async () => {
    (getRegions as jest.Mock).mockRejectedValue(new Error("offline"));
    render(<WorkspaceStep onDone={jest.fn()} />);
    await screen.findByTestId("location-error");
    expect(screen.getByTestId("step-primary").props.accessibilityState?.disabled).toBe(false);
  });
});
