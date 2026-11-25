import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SessionsScreen from "./sessions";
import { useSessions } from "@/profile/hooks";
import * as api from "@/profile/api";

jest.mock("@/profile/hooks", () => ({ useSessions: jest.fn(), SESSIONS_KEY: ["sessions"] }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockSessions = useSessions as jest.Mock;

const DATA = [
  { id: "sess_1", device: "Mac", kind: "desktop", browser: "Chrome", meta: "Chrome · 2d ago", is_current: false, created_at: 2 },
  { id: "mtk_1", device: "iPhone", kind: "mobile", browser: "dosya.dev app", meta: "dosya.dev app · active now", is_current: true, created_at: 1 },
];

beforeEach(() => {
  mockSessions.mockReset();
  mockSessions.mockReturnValue({ data: DATA, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });
});

it("lists browser sessions AND the mobile app device", () => {
  render(<SessionsScreen />);
  expect(screen.getByText("Mac")).toBeTruthy();
  // The whole point of D: the phone you're holding used to be missing entirely.
  expect(screen.getByText("iPhone")).toBeTruthy();
});

it("marks the caller's own device and offers no revoke for it", () => {
  render(<SessionsScreen />);
  expect(screen.getByText("This device")).toBeTruthy();
  expect(screen.queryByTestId("revoke-mtk_1")).toBeNull();
  expect(screen.getByTestId("revoke-sess_1")).toBeTruthy();
});

it("revokes a single device", async () => {
  const revoke = jest.spyOn(api, "revokeSession").mockResolvedValue(undefined);
  render(<SessionsScreen />);
  fireEvent.press(screen.getByTestId("revoke-sess_1"));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("sess_1"));
});

it("revokes all others after confirming", async () => {
  const revokeAll = jest.spyOn(api, "revokeAllOtherSessions").mockResolvedValue(undefined);
  render(<SessionsScreen />);
  fireEvent.press(screen.getByTestId("revoke-all"));
  fireEvent.press(screen.getByText("Sign out"));
  await waitFor(() => expect(revokeAll).toHaveBeenCalled());
});

it("hides revoke-all when this is the only device", () => {
  mockSessions.mockReturnValue({
    data: [DATA[1]], isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false,
  });
  render(<SessionsScreen />);
  expect(screen.queryByTestId("revoke-all")).toBeNull();
});
