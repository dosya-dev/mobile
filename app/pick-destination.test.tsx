import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PickDestination from "./pick-destination";
import { useSelectionMoves } from "@/files/selection/selectionMoveStore";

const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: (...a: unknown[]) => mockBack(...a) }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));

jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: "ws_1" }),
}));

jest.mock("@/files/hooks", () => {
  const folder = (id: string, name: string) => ({ id, name, created_at: 1, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none" });
  return {
    useWorkspaces: () => ({ data: [{ id: "ws_1", name: "Personal" }] }),
    useFileList: (_ws: string | null, folderId: string | null) => ({
      data: { pages: [{ folders: folderId === null ? [folder("fld_a", "Alpha"), folder("fld_b", "Beta")] : [], files: [] }] },
    }),
  };
});

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const mockMoveFile = jest.fn(async () => ({ ok: true }));
const mockMoveFolder = jest.fn(async () => ({ ok: true }));
jest.mock("@/files/mutations", () => ({
  ...jest.requireActual("@/files/mutations"),
  moveFile: (...a: unknown[]) => mockMoveFile(...(a as [])),
  moveFolder: (...a: unknown[]) => mockMoveFolder(...(a as [])),
}));

function renderPicker() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><PickDestination /></QueryClientProvider>);
}

beforeEach(() => { jest.clearAllMocks(); });

describe("PickDestination with a selection", () => {
  it("moves every selected file and folder into the chosen folder, toasts the count and goes back", async () => {
    mockParams = { fileIds: "f1,f2", folderIds: "fld_b", mode: "move" };
    renderPicker();
    // The selected folder is not offered as a destination.
    expect(screen.queryByText("Beta")).toBeNull();
    fireEvent.press(screen.getByText("Alpha"));
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockMoveFile).toHaveBeenCalledWith("f1", "fld_a");
    expect(mockMoveFile).toHaveBeenCalledWith("f2", "fld_a");
    expect(mockMoveFolder).toHaveBeenCalledWith("fld_b", "fld_a");
    expect(mockToast).toHaveBeenCalledWith("3 items moved.", "success");
  });

  it("stays on the screen and reports the reason when every item was refused", async () => {
    mockParams = { fileIds: "f1", folderIds: "", mode: "move" };
    mockMoveFile.mockRejectedValueOnce(new Error("The file is locked"));
    renderPicker();
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("The file is locked", "error"));
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe("PickDestination with one item", () => {
  it("still moves a single file by id", async () => {
    mockParams = { fileId: "f9", mode: "move" };
    renderPicker();
    fireEvent.press(screen.getByText("Alpha"));
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockMoveFile).toHaveBeenCalledWith("f9", "fld_a");
  });
});

describe("PickDestination tells the browser its selection moved", () => {
  beforeEach(() => useSelectionMoves.setState({ moved: null }));

  it("records the browser's token once the selection move succeeds", async () => {
    mockParams = { fileIds: "f1", folderIds: "", mode: "move", moveToken: "tok-1" };
    renderPicker();
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(useSelectionMoves.getState().moved).toBe("tok-1");
  });

  // Ruling: the selection ends once ANY item moved, even when others failed.
  it("records the token and goes back on a partial success", async () => {
    mockParams = { fileIds: "f1,f2", folderIds: "", mode: "move", moveToken: "tok-3" };
    mockMoveFile.mockRejectedValueOnce(new Error("The file is locked"));
    renderPicker();
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(useSelectionMoves.getState().moved).toBe("tok-3");
    expect(mockToast).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("records nothing when every item was refused", async () => {
    mockParams = { fileIds: "f1", folderIds: "", mode: "move", moveToken: "tok-2" };
    mockMoveFile.mockRejectedValueOnce(new Error("The file is locked"));
    renderPicker();
    fireEvent.press(screen.getByTestId("apply-destination"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("The file is locked", "error"));
    expect(useSelectionMoves.getState().moved).toBeNull();
  });
});
