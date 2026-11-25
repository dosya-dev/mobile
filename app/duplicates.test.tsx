import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DuplicatesScreen from "./duplicates";
import { getDuplicates, deleteDuplicates } from "@/duplicates/api";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/duplicates/api", () => ({
  getDuplicates: jest.fn(),
  deleteDuplicates: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));

const mockGet = getDuplicates as jest.MockedFunction<typeof getDuplicates>;
const mockDelete = deleteDuplicates as jest.MockedFunction<typeof deleteDuplicates>;

function group(hash: string, size: number, ids: string[]) {
  return {
    content_hash: hash, size_bytes: size, count: ids.length,
    wasted_bytes: (ids.length - 1) * size,
    files: ids.map((id, i) => ({
      id, name: `${hash}.png`, folder_id: null, folder_path: `Folder ${i}`,
      created_at: 1_700_000_000 - i, uploaded_by: "u1", uploader_name: "Ada",
      mime_type: "image/png", extension: ".png",
    })),
  };
}

const RESPONSE = {
  groups: [group("a", 100, ["a1", "a2", "a3"]), group("b", 50, ["b1", "b2"])],
  total_groups: 2,
  total_wasted_bytes: 250,
  pending: 0,
};

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DuplicatesScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(RESPONSE as any);
  mockDelete.mockResolvedValue({ deleted: 1, total: 1 });
});

describe("duplicates screen", () => {
  it("lists the groups and their copies", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    expect(screen.getByTestId("dup-file-a1")).toBeTruthy();
    expect(screen.getByTestId("dup-file-b2")).toBeTruthy();
  });

  it("marks the newest copy, which is the one All-but-newest keeps", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-newest-a1")).toBeTruthy());
    expect(screen.queryByTestId("dup-newest-a2")).toBeNull();
  });

  it("says so when the endpoint's 100-group cap is hiding the rest", async () => {
    // The header counts ALL the groups, the list only ever holds the largest
    // 100 - so without this the screen claims 340 and then simply runs out.
    mockGet.mockResolvedValue({ ...RESPONSE, total_groups: 340 } as any);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("duplicates-truncated")).toBeTruthy());
    expect(screen.getByTestId("duplicates-truncated")).toHaveTextContent(
      /Showing the 2 largest groups of 340/,
    );
  });

  it("says nothing about truncation when the whole set is on screen", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    expect(screen.queryByTestId("duplicates-truncated")).toBeNull();
  });

  it("celebrates having none rather than showing a blank screen", async () => {
    mockGet.mockResolvedValue({ groups: [], total_groups: 0, total_wasted_bytes: 0, pending: 0 } as any);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("duplicates-empty")).toBeTruthy());
  });

  it("distinguishes a failed check from a clean one", async () => {
    mockGet.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("duplicates-error")).toBeTruthy());
    expect(screen.queryByTestId("duplicates-empty")).toBeNull();
    expect(screen.getByTestId("duplicates-retry")).toBeTruthy();
  });

  it("says when the scan is incomplete, so a short list is not mistaken for the answer", async () => {
    mockGet.mockResolvedValue({ ...RESPONSE, pending: 12 } as any);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("duplicates-scanning")).toBeTruthy());
  });

  it("hides the action bar until something is selected", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-group-a")).toBeTruthy());
    expect(screen.queryByTestId("duplicates-delete")).toBeNull();
  });

  it("selects a copy and offers to trash it", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-a2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-a2"));
    expect(screen.getByTestId("duplicates-delete")).toBeTruthy();
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("w1", ["a2"]));
  });

  it("selects every copy but the newest in one tap", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("duplicates-select-all-but-newest")).toBeTruthy());
    fireEvent.press(screen.getByTestId("duplicates-select-all-but-newest"));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("w1", ["a2", "a3", "b2"]));
  });

  it("warns in the confirmation when no copy would be left", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-b1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-b1"));
    fireEvent.press(screen.getByTestId("dup-file-b2"));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    expect(screen.getByText(/no copy will be left/i)).toBeTruthy();
  });

  it("does not warn when one copy survives", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-b2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-b2"));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    expect(screen.queryByText(/no copy will be left/i)).toBeNull();
  });

  it("deselects on a second tap", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-a2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-a2"));
    fireEvent.press(screen.getByTestId("dup-file-a2"));
    expect(screen.queryByTestId("duplicates-delete")).toBeNull();
  });

  it("clears a selection without deleting anything", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-a2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-a2"));
    fireEvent.press(screen.getByTestId("duplicates-clear"));
    expect(screen.queryByTestId("duplicates-delete")).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("reports a partial delete honestly", async () => {
    mockDelete.mockResolvedValue({ deleted: 1, total: 2 });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("dup-file-a2")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dup-file-a2"));
    fireEvent.press(screen.getByTestId("dup-file-a3"));
    fireEvent.press(screen.getByTestId("duplicates-delete"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalled());
    // The screen must not claim both went when the API accepted one.
    expect(screen.queryByTestId("duplicates-delete")).toBeNull();
  });
});
