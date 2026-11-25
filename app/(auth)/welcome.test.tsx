import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

// Babel's jest-hoist plugin only allows `mock`-prefixed outer-scope variables
// inside a jest.mock() factory; `replace`/`push` below are plain aliases to
// the same jest.fn() instances, used for readability in the assertions.
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace, push: mockPush }) }));
jest.mock("@/onboarding/onboardingState", () => ({ setWelcomeSeen: jest.fn(async () => {}) }));

import { setWelcomeSeen } from "@/onboarding/onboardingState";
import WelcomeScreen from "./welcome";

const replace = mockReplace;
const push = mockPush;

beforeEach(() => jest.clearAllMocks());

describe("WelcomeScreen", () => {
  it("opens on the first slide", () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/Every photo/)).toBeTruthy();
  });

  it("advances through the slides", () => {
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByTestId("welcome-primary"));
    expect(screen.getByText(/every device you own/)).toBeTruthy();
  });

  it("states the Vault primitives, not an adjective", () => {
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByTestId("welcome-primary"));
    fireEvent.press(screen.getByTestId("welcome-primary"));
    expect(screen.getByText("XChaCha20-Poly1305")).toBeTruthy();
  });

  it("never attaches AES-256 to the end-to-end claim", () => {
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByTestId("welcome-primary"));
    fireEvent.press(screen.getByTestId("welcome-primary"));
    expect(screen.queryByText(/AES-256/)).toBeNull();
  });

  it("marks the deck seen and goes to signup from the last slide", async () => {
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByTestId("welcome-primary"));
    fireEvent.press(screen.getByTestId("welcome-primary"));
    fireEvent.press(screen.getByTestId("welcome-primary"));
    await waitFor(() => expect(setWelcomeSeen).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/(auth)/signup");
  });

  it("lets a returning user go straight to sign in", async () => {
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByTestId("welcome-signin"));
    await waitFor(() => expect(setWelcomeSeen).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/(auth)/login");
  });
});
