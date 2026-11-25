/**
 * Core-screen sweep: the sign-in screens (login, sign up, forgot and reset
 * password, two-factor, verify, welcome, the locked screen) in tr, de, pl and
 * zh-Hans with no leftover English. Mocks follow ../i.test.tsx.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { __resetI18nForTests, t } from "@/lib/i18n";
import type { Locale } from "@/i18n/locales";
import { renderInLocale, collectTexts, leftoverEnglish } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";
import LoginScreen from "../../../../app/(auth)/login";
import SignUpScreen from "../../../../app/(auth)/signup";
import ForgotPasswordScreen from "../../../../app/(auth)/forgot-password";
import ResetPasswordScreen from "../../../../app/(auth)/reset-password";
import TwoFactorScreen from "../../../../app/(auth)/2fa";
import VerifyScreen from "../../../../app/(auth)/verify";
import WelcomeScreen from "../../../../app/(auth)/welcome";
import { AppLockGate } from "@/auth/AppLockGate";
import { useAuthStore } from "@/auth/authStore";
import { ApiError } from "@/api/errors";
import { requestResetCode, submitReset } from "@/auth/passwordReset";

let mockParams: { email?: string } = {};
// Email sign-up is open in these sweeps; the screen asks the API before it
// shows the form (admin dashboard switch, 6baf1e6aa1).
jest.mock("@/auth/api", () => ({
  ...jest.requireActual("@/auth/api"),
  fetchEmailSignupOpen: () => Promise.resolve(true),
}));
jest.mock("expo-router", () => ({
  ...require("../../../../test-utils/i18n-sweep").routerMockWithTitles(),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/auth/lastMethod", () => ({ getLastMethod: jest.fn().mockResolvedValue(null) }));
jest.mock("@/onboarding/onboardingState", () => ({
  setWelcomeSeen: jest.fn(async () => {}),
  writeOnboarding: jest.fn(async () => {}),
}));
jest.mock("@/auth/biometric", () => ({
  getBiometricEnabled: jest.fn(async () => true),
  isBiometricAvailable: jest.fn(async () => true),
  authenticateBiometric: jest.fn(async () => false),
  biometricKind: jest.fn(async () => "face"),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/auth/passwordReset", () => ({
  ...jest.requireActual("@/auth/passwordReset"),
  requestResetCode: jest.fn(),
  submitReset: jest.fn(),
}));
jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/auth/pendingOAuth", () => ({
  savePendingOAuth: jest.fn(async () => {}),
  loadPendingOAuth: jest.fn(async () => ({ nonce: "the-nonce", verifier: "v" })),
  clearPendingOAuth: jest.fn(async () => {}),
}));
jest.mock("@/auth/pkce", () => ({ createPkcePair: jest.fn(async () => ({ nonce: "n", challenge: "c", verifier: "v" })) }));

const SIGNED_OUT = { status: "signedOut", user: null, pending2fa: null, error: null, pendingVerificationEmail: null };
// Sample addresses and technical names the catalog also holds; not sentences.
// "Max Mustermann" is the German Jane Doe placeholder; the matcher reads it as the English "Max {gb}".
const SAMPLE = ["name@example.com", "a@b.com", "000000", "123456", "Max Mustermann"];
const TECH = ["Argon2id", "XChaCha20-Poly1305", "HPKE (X25519)", "1,204 of 12,885", "9%", "macOS", "Windows", "Linux", "iOS", "Android", "S3", "WebDAV", "SFTP", "rclone", "CLI"];

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockParams = { email: "a@b.com" };
  useAuthStore.setState({ ...SIGNED_OUT } as never);
});

async function noEnglish(locale: Locale, ui: ReactElement, allow: string[] = [], ready?: string) {
  const r = await renderInLocale(ui, locale);
  if (ready) await screen.findByTestId(ready);
  expect(r.leftover({ allow: [...SAMPLE, ...allow] })).toEqual([]);
  return r;
}

describe.each(SWEEP_LOCALES)("Sign-in in %s", (locale) => {
  it("login with a server error shown as sent", async () => {
    useAuthStore.setState({ error: "Invalid email or password" } as never);
    await noEnglish(locale, <LoginScreen />, ["Invalid email or password"]);
  });

  it("sign up, including the local validation errors", async () => {
    const r = await noEnglish(locale, <SignUpScreen />, [], "create");
    fireEvent.press(screen.getByTestId("create"));
    expect(r.leftover({ allow: SAMPLE })).toEqual([]);
    fireEvent.press(screen.getByTestId("terms"));
    fireEvent.press(screen.getByTestId("create"));
    expect(r.leftover({ allow: SAMPLE })).toEqual([]);
  });

  it("forgot password, with a failure", async () => {
    (requestResetCode as jest.Mock).mockRejectedValue(new ApiError("Server said no", 500));
    await noEnglish(locale, <ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await screen.findByTestId("forgot-error");
    expect(screen.getByTestId("forgot-error").props.children).toBe("Server said no");
  });

  it("reset password: countdown, resend and a mismatch", async () => {
    jest.useFakeTimers();
    try {
      const r = await noEnglish(locale, <ResetPasswordScreen />);
      expect(screen.getByTestId("resend-countdown")).toBeTruthy();
      fireEvent.changeText(screen.getByTestId("code"), "123456");
      fireEvent.changeText(screen.getByTestId("password"), "newpassword");
      fireEvent.changeText(screen.getByTestId("confirm"), "different");
      act(() => { jest.advanceTimersByTime(31_000); });
      expect(screen.getByTestId("resend")).toBeTruthy();
      expect(r.leftover({ allow: SAMPLE })).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reset password: the sign-in-after-reset failure", async () => {
    jest.useFakeTimers();
    try {
      (submitReset as jest.Mock).mockResolvedValue(undefined);
      useAuthStore.setState({ signIn: jest.fn().mockRejectedValue(new Error("x")) } as never);
      const r = await noEnglish(locale, <ResetPasswordScreen />);
      fireEvent.changeText(screen.getByTestId("code"), "123456");
      fireEvent.changeText(screen.getByTestId("password"), "newpassword");
      fireEvent.changeText(screen.getByTestId("confirm"), "newpassword");
      await act(async () => { fireEvent.press(screen.getByTestId("submit-reset")); });
      await waitFor(() => expect(screen.getByTestId("reset-error")).toBeTruthy());
      expect(r.leftover({ allow: SAMPLE })).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("two-factor: authenticator, recovery and email", async () => {
    useAuthStore.setState({ pending2fa: { method: "totp" } } as never);
    const r = await noEnglish(locale, <TwoFactorScreen />);
    fireEvent.press(screen.getByTestId("toggle-recovery"));
    expect(leftoverEnglish(collectTexts(), locale, { allow: SAMPLE })).toEqual([]);
    r.unmount();
    useAuthStore.setState({ pending2fa: { method: "email" } } as never);
    await noEnglish(locale, <TwoFactorScreen />);
  });

  it("verify, with and without the address", async () => {
    useAuthStore.setState({ pendingVerificationEmail: "a@b.com" } as never);
    const r = await noEnglish(locale, <VerifyScreen />);
    r.unmount();
    useAuthStore.setState({ pendingVerificationEmail: null } as never);
    await noEnglish(locale, <VerifyScreen />);
  });

  it("welcome, every slide", async () => {
    const r = await noEnglish(locale, <WelcomeScreen />, TECH);
    for (let i = 0; i < 2; i++) {
      fireEvent.press(screen.getByTestId("welcome-primary"));
      expect(r.leftover({ allow: [...SAMPLE, ...TECH] })).toEqual([]);
    }
  });

  it("the locked screen", async () => {
    await noEnglish(locale, <AppLockGate><></></AppLockGate>);
    await waitFor(() => expect(screen.getByText(t("sign-in.heading.locked"))).toBeTruthy());
    expect(leftoverEnglish(collectTexts(), locale)).toEqual([]);
  });
});
