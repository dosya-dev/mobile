import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeleteAccountScreen from "./delete-account";
import { useMe } from "@/profile/hooks";
import { useAuthStore } from "@/auth/authStore";
import { fetchDeletePreview, requestDeleteCode, confirmDelete } from "@/account/deletion";
import { ApiError } from "@/api/errors";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/profile/hooks", () => ({ useMe: jest.fn() }));
jest.mock("@/account/deletion", () => ({
  ...jest.requireActual("@/account/deletion"),
  fetchDeletePreview: jest.fn(),
  requestDeleteCode: jest.fn(async () => {}),
  confirmDelete: jest.fn(),
  cancelDelete: jest.fn(async () => {}),
}));

const mockMe = useMe as jest.Mock;
const mockPreview = fetchDeletePreview as jest.Mock;
const mockRequestCode = requestDeleteCode as jest.Mock;
const mockConfirm = confirmDelete as jest.Mock;

const PREVIEW = {
  workspaces: [{ id: "ws_1", name: "Solo" }],
  file_count: 12,
  total_bytes: 4096,
  blockers: [],
  window_days: 30,
  deletion_scheduled_for: null,
};

const SCHEDULED = Math.floor(Date.now() / 1000) + 30 * 86400;

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );
}

let signOut: jest.Mock;

beforeEach(() => {
  mockMe.mockReset();
  mockPreview.mockReset();
  mockRequestCode.mockClear();
  mockConfirm.mockReset();
  mockPreview.mockResolvedValue(PREVIEW);
  mockConfirm.mockResolvedValue(SCHEDULED);
  signOut = jest.fn(async () => {});
  useAuthStore.setState({ signOut } as never);
});

/**
 * The 2026-10-03 App Review rejection (5.1.1(v)). The reviewer signs in with
 * the demo account and cannot read its mailbox, so a flow whose only
 * confirmation is an emailed code cannot be completed by them, and reads as
 * "no account deletion". A password account must therefore never be routed
 * through email.
 */
describe("account with a password", () => {
  beforeEach(() => mockMe.mockReturnValue({ data: { has_password: true } }));

  it("asks for the password after Continue and sends no email", async () => {
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    expect(await screen.findByTestId("password-state")).toBeTruthy();
    expect(mockRequestCode).not.toHaveBeenCalled();
    expect(screen.queryByTestId("code-state")).toBeNull();
  });

  it("keeps the destructive button off until something is typed", async () => {
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    const btn = await screen.findByTestId("confirm-delete");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId("password"), "hunter2");
    expect(screen.getByTestId("confirm-delete").props.accessibilityState?.disabled).toBe(false);
  });

  it("confirms with the password, then shows the scheduled date before signing out", async () => {
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    fireEvent.changeText(await screen.findByTestId("password"), "hunter2");
    fireEvent.press(screen.getByTestId("confirm-delete"));

    // A visible confirmation, not an instant bounce to the login screen: the
    // user (and the reviewer's recording) must see that it worked and when.
    expect(await screen.findByTestId("done-state")).toBeTruthy();
    expect(mockConfirm).toHaveBeenCalledWith({ password: "hunter2" });
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("done"));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("says the password was wrong and stays on the password step", async () => {
    mockConfirm.mockRejectedValueOnce(new ApiError("Password is incorrect", 403));
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    fireEvent.changeText(await screen.findByTestId("password"), "nope");
    fireEvent.press(screen.getByTestId("confirm-delete"));
    expect(await screen.findByTestId("delete-error")).toHaveTextContent(/password/i);
    expect(screen.getByTestId("password-state")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("account without a password (OAuth sign-up)", () => {
  beforeEach(() => mockMe.mockReturnValue({ data: { has_password: false } }));

  it("still uses the emailed code, since there is no password to ask for", async () => {
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    expect(await screen.findByTestId("code-state")).toBeTruthy();
    expect(mockRequestCode).toHaveBeenCalledTimes(1);
  });

  it("confirms with the code and reaches the same visible confirmation", async () => {
    renderScreen();
    fireEvent.press(await screen.findByTestId("continue"));
    fireEvent.changeText(await screen.findByTestId("code"), "123456");
    fireEvent.press(screen.getByTestId("confirm-delete"));
    expect(await screen.findByTestId("done-state")).toBeTruthy();
    expect(mockConfirm).toHaveBeenCalledWith({ code: "123456" });
  });
});

describe("already scheduled", () => {
  it("opens on the cancel state when the server says a deletion is pending", async () => {
    mockMe.mockReturnValue({ data: { has_password: true } });
    mockPreview.mockResolvedValue({ ...PREVIEW, deletion_scheduled_for: SCHEDULED });
    renderScreen();
    expect(await screen.findByTestId("scheduled-state")).toBeTruthy();
    expect(screen.getByTestId("cancel-deletion")).toBeTruthy();
    expect(screen.queryByTestId("continue")).toBeNull();
  });
});

describe("blocked", () => {
  it("disables Continue while an owned workspace still has other members", async () => {
    mockMe.mockReturnValue({ data: { has_password: true } });
    mockPreview.mockResolvedValue({
      ...PREVIEW,
      blockers: [{ kind: "workspace_has_members", workspace_id: "ws_2", workspace_name: "Acme", member_count: 2 }],
    });
    renderScreen();
    const btn = await screen.findByTestId("continue");
    expect(btn.props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId("blockers")).toHaveTextContent(/Acme/);
  });
});
