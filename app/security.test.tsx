import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SecurityScreen from "./security";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { use2faStatus, useMe } from "@/profile/hooks";
import * as api from "@/profile/api";

jest.mock("@/profile/PasskeysSection", () => ({ PasskeysSection: () => null }));
jest.mock("@/profile/hooks", () => ({ use2faStatus: jest.fn(), useMe: jest.fn(), TWO_FA_KEY: ["2fa-status"] }));
jest.mock("@/auth/biometric", () => ({
  isBiometricAvailable: jest.fn(async () => true),
  getBiometricEnabled: jest.fn(async () => false),
  setBiometricEnabled: jest.fn(async () => {}),
  authenticateBiometric: jest.fn(async () => true),
}));
jest.mock("@/auth/appLock", () => ({
  ...jest.requireActual("@/auth/appLock"),
  hasPin: jest.fn(async () => false),
  getLockAfter: jest.fn(async () => 60),
  setLockAfter: jest.fn(async () => {}),
  setBiometricUnlock: jest.fn(async () => {}),
  clearAppLock: jest.fn(async () => {}),
}));
jest.mock("@/auth/PinScreens", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    PinSetup: (p: { onDone: () => void }) => <Pressable testID="mock-pin-setup" onPress={p.onDone}><Text>setup</Text></Pressable>,
    PinCheck: (p: { onSuccess: () => void }) => <Pressable testID="mock-pin-check" onPress={p.onSuccess}><Text>check</Text></Pressable>,
  };
});
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockStatus = use2faStatus as jest.Mock;
const mockMe = useMe as jest.Mock;
const off = { method: null, totp_enabled: false, recovery_codes_remaining: 0 };

beforeEach(() => {
  mockStatus.mockReset();
  mockMe.mockReset();
  mockStatus.mockReturnValue({ data: off, isLoading: false, isError: false, refetch: jest.fn() });
  mockMe.mockReturnValue({ data: { has_password: true } });
});

it("states the password rules the server actually enforces (length only, 8 to 256)", () => {
  // The rule is length-only now: composition mandates were dropped so a
  // passphrase is accepted, and a screen still promising "a special character"
  // would refuse in copy what the server accepts.
  render(<SecurityScreen />);
  expect(screen.getByText(/8 and 256 characters/i)).toBeTruthy();
  expect(screen.queryByText(/special character/i)).toBeNull();
});

it("rejects mismatched new passwords before calling the API", async () => {
  const changePassword = jest.spyOn(api, "changePassword").mockResolvedValue(undefined);
  render(<SecurityScreen />);
  fireEvent.changeText(screen.getByTestId("pw-current"), "old");
  fireEvent.changeText(screen.getByTestId("pw-new"), "NewPass1!");
  fireEvent.changeText(screen.getByTestId("pw-confirm"), "Different1!");
  fireEvent.press(screen.getByTestId("pw-save"));
  await waitFor(() => expect(changePassword).not.toHaveBeenCalled());
});

it("changes the password", async () => {
  const changePassword = jest.spyOn(api, "changePassword").mockResolvedValue(undefined);
  render(<SecurityScreen />);
  fireEvent.changeText(screen.getByTestId("pw-current"), "old");
  fireEvent.changeText(screen.getByTestId("pw-new"), "NewPass1!");
  fireEvent.changeText(screen.getByTestId("pw-confirm"), "NewPass1!");
  fireEvent.press(screen.getByTestId("pw-save"));
  await waitFor(() => expect(changePassword).toHaveBeenCalledWith("old", "NewPass1!"));
});

it("offers both 2FA methods when 2FA is off", () => {
  render(<SecurityScreen />);
  expect(screen.getByTestId("tfa-totp")).toBeTruthy();
  expect(screen.getByTestId("tfa-email")).toBeTruthy();
  expect(screen.queryByTestId("tfa-disable")).toBeNull();
});

it("shows the QR + secret after starting TOTP setup, then recovery codes after verifying", async () => {
  jest.spyOn(api, "setupTotp").mockResolvedValue({ secret: "ABC123", uri: "otpauth://totp/x" });
  jest.spyOn(api, "verifyTotp").mockResolvedValue(["AAAA-BBBB", "CCCC-DDDD"]);
  render(<SecurityScreen />);

  fireEvent.press(screen.getByTestId("tfa-totp"));
  await waitFor(() => expect(screen.getByTestId("totp-qr")).toBeTruthy());
  expect(screen.getByText("ABC123")).toBeTruthy();

  fireEvent.changeText(screen.getByTestId("totp-code"), "123456");
  fireEvent.press(screen.getByTestId("totp-verify"));
  await waitFor(() => expect(screen.getByTestId("recovery-codes")).toBeTruthy());
  expect(screen.getByText("AAAA-BBBB")).toBeTruthy();
});

it("shows disable + recovery-code count when TOTP is on", () => {
  mockStatus.mockReturnValue({
    data: { method: "totp", totp_enabled: true, recovery_codes_remaining: 7 },
    isLoading: false, isError: false, refetch: jest.fn(),
  });
  render(<SecurityScreen />);
  expect(screen.getByTestId("tfa-disable")).toBeTruthy();
  expect(screen.getByText("7 of 10 codes remaining")).toBeTruthy();
  expect(screen.getByText("Authenticator")).toBeTruthy();
});

it("does not offer recovery codes for email 2FA", () => {
  mockStatus.mockReturnValue({
    data: { method: "email", totp_enabled: false, recovery_codes_remaining: 0 },
    isLoading: false, isError: false, refetch: jest.fn(),
  });
  render(<SecurityScreen />);
  expect(screen.getByText("Email")).toBeTruthy();
  expect(screen.queryByTestId("tfa-regen")).toBeNull();
});

describe("accounts with no password (OAuth signup)", () => {
  beforeEach(() => mockMe.mockReturnValue({ data: { has_password: false } }));

  it("explains there is no password instead of showing a form that can never work", () => {
    render(<SecurityScreen />);
    expect(screen.getByTestId("no-password")).toBeTruthy();
    expect(screen.queryByTestId("pw-save")).toBeNull();
  });

  it("blocks 2FA enrolment - enabling needs no password but disabling does", () => {
    render(<SecurityScreen />);
    expect(screen.getByTestId("tfa-needs-password")).toBeTruthy();
    expect(screen.queryByTestId("tfa-totp")).toBeNull();
    expect(screen.queryByTestId("tfa-email")).toBeNull();
  });

  it("warns when already locked in (2FA on, no password)", () => {
    mockStatus.mockReturnValue({
      data: { method: "totp", totp_enabled: true, recovery_codes_remaining: 10 },
      isLoading: false, isError: false, refetch: jest.fn(),
    });
    render(<SecurityScreen />);
    expect(screen.getByTestId("tfa-locked")).toBeTruthy();
  });
});

it("assumes a password exists while /api/me is still loading (don't hide a working action)", () => {
  mockMe.mockReturnValue({ data: undefined });
  render(<SecurityScreen />);
  expect(screen.getByTestId("pw-save")).toBeTruthy();
});

it("disables 2FA after a password prompt", async () => {
  mockStatus.mockReturnValue({
    data: { method: "totp", totp_enabled: true, recovery_codes_remaining: 10 },
    isLoading: false, isError: false, refetch: jest.fn(),
  });
  const disable = jest.spyOn(api, "disable2fa").mockResolvedValue(undefined);
  render(<SecurityScreen />);
  fireEvent.press(screen.getByTestId("tfa-disable"));
  fireEvent.changeText(screen.getByTestId("prompt-input"), "pw");
  fireEvent.press(screen.getByText("Continue"));
  await waitFor(() => expect(disable).toHaveBeenCalledWith("pw"));
});

describe("App lock", () => {
  const lock = () => jest.requireMock("@/auth/appLock");
  const bio = () => jest.requireMock("@/auth/biometric");
  beforeEach(() => {
    jest.clearAllMocks();
    lock().hasPin.mockResolvedValue(false);
    bio().isBiometricAvailable.mockResolvedValue(true);
    bio().authenticateBiometric.mockResolvedValue(true);
  });

  it("shows the PIN switch even on a phone without biometrics", async () => {
    bio().isBiometricAvailable.mockResolvedValue(false);
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByText("Require a PIN")).toBeTruthy());
    expect(screen.queryByTestId("bio-toggle")).toBeNull();
  });

  it("hides biometrics, timer and Change PIN until a PIN is set", async () => {
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByTestId("pin-toggle")).toBeTruthy());
    expect(screen.queryByTestId("bio-toggle")).toBeNull();
    expect(screen.queryByTestId("lock-after")).toBeNull();
    expect(screen.queryByTestId("change-pin")).toBeNull();
  });

  it("turning the switch on opens PIN setup", async () => {
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByTestId("pin-toggle")).toBeTruthy());
    fireEvent(screen.getByTestId("pin-toggle"), "valueChange", true);
    expect(screen.getByTestId("mock-pin-setup")).toBeTruthy();
  });

  it("turning it off asks for the current PIN, then clears the lock", async () => {
    lock().hasPin.mockResolvedValue(true);
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByTestId("pin-toggle").props.value).toBe(true));
    fireEvent(screen.getByTestId("pin-toggle"), "valueChange", false);
    fireEvent.press(screen.getByTestId("mock-pin-check"));
    await waitFor(() => expect(lock().clearAppLock).toHaveBeenCalled());
  });

  it("Change PIN checks the current PIN before asking for a new one", async () => {
    lock().hasPin.mockResolvedValue(true);
    render(<SecurityScreen />);
    fireEvent.press(await screen.findByTestId("change-pin"));
    fireEvent.press(screen.getByTestId("mock-pin-check"));
    expect(screen.getByTestId("mock-pin-setup")).toBeTruthy();
    expect(lock().clearAppLock).not.toHaveBeenCalled();
  });

  it("shows the Lock after value and saves a new choice", async () => {
    lock().hasPin.mockResolvedValue(true);
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByText("1 minute")).toBeTruthy());
    fireEvent.press(screen.getByTestId("lock-after"));
    fireEvent.press(screen.getByText("15 minutes"));
    finishSheetDismissal();
    await waitFor(() => expect(lock().setLockAfter).toHaveBeenCalledWith(900));
  });

  it("turns biometric unlock on only after a passed scan", async () => {
    lock().hasPin.mockResolvedValue(true);
    render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByTestId("bio-toggle")).toBeTruthy());
    bio().authenticateBiometric.mockResolvedValueOnce(false);
    fireEvent(screen.getByTestId("bio-toggle"), "valueChange", true);
    await waitFor(() => expect(bio().authenticateBiometric).toHaveBeenCalledWith({ pinFallback: true }));
    expect(lock().setBiometricUnlock).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId("bio-toggle"), "valueChange", true);
    await waitFor(() => expect(lock().setBiometricUnlock).toHaveBeenCalledWith(true));
  });
});
