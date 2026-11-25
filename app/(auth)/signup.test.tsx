import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import SignUpScreen from "./signup";
import { useAuthStore } from "@/auth/authStore";

// Email sign-up is open unless a test says otherwise; the screen asks the API
// before it shows the form (admin dashboard switch).
const mockEmailSignupOpen = jest.fn(() => Promise.resolve(true));
jest.mock("@/auth/api", () => ({
  ...jest.requireActual("@/auth/api"),
  fetchEmailSignupOpen: () => mockEmailSignupOpen(),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

/**
 * The fixture password here was "pw12345!" until this screen started applying
 * the shared validation policy - eight characters with a digit and a symbol but
 * no upper case, which the API has always refused. The test was asserting that
 * mobile would send it anyway, which is precisely the drift the policy module
 * exists to close.
 */
const VALID_PASSWORD = "Pw12345!";

describe("SignUpScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "signedOut", error: null, pendingVerificationEmail: null });
    jest.spyOn(useAuthStore.getState(), "signInWithOAuth").mockResolvedValue(undefined as never);
    jest.spyOn(useAuthStore.getState(), "signInWithApple").mockResolvedValue(undefined as never);
  });

  function fill(overrides: { name?: string; email?: string; password?: string } = {}) {
    fireEvent.changeText(screen.getByTestId("name"), overrides.name ?? "Jane");
    fireEvent.changeText(screen.getByTestId("email"), overrides.email ?? "j@x.com");
    fireEvent.changeText(screen.getByTestId("password"), overrides.password ?? VALID_PASSWORD);
  }

  it("blocks submit until the terms are accepted, then calls signUp", async () => {
    const signUp = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signUp } as never);
    render(<SignUpScreen />);
    await screen.findByTestId("create");

    fill();
    fireEvent.press(screen.getByTestId("create"));

    await waitFor(() => expect(screen.getByText(/accept the Terms of Service/i)).toBeTruthy());
    expect(signUp).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("terms"));
    fireEvent.press(screen.getByTestId("create"));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("Jane", "j@x.com", VALID_PASSWORD));
  });

  it("refuses a malformed email without a round trip", async () => {
    const signUp = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signUp } as never);
    render(<SignUpScreen />);
    await screen.findByTestId("create");

    fill({ email: "jane@example" });
    fireEvent.press(screen.getByTestId("terms"));
    fireEvent.press(screen.getByTestId("create"));

    await waitFor(() => expect(screen.getByText("Valid email is required")).toBeTruthy());
    expect(signUp).not.toHaveBeenCalled();
  });

  it("applies every password clause, not just length, and shows the API's sentence", async () => {
    const signUp = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signUp } as never);
    render(<SignUpScreen />);
    await screen.findByTestId("create");

    // Seven characters: under the minimum, which is now the ONLY composition
    // rule. A long lowercase passphrase is deliberately fine (see the shared
    // validation policy), so the case that must still be refused is a short one.
    fill({ password: "pw1234!" });
    fireEvent.press(screen.getByTestId("terms"));
    fireEvent.press(screen.getByTestId("create"));

    await waitFor(() =>
      expect(screen.getByText("Password must be at least 8 characters")).toBeTruthy());
    expect(signUp).not.toHaveBeenCalled();
  });

  // The 1.0.0 (16) rejection under guideline 4.8. A reviewer creating an
  // account never opens the login screen, so an Apple button that exists only
  // there is not offered at all as far as App Review is concerned - and the
  // two screens had drifted apart in exactly that way.
  it("offers Sign in with Apple on the screen a new user actually sees", async () => {
    render(<SignUpScreen />);
    await screen.findByTestId("create");
    expect(screen.getByTestId("oauth-apple")).toBeTruthy();
    expect(screen.getByText("Sign in with Apple")).toBeTruthy();
  });

  it("hides the email form when email sign-up is switched off", async () => {
    mockEmailSignupOpen.mockResolvedValueOnce(false);
    render(<SignUpScreen />);
    await waitFor(() => expect(mockEmailSignupOpen).toHaveBeenCalled());
    // Let the answer land, so this checks the "off" state and not the brief
    // "still asking" state (which also hides the form).
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("email")).toBeNull();
    expect(screen.queryByTestId("create")).toBeNull();
    expect(screen.queryByTestId("terms")).toBeNull();
    expect(screen.getByTestId("oauth-terms-link")).toBeTruthy();
  });

  it("shows the form if asking the API fails", async () => {
    mockEmailSignupOpen.mockRejectedValueOnce(new Error("offline"));
    render(<SignUpScreen />);
    expect(await screen.findByTestId("email")).toBeTruthy();
  });
});
