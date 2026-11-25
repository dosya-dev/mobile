import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RequestDetailScreen from "./[id]";
import {
  listUploads, listRecipients, addRecipient, removeRecipient,
  resendInvite, patchRequest, revokeRequest,
} from "@/requests/api";
import { ApiError } from "@/api/errors";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "fr_1" }),
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("@/requests/api", () => ({
  listUploads: jest.fn(),
  listRecipients: jest.fn(),
  addRecipient: jest.fn(),
  removeRecipient: jest.fn(),
  resendInvite: jest.fn(),
  patchRequest: jest.fn(),
  revokeRequest: jest.fn(),
}));

const mockUploads = listUploads as jest.MockedFunction<typeof listUploads>;
const mockRecipients = listRecipients as jest.MockedFunction<typeof listRecipients>;
const mockAdd = addRecipient as jest.MockedFunction<typeof addRecipient>;
const mockRemove = removeRecipient as jest.MockedFunction<typeof removeRecipient>;
const mockResend = resendInvite as jest.MockedFunction<typeof resendInvite>;
const mockPatch = patchRequest as jest.MockedFunction<typeof patchRequest>;
const mockRevoke = revokeRequest as jest.MockedFunction<typeof revokeRequest>;

const NOW = Math.floor(Date.now() / 1000);

const request = (over: Record<string, unknown> = {}) => ({
  id: "fr_1", token: "tok", title: "Brand assets", message: null,
  is_password_protected: 0, expires_at: null, allowed_extensions: null,
  max_file_size_bytes: null, max_files: null, upload_count: 1, is_revoked: 0,
  created_at: NOW - 100, folder_id: null, created_by_name: "Ada",
  folder_name: null, url: "https://dosya.dev/upload-request/tok",
  ...over,
}) as any;

const upload = (over: Record<string, unknown> = {}) => ({
  id: "fru_1", file_id: "f1", uploader_email: "guest@example.com",
  uploader_name: "Guest", created_at: NOW - 50, file_name: "logo.png",
  size_bytes: 2048, mime_type: "image/png", extension: ".png",
  ...over,
}) as any;

const recipient = (over: Record<string, unknown> = {}) => ({
  id: "rcp_1", email: "a@b.c", token: "t", sent_at: NOW - 60,
  uploaded_at: null, created_at: NOW - 60,
  ...over,
}) as any;

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RequestDetailScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploads.mockResolvedValue({ request: request(), uploads: [upload()] });
  mockRecipients.mockResolvedValue([recipient()]);
  mockAdd.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  mockResend.mockResolvedValue(undefined);
  mockPatch.mockResolvedValue(undefined);
  mockRevoke.mockResolvedValue(undefined);
});

describe("request detail", () => {
  it("shows the link, what arrived, and who was asked", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-link")).toBeTruthy());
    expect(screen.getByTestId("upload-fru_1")).toBeTruthy();
    expect(screen.getByTestId("recipient-rcp_1")).toBeTruthy();
  });

  it("says nothing arrived yet, rather than looking broken", async () => {
    mockUploads.mockResolvedValue({ request: request(), uploads: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("uploads-empty")).toBeTruthy());
  });

  it("distinguishes a failed load from an empty request", async () => {
    mockUploads.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-error")).toBeTruthy());
    expect(screen.getByTestId("detail-retry")).toBeTruthy();
  });
});

describe("recipients", () => {
  it("adds one", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-add-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("recipient-add-input"), "new@example.com");
    fireEvent.press(screen.getByTestId("recipient-add"));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("fr_1", "new@example.com"));
  });

  it("reports a duplicate against the input, not as a toast that scrolls away", async () => {
    mockAdd.mockRejectedValue(new ApiError("This email is already a recipient", 409));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-add-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("recipient-add-input"), "a@b.c");
    fireEvent.press(screen.getByTestId("recipient-add"));
    await waitFor(() => expect(screen.getByTestId("recipient-add-error")).toBeTruthy());
  });

  it("refuses to send something that is not an address", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-add-input")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("recipient-add-input"), "nope");
    fireEvent.press(screen.getByTestId("recipient-add"));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId("recipient-add-error")).toBeTruthy();
  });

  it("removes one after confirming", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-rcp_1-remove")).toBeTruthy());
    fireEvent.press(screen.getByTestId("recipient-rcp_1-remove"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("fr_1", "rcp_1"));
  });

  it("resends one invite", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-rcp_1-resend")).toBeTruthy());
    fireEvent.press(screen.getByTestId("recipient-rcp_1-resend"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith("fr_1", "rcp_1"));
  });

  it("resends to everyone who has not uploaded, and nobody who has", async () => {
    mockRecipients.mockResolvedValue([
      recipient({ id: "rcp_1" }),
      recipient({ id: "rcp_2", email: "d@e.f", uploaded_at: NOW - 10 }),
      recipient({ id: "rcp_3", email: "g@h.i" }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipients-resend-all")).toBeTruthy());
    fireEvent.press(screen.getByTestId("recipients-resend-all"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(2));
    expect(mockResend).toHaveBeenCalledWith("fr_1", "rcp_1");
    expect(mockResend).toHaveBeenCalledWith("fr_1", "rcp_3");
    expect(mockResend).not.toHaveBeenCalledWith("fr_1", "rcp_2");
  });

  it("offers no resend-all when everyone has already uploaded", async () => {
    mockRecipients.mockResolvedValue([recipient({ uploaded_at: NOW - 10 })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-rcp_1")).toBeTruthy());
    expect(screen.queryByTestId("recipients-resend-all")).toBeNull();
  });

  it("hides the add form on a closed request", async () => {
    // The API answers 410 for a revoked request, so the form must not be offered
    // at all rather than accepting an address it cannot use.
    mockUploads.mockResolvedValue({ request: request({ is_revoked: 1 }), uploads: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("recipient-rcp_1")).toBeTruthy());
    expect(screen.queryByTestId("recipient-add-input")).toBeNull();
  });
});

describe("editing and closing", () => {
  it("sends only the title it changed", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-edit")).toBeTruthy());
    fireEvent.press(screen.getByTestId("detail-edit"));
    fireEvent.changeText(screen.getByTestId("edit-title"), "Renamed");
    fireEvent.press(screen.getByTestId("edit-save"));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith("fr_1", { title: "Renamed" }));
  });

  it("sends nothing when nothing changed", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-edit")).toBeTruthy());
    fireEvent.press(screen.getByTestId("detail-edit"));
    fireEvent.press(screen.getByTestId("edit-save"));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("closes the request after confirming", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-close")).toBeTruthy());
    fireEvent.press(screen.getByTestId("detail-close"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith("fr_1"));
  });

  it("offers no close on an already closed request", async () => {
    mockUploads.mockResolvedValue({ request: request({ is_revoked: 1 }), uploads: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("detail-link")).toBeTruthy());
    expect(screen.queryByTestId("detail-close")).toBeNull();
  });
});
