import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import LoginScreen from "./login";
import { useAuthStore } from "@/auth/authStore";
import { NativeModules } from "react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/auth/lastMethod", () => ({ getLastMethod: jest.fn().mockResolvedValue(null) }));
jest.mock("react-native-passkey", () => ({ Passkey: { isSupported: () => true } }));

describe("LoginScreen", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, error: null });
    jest.spyOn(useAuthStore.getState(), "signIn").mockResolvedValue(undefined as never);
    jest.spyOn(useAuthStore.getState(), "signInWithOAuth").mockResolvedValue(undefined as never);
    jest.spyOn(useAuthStore.getState(), "signInWithApple").mockResolvedValue(undefined as never);
  });

  it("renders email + password fields and a log-in button", () => {
    render(<LoginScreen />);
    expect(screen.getByTestId("email")).toBeTruthy();
    expect(screen.getByTestId("password")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("renders every OAuth provider, Apple included", () => {
    render(<LoginScreen />);
    expect(screen.getByTestId("oauth-apple")).toBeTruthy();
    expect(screen.getByTestId("oauth-google")).toBeTruthy();
    expect(screen.getByTestId("oauth-github")).toBeTruthy();
  });

  describe("passkey", () => {
    afterEach(() => { delete (NativeModules as Record<string, unknown>).Passkey; });

    it("stays hidden when the device cannot use passkeys", () => {
      render(<LoginScreen />);
      expect(screen.queryByTestId("passkey-signin")).toBeNull();
    });

    it("signs in through the store when offered", async () => {
      (NativeModules as Record<string, unknown>).Passkey = {};
      const signInWithPasskey = jest.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ signInWithPasskey } as never);
      render(<LoginScreen />);
      expect(screen.getByText("Sign in with a passkey")).toBeTruthy();
      fireEvent.press(screen.getByTestId("passkey-signin"));
      await waitFor(() => expect(signInWithPasskey).toHaveBeenCalledTimes(1));
    });
  });

  it("calls signIn with entered credentials", async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signIn } as never);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.changeText(screen.getByTestId("password"), "pw");
    fireEvent.press(screen.getByText("Sign in"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a@b.com", "pw"));
  });

  it("shows the store error", () => {
    useAuthStore.setState({ error: "Invalid email or password" });
    render(<LoginScreen />);
    expect(screen.getByText("Invalid email or password")).toBeTruthy();
  });

  // QA report, low priority: a malformed address got the server's "Email and
  // password are required", which names the wrong problem. The screen now
  // checks the shape itself before calling the API.
  it("refuses a malformed email with a specific message and does not call signIn", async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signIn } as never);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "test");
    fireEvent.changeText(screen.getByTestId("password"), "pw");
    fireEvent.press(screen.getByText("Sign in"));
    expect(await screen.findByText("Valid email is required")).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("clears the local email message once a valid address signs in", async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ signIn } as never);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "test");
    fireEvent.changeText(screen.getByTestId("password"), "pw");
    fireEvent.press(screen.getByText("Sign in"));
    expect(await screen.findByText("Valid email is required")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.press(screen.getByText("Sign in"));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("a@b.com", "pw"));
    expect(screen.queryByText("Valid email is required")).toBeNull();
  });
});
