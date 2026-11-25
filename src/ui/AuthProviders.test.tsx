import { render, screen, fireEvent } from "@testing-library/react-native";
import { Platform } from "react-native";
import { AuthProviders } from "./AuthProviders";
import { useAuthStore } from "@/auth/authStore";

// The order the buttons are RENDERED in, read off the tree rather than off the
// labels - the labels are Apple's wording and may change, the order is the
// contract.
const renderedOrder = () =>
  screen.getAllByRole("button").map((b) => (b.props as { testID?: string }).testID);

beforeEach(() => {
  jest.spyOn(useAuthStore.getState(), "signInWithOAuth").mockResolvedValue(undefined as never);
  jest.spyOn(useAuthStore.getState(), "signInWithApple").mockResolvedValue(undefined as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = "ios";
});

describe("AuthProviders", () => {
  it("puts Apple first on iOS, then Google", () => {
    Platform.OS = "ios";
    render(<AuthProviders />);
    expect(renderedOrder()).toEqual(["oauth-apple", "oauth-google", "oauth-github"]);
  });

  it("puts Google first on Android, with Apple still offered second", () => {
    Platform.OS = "android";
    render(<AuthProviders />);
    expect(renderedOrder()).toEqual(["oauth-google", "oauth-apple", "oauth-github"]);
  });

  // Guideline 4.8 is a PARITY rule: it is not satisfied by Apple existing
  // somewhere in the app, only by it being offered wherever the other
  // providers are. Both auth screens render this one component for exactly
  // that reason, so this is the assertion that covers both of them.
  it("never offers a third-party provider without Apple beside it", () => {
    for (const os of ["ios", "android"] as const) {
      Platform.OS = os;
      const view = render(<AuthProviders />);
      expect(screen.getByTestId("oauth-apple")).toBeTruthy();
      view.unmount();
    }
  });

  it("takes the native Apple path, not the browser one", () => {
    Platform.OS = "ios";
    const signInWithApple = jest.fn().mockResolvedValue(undefined);
    const signInWithOAuth = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signInWithApple, signInWithOAuth } as never);
    render(<AuthProviders />);
    fireEvent.press(screen.getByTestId("oauth-apple"));
    expect(signInWithApple).toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("marks the last-used provider", () => {
    render(<AuthProviders lastMethod="apple" />);
    expect(screen.getByText("Last used")).toBeTruthy();
  });
});
