/**
 * The screen that exists purely so `dosya://auth/callback?code=…` stops
 * rendering "Unmatched Route". See app/auth/callback.tsx for why the directory
 * is `auth/` and not `(auth)/`.
 */
import { render, screen, waitFor } from "@testing-library/react-native";
import OAuthCallback from "./callback";
import { useAuthStore } from "@/auth/authStore";

// `mock`-prefixed: jest.mock factories may not close over other out-of-scope vars.
const mockReplace = jest.fn();
let mockParams: { code?: string; state?: string } = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

describe("OAuthCallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, error: null });
    jest.spyOn(useAuthStore.getState(), "completeOAuthCode").mockResolvedValue(undefined as never);
  });

  it("exchanges the code carried by the deep link", async () => {
    mockParams = { code: "dmoc_from_deeplink" };
    render(<OAuthCallback />);
    await waitFor(() =>
      expect(useAuthStore.getState().completeOAuthCode).toHaveBeenCalledWith("dmoc_from_deeplink", null),
    );
  });

  // This route is the path an injected deep link takes, so the echoed nonce has
  // to reach the store - dropping it here would disarm the check entirely.
  it("forwards the echoed state alongside the code", async () => {
    mockParams = { code: "dmoc_bound", state: "nonce123456" };
    render(<OAuthCallback />);
    await waitFor(() =>
      expect(useAuthStore.getState().completeOAuthCode).toHaveBeenCalledWith("dmoc_bound", "nonce123456"),
    );
  });

  it("shows progress while the exchange is in flight", () => {
    mockParams = { code: "dmoc_x" };
    render(<OAuthCallback />);
    expect(screen.getByText("Finishing sign in…")).toBeTruthy();
  });

  it("exchanges only once even if React re-renders the screen", async () => {
    mockParams = { code: "dmoc_once" };
    const { rerender } = render(<OAuthCallback />);
    rerender(<OAuthCallback />);
    await waitFor(() =>
      expect(useAuthStore.getState().completeOAuthCode).toHaveBeenCalledTimes(1),
    );
  });

  it("falls back to login when the link carries no code", async () => {
    mockParams = {};
    render(<OAuthCallback />);
    expect(useAuthStore.getState().completeOAuthCode).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Sign-in link was incomplete/)).toBeTruthy());
  });

  it("leaves for the tabs once the exchange signs the user in", async () => {
    mockParams = { code: "dmoc_ok" };
    render(<OAuthCallback />);
    useAuthStore.setState({ status: "signedIn" });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
  });

  it("surfaces an exchange error instead of hanging on the spinner", async () => {
    mockParams = { code: "dmoc_bad" };
    useAuthStore.setState({ error: "That sign-in link expired." });
    render(<OAuthCallback />);
    await waitFor(() => expect(screen.getByText("That sign-in link expired.")).toBeTruthy());
  });
});
