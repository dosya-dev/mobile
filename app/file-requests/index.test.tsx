import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RequestsScreen from "./index";
import { listRequests, createRequest } from "@/requests/api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/requests/api", () => ({
  listRequests: jest.fn(),
  createRequest: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));

const mockList = listRequests as jest.MockedFunction<typeof listRequests>;
const mockCreate = createRequest as jest.MockedFunction<typeof createRequest>;

const NOW = Math.floor(Date.now() / 1000);

function r(over: Record<string, unknown> = {}) {
  return {
    id: "fr_1", token: "tok", title: "Brand assets", message: null,
    is_password_protected: 0, expires_at: null, allowed_extensions: null,
    max_file_size_bytes: null, max_files: null, upload_count: 2, is_revoked: 0,
    created_at: NOW - 100, folder_id: null, created_by_name: "Ada",
    folder_name: null, url: "https://dosya.dev/upload-request/tok",
    ...over,
  } as any;
}

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RequestsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([r()]);
  mockCreate.mockResolvedValue({ url: "https://dosya.dev/upload-request/new" });
});

describe("file requests list", () => {
  it("lists the requests with their state", async () => {
    mockList.mockResolvedValue([r(), r({ id: "fr_2", title: "Invoices", is_revoked: 1 })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("request-fr_1")).toBeTruthy());
    expect(screen.getByTestId("request-fr_2")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("names an untitled request rather than showing a gap", async () => {
    mockList.mockResolvedValue([r({ title: null })]);
    renderScreen();
    await waitFor(() => expect(screen.getByText("Untitled request")).toBeTruthy());
  });

  it("invites a first request instead of showing a blank screen", async () => {
    mockList.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("requests-empty")).toBeTruthy());
  });

  it("distinguishes a failed load from having none", async () => {
    mockList.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("requests-error")).toBeTruthy());
    expect(screen.queryByTestId("requests-empty")).toBeNull();
    expect(screen.getByTestId("requests-retry")).toBeTruthy();
  });

  it("opens one on tap", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("request-fr_1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("request-fr_1"));
    expect(mockPush).toHaveBeenCalledWith("/file-requests/fr_1");
  });
});

describe("creating a request", () => {
  async function openSheet() {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("requests-new")).toBeTruthy());
    fireEvent.press(screen.getByTestId("requests-new"));
    await waitFor(() => expect(screen.getByTestId("create-title")).toBeTruthy());
  }

  it("creates with a title", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-title"), "Q2 assets");
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", title: "Q2 assets" }),
    ));
  });

  it("sends the invited addresses as a list", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-title"), "Q2 assets");
    fireEvent.changeText(screen.getByTestId("create-emails"), "a@b.c");
    fireEvent.press(screen.getByTestId("create-email-add"));
    fireEvent.changeText(screen.getByTestId("create-emails"), "d@e.f");
    fireEvent.press(screen.getByTestId("create-email-add"));
    expect(screen.getByTestId("create-email-a@b.c")).toBeTruthy();
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ emails: ["a@b.c", "d@e.f"] }),
    ));
  });

  it("takes a whole pasted list at once", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-emails"), "a@b.c, d@e.f");
    fireEvent.press(screen.getByTestId("create-email-add"));
    expect(screen.getByTestId("create-email-a@b.c")).toBeTruthy();
    expect(screen.getByTestId("create-email-d@e.f")).toBeTruthy();
  });

  it("adds no chip for something that is not an address", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-emails"), "not-an-email");
    fireEvent.press(screen.getByTestId("create-email-add"));
    expect(screen.queryByTestId("create-email-not-an-email")).toBeNull();
  });

  it("drops a chip that was added by mistake", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-emails"), "a@b.c");
    fireEvent.press(screen.getByTestId("create-email-add"));
    fireEvent.press(screen.getByTestId("create-email-remove-a@b.c"));
    expect(screen.queryByTestId("create-email-a@b.c")).toBeNull();
  });

  it("refuses a password shorter than the server's floor", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-title"), "Q2 assets");
    fireEvent.changeText(screen.getByTestId("create-password"), "short");
    fireEvent.press(screen.getByTestId("create-submit"));
    // Checked here rather than after a 400, which would arrive with the sheet
    // already gone.
    expect(screen.getByTestId("create-password-error")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps everything typed when the create fails", async () => {
    mockCreate.mockRejectedValue(new Error("offline"));
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-title"), "Q2 assets");
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(screen.getByTestId("create-title").props.value).toBe("Q2 assets");
  });

  it("offers the link once a request with no invites is made", async () => {
    await openSheet();
    fireEvent.changeText(screen.getByTestId("create-title"), "Q2 assets");
    fireEvent.press(screen.getByTestId("create-submit"));
    await waitFor(() => expect(screen.getByTestId("create-result-url")).toBeTruthy());
  });
});
