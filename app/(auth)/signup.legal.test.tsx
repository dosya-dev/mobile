import { render, screen, fireEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import SignUpScreen from "./signup";
import { useAuthStore } from "@/auth/authStore";

// Must be `mock`-prefixed: jest.mock factories are hoisted above the file and
// may only close over variables whose names start with "mock".
const mockPush = jest.fn();
// Email sign-up is open unless a test says otherwise; the screen asks the API
// before it shows the form (admin dashboard switch).
const mockEmailSignupOpen = jest.fn(() => Promise.resolve(true));
jest.mock("@/auth/api", () => ({
  ...jest.requireActual("@/auth/api"),
  fetchEmailSignupOpen: () => mockEmailSignupOpen(),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

describe("SignUpScreen - legal links", () => {
  beforeEach(() => {
    mockPush.mockClear();
    useAuthStore.setState({ status: "signedOut", error: null, pendingVerificationEmail: null });
    jest.spyOn(useAuthStore.getState(), "signInWithOAuth").mockResolvedValue(undefined as never);
    jest.spyOn(useAuthStore.getState(), "signInWithApple").mockResolvedValue(undefined as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it("opens the Terms inside the app rather than kicking out to a browser", async () => {
    // The app already ships the full text natively (src/legal/content.ts), so
    // punting to the system browser drops the user out of the sign-up flow for
    // no reason - and on iOS, review expects the terms reachable in-app.
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    render(<SignUpScreen />);
    await screen.findByTestId("create");

    // EVERY route to the Terms on this screen, not just the one with a
    // testID - the consent checkbox had its own link that bounced out to
    // dosya.dev while the footer went in-app, so testing one proved nothing
    // about the other.
    for (const link of screen.getAllByText("Terms of Service")) fireEvent.press(link);
    for (const link of screen.getAllByText("Privacy Policy")) fireEvent.press(link);

    expect(openURL).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/terms");
    expect(mockPush).toHaveBeenCalledWith("/privacy");
  });

  it("names the Privacy Policy alongside the Terms in the consent line", async () => {
    render(<SignUpScreen />);
    await screen.findByTestId("create");
    // Both documents must be reachable from the point of collection, not just
    // the Terms.
    expect(screen.getByTestId("terms-link")).toBeTruthy();
    expect(screen.getByTestId("privacy-link")).toBeTruthy();
  });

  it("carries a notice covering the OAuth buttons, not just the checkbox", async () => {
    render(<SignUpScreen />);
    await screen.findByTestId("create");
    // The provider buttons sit above the form and create a real account
    // without touching the consent checkbox. The API stamps those accounts as
    // having accepted, so this notice is what that stamp rests on.
    expect(screen.getByText(/By continuing, you agree to our/i)).toBeTruthy();
  });
});
