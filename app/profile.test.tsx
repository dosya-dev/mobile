import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import ProfileScreen from "./profile";
import { useMe } from "@/profile/hooks";
import * as api from "@/profile/api";
import { useFamily } from "@/family/hooks";

jest.mock("@/profile/hooks", () => ({ useMe: jest.fn(), ME_KEY: ["me"] }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock("@/family/hooks", () => ({ useFamily: jest.fn(), FAMILY_KEY: ["family"] }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockUseMe = useMe as jest.Mock;
const mockUseFamily = useFamily as jest.Mock;
const mockPush = jest.fn();

const ME = {
  id: "u1", email: "a@b.com", name: "Jane Doe", initials: "JD", avatar_url: null,
  preferred_language: "en", ui_theme: "default", ui_mode: "system",
  created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
};

beforeEach(() => {
  mockPush.mockReset();
  mockUseFamily.mockReset();
  mockUseFamily.mockReturnValue({ data: undefined });
  mockUseMe.mockReset();
  mockUseMe.mockReturnValue({ data: ME, isLoading: false, isError: false, refetch: jest.fn() });
});

it("renders the hero with name, email and member-since", () => {
  render(<ProfileScreen />);
  expect(screen.getByText("Jane Doe")).toBeTruthy();
  expect(screen.getByText("a@b.com")).toBeTruthy();
  expect(screen.getByText(/Member since .* · 2 workspaces/)).toBeTruthy();
  expect(screen.getByText("Verified")).toBeTruthy();
  expect(screen.getByTestId("nav-report-problem")).toBeTruthy();
});

it("saves the name", async () => {
  const updateName = jest.spyOn(api, "updateName").mockResolvedValue("Jane X");
  render(<ProfileScreen />);
  fireEvent.changeText(screen.getByTestId("profile-name"), "Jane X");
  fireEvent.press(screen.getByTestId("save-name"));
  await waitFor(() => expect(updateName).toHaveBeenCalledWith("Jane X"));
});

it("asks for the password then shows the code input once a change is pending", async () => {
  jest.spyOn(api, "requestEmailChange").mockResolvedValue({ kind: "pending", newEmail: "new@x.com" });
  render(<ProfileScreen />);

  // The Change action only appears once the address actually differs.
  expect(screen.queryByTestId("change-email")).toBeNull();
  fireEvent.changeText(screen.getByTestId("profile-email"), "new@x.com");
  fireEvent.press(screen.getByTestId("change-email"));

  // Password prompt → submitting it starts the change.
  fireEvent.changeText(screen.getByTestId("prompt-input"), "pw");
  fireEvent.press(screen.getByText("Continue"));

  await waitFor(() => expect(screen.getByTestId("email-code")).toBeTruthy());
});

it("does not show a code input when the email is unchanged (server no-op)", async () => {
  jest.spyOn(api, "requestEmailChange").mockResolvedValue({ kind: "unchanged", email: "a@b.com" });
  render(<ProfileScreen />);
  fireEvent.changeText(screen.getByTestId("profile-email"), "A@B.com ");
  // Case/whitespace-only difference is not dirty, so no Change button appears.
  expect(screen.queryByTestId("change-email")).toBeNull();
});

it("shows a retry when the profile fails to load", () => {
  mockUseMe.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() });
  render(<ProfileScreen />);
  expect(screen.getByText("Couldn't load your profile.")).toBeTruthy();
});

const POOL = { used_bytes: 1, limit_bytes: 2, used_label: "1 GB", limit_label: "2 GB" };

it("offers no Family plan row to a free user with no family", () => {
  mockUseFamily.mockReturnValue({ data: { ok: true, role: "none", limit: 5, eligible: false, ineligible_reason: "free_plan", pool: POOL, plan: { id: "free", name: "Free" }, payer: null, members: [] } });
  render(<ProfileScreen />);
  expect(screen.queryByTestId("nav-family")).toBeNull();
});

it("offers the Family plan row to a member and opens the screen", () => {
  mockUseFamily.mockReturnValue({ data: { ok: true, role: "member", limit: 5, eligible: false, ineligible_reason: "is_member", pool: POOL, plan: { id: "pro", name: "Pro" }, payer: { name: "A" }, members: null } });
  render(<ProfileScreen />);
  fireEvent.press(screen.getByTestId("nav-family"));
  expect(mockPush).toHaveBeenCalledWith("/family");
});

it("hides the row while the family request has not answered", () => {
  mockUseFamily.mockReturnValue({ data: undefined });
  render(<ProfileScreen />);
  expect(screen.queryByTestId("nav-family")).toBeNull();
});
