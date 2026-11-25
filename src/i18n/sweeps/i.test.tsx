/**
 * Unit I (sign-in, auth and onboarding) in the chosen language.
 *
 * Every owned screen is rendered in Turkish and must show no leftover English,
 * switches language while mounted, and keeps its English text as it was except
 * for the approved rewordings. The unit wires no plural and no Alert.alert.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking, Platform } from "react-native";
import { makeT } from "@/i18n/translator";
import { LOCALES } from "@/i18n/locales";
import en from "@/i18n/messages/en.json";
import { __resetI18nForTests, loadMessages, useLocale, t as moduleT } from "@/lib/i18n";
import { renderInLocale, collectTexts, leftoverEnglish } from "../../../test-utils/i18n-sweep";

import LoginScreen from "../../../app/(auth)/login";
import SignUpScreen from "../../../app/(auth)/signup";
import ForgotPasswordScreen from "../../../app/(auth)/forgot-password";
import ResetPasswordScreen from "../../../app/(auth)/reset-password";
import TwoFactorScreen from "../../../app/(auth)/2fa";
import VerifyScreen from "../../../app/(auth)/verify";
import WelcomeScreen from "../../../app/(auth)/welcome";
import OAuthCallback from "../../../app/auth/callback";
import { AppLockGate } from "@/auth/AppLockGate";
import { classifyResetError } from "@/auth/passwordReset";
import { runOAuthBrowserFlow } from "@/auth/oauth";
import { formatEstimate } from "@/onboarding/librarySize";
import { formatBytes } from "@/lib/format";
import { StepScreen, StepProgressProvider } from "@/onboarding/ui/StepScreen";
import { WorkspaceStep, defaultWorkspaceName } from "@/onboarding/steps/WorkspaceStep";
import { PhotoAccessStep } from "@/onboarding/steps/PhotoAccessStep";
import { PermissionDeniedStep } from "@/onboarding/steps/PermissionDeniedStep";
import { ChooseStep } from "@/onboarding/steps/ChooseStep";
import { FirstBackupStep } from "@/onboarding/steps/FirstBackupStep";
import { OnboardingFlow } from "@/onboarding/OnboardingFlow";
import { useAuthStore } from "@/auth/authStore";
import { useUploadStore } from "@/upload/store";
import { useBackupRun } from "@/backup/runState";
import { ApiError } from "@/api/errors";

let mockParams: { email?: string } = {};
// Email sign-up is open in these sweeps; the screen asks the API before it
// shows the form (admin dashboard switch, 6baf1e6aa1).
jest.mock("@/auth/api", () => ({
  ...jest.requireActual("@/auth/api"),
  fetchEmailSignupOpen: () => Promise.resolve(true),
}));
jest.mock("expo-router", () => ({
  ...require("../../../test-utils/i18n-sweep").routerMockWithTitles(),
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

let mockSettings: Record<string, unknown> = {};
const mockUpdate = jest.fn(async (patch: Record<string, unknown>) => {
  mockSettings = { ...mockSettings, ...patch };
});
jest.mock("@/backup/settings", () => ({
  useBackupSettings: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ settings: mockSettings }),
    { getState: () => ({ update: mockUpdate, updateFilters: jest.fn(async () => {}) }) },
  ),
  DEFAULT_BACKUP_SETTINGS: jest.requireActual("@/backup/settings").DEFAULT_BACKUP_SETTINGS,
}));
jest.mock("@/backup/orchestrator", () => ({ runBackup: jest.fn(async () => ({})), clearManualStop: jest.fn() }));
jest.mock("@/backup/albumDefaults", () => ({ ensureAlbumDefaults: jest.fn(async () => {}) }));
jest.mock("../../onboarding/librarySize", () => ({
  ...jest.requireActual("../../onboarding/librarySize"),
  estimateLibrary: jest.fn(),
}));
jest.mock("../../onboarding/permissions", () => ({ requestPhotoAccess: jest.fn(async () => "denied") }));
let mockWorkspaces: { id: string; name: string }[] | undefined = [];
let mockIsError = false;
jest.mock("@/files/hooks", () => ({
  useWorkspaceStorage: jest.fn(),
  useWorkspaces: () => ({ data: mockWorkspaces, isLoading: false, isError: mockIsError, refetch: jest.fn() }),
}));
jest.mock("@/files/api", () => ({ createWorkspace: jest.fn(), getRegions: jest.fn() }));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ activeId: "ws1" }),
    { getState: () => ({ setActive: jest.fn(async () => {}) }) },
  ),
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn(async () => {}) }),
}));

import { estimateLibrary } from "@/onboarding/librarySize";
import { useWorkspaceStorage } from "@/files/hooks";
import { createWorkspace, getRegions } from "@/files/api";
import { toast } from "@/ui/toast";
import { requestResetCode, submitReset } from "@/auth/passwordReset";
import * as WebBrowser from "expo-web-browser";

const mockToast = toast as jest.Mock;

// Text owned by src/ui (unit K) and still English until that unit lands: the
// provider buttons and divider, the "Last used" badge, the password eye button
// and the gate's retry text. "name@example.com" is catalogued but is a sample
// address, not a sentence.
const UNIT_K = [
  "Continue with Google", "Continue with GitHub", "Continue with Apple", "Sign in with Apple",
  "or", "OR", "Last used", "Retry",
];

const SIGNED_OUT = { status: "signedOut", user: null, pending2fa: null, error: null, pendingVerificationEmail: null };

beforeEach(() => {
  __resetI18nForTests();
  jest.clearAllMocks();
  mockParams = { email: "a@b.com" };
  mockSettings = { autoBackup: true };
  mockWorkspaces = [{ id: "ws1", name: "Firat's Files" }];
  mockIsError = false;
  useAuthStore.setState({ ...SIGNED_OUT } as never);
  useUploadStore.setState({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } });
  useBackupRun.setState({ phase: "idle", workspaceName: null, workspaceId: null, startedAt: null });
  (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { total: 5 * 1_073_741_824 } });
  (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 1234, videos: 56, estimatedBytes: 61_200_000_000 });
  (getRegions as jest.Mock).mockResolvedValue({
    regions: [{ code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" }],
    suggested: "eu-west-1",
  });
  (createWorkspace as jest.Mock).mockResolvedValue({ id: "ws1", name: "x" });
});

async function noEnglish(ui: React.ReactElement, allow: string[] = [], ready?: string) {
  const r = await renderInLocale(ui, "tr");
  if (ready) await screen.findByTestId(ready);
  expect(r.leftover({ allow: [...UNIT_K, ...allow] })).toEqual([]);
  return r;
}

describe("sign-in screens", () => {
  it("login", async () => {
    useAuthStore.setState({ error: "Invalid email or password" } as never);
    await noEnglish(<LoginScreen />, ["Invalid email or password", "name@example.com"]);
  });

  it("signup, including the local validation errors", async () => {
    const r = await noEnglish(<SignUpScreen />, ["name@example.com"], "create");
    fireEvent.press(screen.getByTestId("create"));
    expect(r.leftover({ allow: [...UNIT_K, "name@example.com"] })).toEqual([]);
    expect(collectTexts()).toContain(moduleT("sign-up.description.pleaseAcceptTheTermsOfServiceToContinue"));
    fireEvent.press(screen.getByTestId("terms"));
    fireEvent.press(screen.getByTestId("create"));
    expect(collectTexts()).toContain(moduleT("common.error.nameIsRequired"));
    expect(r.leftover({ allow: [...UNIT_K, "name@example.com"] })).toEqual([]);
  });

  it("forgot password, with a failure", async () => {
    (requestResetCode as jest.Mock).mockRejectedValue(new ApiError("Server said no", 500));
    await noEnglish(<ForgotPasswordScreen />, ["name@example.com"]);
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await screen.findByTestId("forgot-error");
    expect(screen.getByTestId("forgot-error").props.children).toBe("Server said no");
  });

  it("reset password, countdown, resend, mismatch and the sent-to line", async () => {
    jest.useFakeTimers();
    try {
      const r = await noEnglish(<ResetPasswordScreen />, ["a@b.com", "000000"]);
      expect(screen.getByTestId("resend-countdown")).toBeTruthy();
      fireEvent.changeText(screen.getByTestId("code"), "123456");
      fireEvent.changeText(screen.getByTestId("password"), "newpassword");
      fireEvent.changeText(screen.getByTestId("confirm"), "different");
      expect(screen.getByTestId("submit-reset").props.accessibilityState?.disabled).toBeTruthy();
      act(() => { jest.advanceTimersByTime(31_000); });
      expect(screen.getByTestId("resend")).toBeTruthy();
      expect(r.leftover({ allow: [...UNIT_K, "a@b.com", "000000"] })).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reset password, no email in the link", async () => {
    mockParams = {};
    await noEnglish(<ResetPasswordScreen />, ["000000"]);
  });

  it("reset password, the sign-in-after-reset failure message", async () => {
    jest.useFakeTimers();
    try {
      (submitReset as jest.Mock).mockResolvedValue(undefined);
      useAuthStore.setState({ signIn: jest.fn().mockRejectedValue(new Error("x")) } as never);
      const r = await noEnglish(<ResetPasswordScreen />, ["a@b.com", "000000"]);
      fireEvent.changeText(screen.getByTestId("code"), "123456");
      fireEvent.changeText(screen.getByTestId("password"), "newpassword");
      fireEvent.changeText(screen.getByTestId("confirm"), "newpassword");
      await act(async () => { fireEvent.press(screen.getByTestId("submit-reset")); });
      await waitFor(() => expect(screen.getByTestId("reset-error")).toBeTruthy());
      expect(collectTexts()).toContain(moduleT("reset-password.error.passwordUpdatedPleaseLogInWithYourNewPassword"));
      expect(r.leftover({ allow: [...UNIT_K, "a@b.com", "000000"] })).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("two-factor, authenticator, email and recovery", async () => {
    useAuthStore.setState({ pending2fa: { method: "totp" } } as never);
    await noEnglish(<TwoFactorScreen />);
    fireEvent.press(screen.getByTestId("toggle-recovery"));
    expect(leftoverEnglish(collectTexts(), "tr", { allow: UNIT_K })).toEqual([]);
    useAuthStore.setState({ pending2fa: { method: "email" } } as never);
    await noEnglish(<TwoFactorScreen />);
  });

  it("verify, with and without the address", async () => {
    useAuthStore.setState({ pendingVerificationEmail: "a@b.com" } as never);
    await noEnglish(<VerifyScreen />, ["a@b.com", "123456"]);
    useAuthStore.setState({ pendingVerificationEmail: null } as never);
    await noEnglish(<VerifyScreen />, ["123456"]);
  });

  it("welcome, every slide, the progress label and the sign-in label", async () => {
    const r = await noEnglish(<WelcomeScreen />, ["Argon2id", "XChaCha20-Poly1305", "HPKE (X25519)", "1,204 of 12,885", "9%", "macOS", "Windows", "Linux", "iOS", "Android", "S3", "WebDAV", "SFTP", "rclone", "CLI"]);
    const tr = makeT("tr", await loadMessages("tr"), en);
    expect(screen.getByLabelText(tr("welcome.label.slideIndexOfTotal", { index: 1, total: 3 }))).toBeTruthy();
    expect(screen.getByLabelText(tr("common.action.signIn"))).toBeTruthy();
    for (let i = 0; i < 2; i++) {
      fireEvent.press(screen.getByTestId("welcome-primary"));
      expect(r.leftover({ allow: ["Argon2id", "XChaCha20-Poly1305", "HPKE (X25519)", "1,204 of 12,885", "9%", "macOS", "Windows", "Linux", "iOS", "Android", "S3", "WebDAV", "SFTP", "rclone", "CLI", ...UNIT_K] })).toEqual([]);
    }
    expect(screen.getByLabelText(tr("welcome.label.slideIndexOfTotal", { index: 3, total: 3 }))).toBeTruthy();
    expect(collectTexts()).toContain(tr("welcome.action.createAFreeAccount"));
  });

  it("the OAuth callback in all three states", async () => {
    mockParams = {};
    useAuthStore.setState({ ...SIGNED_OUT } as never);
    const tr = makeT("tr", await loadMessages("tr"), en);
    // no code: incomplete link
    const completeSpy = jest.spyOn(useAuthStore.getState(), "completeOAuthCode").mockResolvedValue(undefined as never);
    const first = await noEnglish(<OAuthCallback />);
    await waitFor(() => expect(collectTexts()).toContain(tr("sign-in.label.signInLinkWasIncompleteReturningToSignIn")));
    first.unmount();
    // with a code: finishing
    mockParams = { code: "abc" } as never;
    await noEnglish(<OAuthCallback />);
    expect(collectTexts()).toContain(tr("sign-in.label.finishingSignIn"));
    completeSpy.mockRestore();
  });

  it("the locked screen", async () => {
    await noEnglish(<AppLockGate><></></AppLockGate>);
    await waitFor(() => expect(screen.getByText(moduleT("sign-in.heading.locked"))).toBeTruthy());
    expect(leftoverEnglish(collectTexts(), "tr")).toEqual([]);
    expect(screen.getByText(moduleT("common.action.unlock"))).toBeTruthy();
  });
});

describe("terms and privacy sentences", () => {
  it("keep both links tappable in every shipped language, in the language's own word order", async () => {
    for (const locale of LOCALES) {
      __resetI18nForTests();
      const m = makeT(locale, await loadMessages(locale), en);
      const login = await renderInLocale(<LoginScreen />, locale);
      for (const id of ["terms-link", "privacy-link"]) expect(screen.getByTestId(id)).toBeTruthy();
      // The sentence is read as one paragraph: its words are all there.
      expect(screen.getByText(m("common.description.byContinuingYouAgreeToOurLink1AndLink2", { link1: m("legal.heading.termsOfService"), link2: m("legal.heading.privacyPolicy") }), { exact: false })).toBeTruthy();
      login.unmount();
      const signup = await renderInLocale(<SignUpScreen />, locale);
      await screen.findByTestId("create");
      for (const id of ["terms-link", "privacy-link", "oauth-terms-link", "oauth-privacy-link"]) {
        expect(screen.getByTestId(id)).toBeTruthy();
      }
      expect(screen.getByText(m("sign-up.label.iAgreeToTheLink1AndAcknowledgeTheLink2", { link1: m("legal.heading.termsOfService"), link2: m("legal.heading.privacyPolicy") }), { exact: false })).toBeTruthy();
      signup.unmount();
    }
  });

  it("opens the documents from the links", async () => {
    const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
    await renderInLocale(<LoginScreen />, "tr");
    fireEvent.press(screen.getByTestId("terms-link"));
    fireEvent.press(screen.getByTestId("privacy-link"));
    expect(router.push).toHaveBeenCalledWith("/terms");
    expect(router.push).toHaveBeenCalledWith("/privacy");
  });
});

describe("auth messages from code outside React", () => {
  it("the reset failures, the OAuth failures and the unlock prompt come out in the chosen language", async () => {
    await renderInLocale(<></>, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    expect(classifyResetError(new ApiError("Please request a new code", 429)).message).toBe(tr("common.error.tooManyTriesOnThatCodeTapResendToGetANewOne"));
    expect(classifyResetError(new ApiError("slow down", 429)).message).toBe(tr("common.error.tooManyAttemptsWaitAFewMinutesThenTry"));
    expect(classifyResetError(new ApiError("bad", 400)).message).toBe(tr("common.error.thatCodeIsNotRightOrItHasExpiredCheckThe6DigitsOr"));
    expect(classifyResetError(new ApiError("", 500)).message).toBe(tr("common.error.couldNotResetYourPasswordPleaseTryAgain"));
    expect(classifyResetError(new ApiError("From the server", 500)).message).toBe("From the server");

    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValueOnce(new Error("x"));
    expect(await runOAuthBrowserFlow("google")).toEqual({ kind: "error", message: tr("common.error.couldNotOpenTheSignInPage") });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: "success", url: "dosya://auth/callback" });
    expect(await runOAuthBrowserFlow("google")).toEqual({ kind: "error", message: tr("common.description.signInWasInterruptedPleaseTryAgain") });
  });

  it("the sign-in store errors", async () => {
    await renderInLocale(<></>, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    await useAuthStore.getState().submit2fa("123456", false);
    expect(useAuthStore.getState().error).toBe(tr("common.error.sessionExpiredPleaseSignInAgain"));
    useAuthStore.setState({ ...SIGNED_OUT } as never);
    await useAuthStore.getState().verifyEmail("123456");
    expect(useAuthStore.getState().error).toBe(tr("common.error.sessionExpiredPleaseSignUpAgain"));
    useAuthStore.setState({ ...SIGNED_OUT } as never);
    await useAuthStore.getState().completeOAuthCode("code", "not-the-nonce");
    expect(useAuthStore.getState().error).toBe(tr("common.error.thatSignInLinkDidnTComeFromThisAppPleaseTrySigningIn"));
  });

  it("the biometric prompt", async () => {
    await renderInLocale(<></>, "tr");
    const actual = jest.requireActual("@/auth/biometric") as { authenticateBiometric: () => Promise<boolean> };
    await actual.authenticateBiometric();
    const { authenticateAsync } = jest.requireMock("expo-local-authentication") as { authenticateAsync: jest.Mock };
    expect(authenticateAsync).toHaveBeenCalledWith({ promptMessage: moduleT("security.label.unlockDosyaDev") });
    expect(moduleT("security.label.unlockDosyaDev")).not.toBe("Unlock dosya.dev");
  });
});

describe("onboarding", () => {
  it("workspace step", async () => {
    await noEnglish(<WorkspaceStep onDone={jest.fn()} />, ["Dublin", "Ireland", "Europe", "Firat's Files", "Firat'ın Dosyaları"]);
    await screen.findByTestId("location-eu-west-1");
    expect(leftoverEnglish(collectTexts(), "tr", { allow: ["Dublin", "Ireland", "Europe"] })).toEqual([]);
  });

  it("workspace step, locations failed to load", async () => {
    (getRegions as jest.Mock).mockRejectedValue(new Error("down"));
    await noEnglish(<WorkspaceStep onDone={jest.fn()} />);
    await screen.findByTestId("location-error");
    expect(leftoverEnglish(collectTexts(), "tr")).toEqual([]);
  });

  it("the default workspace name follows the language", async () => {
    await renderInLocale(<></>, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    expect(defaultWorkspaceName("Firat Kaya")).toBe(tr("onboarding.label.firstSFiles", { first: "Firat" }));
    expect(defaultWorkspaceName(null)).toBe(tr("onboarding.label.myFiles"));
  });

  it("the quick picks fill the name in the chosen language", async () => {
    await renderInLocale(<WorkspaceStep onDone={jest.fn()} />, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    fireEvent.press(screen.getByLabelText(tr("onboarding.label.work")));
    expect(screen.getByTestId("workspace-name").props.value).toBe(tr("onboarding.label.work"));
  });

  it("workspace step, creation failure toast", async () => {
    (createWorkspace as jest.Mock).mockRejectedValue("not an Error");
    await renderInLocale(<WorkspaceStep onDone={jest.fn()} />, "tr");
    await screen.findByTestId("location-eu-west-1");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(leftoverEnglish(mockToast.mock.calls.map((c) => c[0] as string), "tr")).toEqual([]);
    expect(mockToast.mock.calls[0][0]).toBe(moduleT("common.error.couldnTCreateTheWorkspace"));
  });

  it("photo access step on both platforms", async () => {
    for (const os of ["ios", "android"] as const) {
      const original = Platform.OS;
      Platform.OS = os;
      try {
        const r = await noEnglish(<PhotoAccessStep workspaceName="Firat's Files" onGranted={jest.fn()} onDenied={jest.fn()} />, ["Firat's Files", "iOS", "Android"]);
        const tr = makeT("tr", await loadMessages("tr"), en);
        expect(collectTexts()).toContain(tr("onboarding.description.platformSelectIosIOSOtherAndroidAsksNextYouChooseWhatGetsBackedUp", { platform: os }));
        r.unmount();
      } finally {
        Platform.OS = original;
      }
    }
  });

  it("permission denied step on both platforms and the settings toast", async () => {
    for (const os of ["ios", "android"] as const) {
      const original = Platform.OS;
      Platform.OS = os;
      try {
        const r = await noEnglish(<PermissionDeniedStep onContinue={jest.fn()} />);
        const tr = makeT("tr", await loadMessages("tr"), en);
        expect(collectTexts()).toContain(
          os === "ios" ? tr("onboarding.label.settingsDosyaDevPhotosFullAccess") : tr("onboarding.label.settingsAppsDosyaDevPermissionsPhotosAndVideos"),
        );
        r.unmount();
      } finally {
        Platform.OS = original;
      }
    }
    jest.spyOn(Linking, "openSettings").mockRejectedValue(new Error("no"));
    await renderInLocale(<PermissionDeniedStep onContinue={jest.fn()} />, "tr");
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast.mock.calls[0][0]).toBe(moduleT("onboarding.error.couldnTOpenSettingsUseThePathBelowInstead"));
  });

  it("choose step: loading, ready, limited, over the plan, unavailable, save failure", async () => {
    (estimateLibrary as jest.Mock).mockReturnValue(new Promise(() => {}));
    const loading = await noEnglish(<ChooseStep workspaceId="ws1" limited onDone={jest.fn()} onSkip={jest.fn()} />);
    expect(collectTexts()).toContain(moduleT("onboarding.label.checkingYourLibrary"));
    loading.unmount();

    (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 1234, videos: 56, estimatedBytes: 61_200_000_000 });
    (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { total: 1_073_741_824 } });
    const ready = await noEnglish(<ChooseStep workspaceId="ws1" limited onDone={jest.fn()} onSkip={jest.fn()} />);
    await screen.findByTestId("storage-warning");
    expect(leftoverEnglish(collectTexts(), "tr", { allow: UNIT_K })).toEqual([]);
    const tr = makeT("tr", await loadMessages("tr"), en);
    expect(screen.getByTestId("toggle-photo").props.accessibilityLabel).toBe(tr("onboarding.action.backUpPhotos"));
    expect(screen.getByTestId("range-today").props.accessibilityLabel).toBe(tr("onboarding.label.fromToday"));
    ready.unmount();

    (estimateLibrary as jest.Mock).mockResolvedValue(null);
    await noEnglish(<ChooseStep workspaceId="ws1" limited={false} onDone={jest.fn()} onSkip={jest.fn()} />);
    await waitFor(() => expect(collectTexts()).toContain(tr("onboarding.error.weCouldnTCheckYourLibraryRightNowYouCanStillChooseWhatTo")));
  });

  it("choose step: the save-failure toast", async () => {
    mockUpdate.mockRejectedValueOnce("not an Error");
    await renderInLocale(<ChooseStep workspaceId="ws1" limited={false} onDone={jest.fn()} onSkip={jest.fn()} />, "tr");
    await screen.findByText(/1\.234/);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast.mock.calls[0][0]).toBe(moduleT("onboarding.error.couldnTSaveYourBackupChoices"));
  });

  it("first backup step in all its states", async () => {
    const tr = makeT("tr", await loadMessages("tr"), en);
    const props = { workspaceId: "ws1", workspaceName: "Firat's Files", onDone: jest.fn() };
    const allow = ["Firat's Files"];

    const none = await noEnglish(<FirstBackupStep {...props} workspaceId="" />, allow);
    expect(collectTexts()).toContain(tr("onboarding.heading.noWorkspaceToBackUpTo"));
    none.unmount();

    const { runBackup } = jest.requireMock("@/backup/orchestrator") as { runBackup: jest.Mock };
    const done = await noEnglish(<FirstBackupStep {...props} />, allow);
    await waitFor(() => expect(collectTexts()).toContain(tr("onboarding.heading.nothingToBackUpYet")));
    done.unmount();

    runBackup.mockRejectedValueOnce(new Error("boom"));
    const failed = await noEnglish(<FirstBackupStep {...props} />, allow);
    await waitFor(() => expect(collectTexts()).toContain(tr("onboarding.error.backupCouldNotStart")));
    failed.unmount();

    useUploadStore.setState({ settledBk: { count: 3, bytes: 30 } });
    useBackupRun.setState({ phase: "running" } as never);
    runBackup.mockReturnValue(new Promise(() => {}));
    await noEnglish(<FirstBackupStep {...props} />, allow);
    await waitFor(() => expect(collectTexts()).toContain(tr("onboarding.heading.backingUpNow")));
    expect(screen.getByTestId("first-backup-progress").props.children).toBeDefined();
    expect(leftoverEnglish(collectTexts(), "tr", { allow })).toEqual([]);
  });

  it("the step frame names its position in the chosen language", async () => {
    const tr = makeT("tr", await loadMessages("tr"), en);
    await renderInLocale(
      <StepProgressProvider total={3} offset={1}>
        <StepScreen step={3} title="t" primaryLabel="p" onPrimary={jest.fn()}><></></StepScreen>
      </StepProgressProvider>,
      "tr",
    );
    expect(screen.getByTestId("onboarding-progress").props.accessibilityLabel).toBe(tr("onboarding.label.stepShownOfTotal", { shown: 2, total: 3 }));
  });

  it("the size hedge", async () => {
    await renderInLocale(<></>, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    expect(formatEstimate(61_200_000_000)).toBe(tr("onboarding.label.aboutSize", { size: formatBytes(61_200_000_000) }));
    expect(formatEstimate(61_200_000_000)).not.toBe(`about ${formatBytes(61_200_000_000)}`);
    expect(formatEstimate(null)).toBe("");
  });

  it("the flow falls back to a translated 'your workspace'", async () => {
    mockWorkspaces = undefined;
    mockIsError = true;
    await renderInLocale(<OnboardingFlow accountId="a1" onFinished={jest.fn()} />, "tr");
    const tr = makeT("tr", await loadMessages("tr"), en);
    await waitFor(() => expect(screen.getByTestId("onboarding-photos")).toBeTruthy());
    expect(screen.getByTestId("step-subtitle").props.children).toBe(
      tr("onboarding.description.dosyaDevNeedsAccessToYourPhotoLibraryToCopyNewPhotosAndVideos", { workspaceName: tr("onboarding.label.yourWorkspace") }),
    );
  });
});

describe("language switch while mounted", () => {
  it("login follows English to German in place", async () => {
    let setPref: (p: "de") => Promise<void> = async () => {};
    function Probe() {
      setPref = useLocale().setPreference as never;
      return null;
    }
    await renderInLocale(<><LoginScreen /><Probe /></>, "en");
    expect(screen.getByText("Welcome back")).toBeTruthy();
    await act(async () => { await setPref("de"); });
    const de = makeT("de", await loadMessages("de"), en);
    expect(screen.queryByText("Welcome back")).toBeNull();
    expect(collectTexts()).toContain(de("common.heading.welcomeBack"));
    expect(leftoverEnglish(collectTexts(), "de", { allow: UNIT_K })).toEqual([]);
  });

  it("an onboarding step follows too", async () => {
    let setPref: (p: "de") => Promise<void> = async () => {};
    function Probe() {
      setPref = useLocale().setPreference as never;
      return null;
    }
    await renderInLocale(<><PermissionDeniedStep onContinue={jest.fn()} /><Probe /></>, "en");
    expect(screen.getByText("Photo access is off")).toBeTruthy();
    await act(async () => { await setPref("de"); });
    expect(screen.queryByText("Photo access is off")).toBeNull();
    expect(leftoverEnglish(collectTexts(), "de")).toEqual([]);
  });
});

describe("English stays as it was, except the approved rewordings", () => {
  it("sign-in button and links read Sign in", () => {
    render(<LoginScreen />);
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByText("Log In")).toBeNull();
    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByText("Forgot password?")).toBeTruthy();
    expect(screen.getByText("Don't have an account?", { exact: false })).toBeTruthy();
  });

  it("create account is sentence case and the link back reads Sign in", async () => {
    render(<SignUpScreen />);
    await screen.findByTestId("create");
    expect(screen.getByText("Create account")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByText("Log in")).toBeNull();
    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.getByText("5 GB free. Setup takes about a minute after this.")).toBeTruthy();
  });

  it("the terms sentences are the same characters", async () => {
    render(<SignUpScreen />);
    await screen.findByTestId("create");
    expect(screen.getByText("I agree to the Terms of Service and acknowledge the Privacy Policy")).toBeTruthy();
    expect(screen.getByText("By continuing, you agree to our Terms of Service and Privacy Policy.")).toBeTruthy();
  });

  it("the forgot-password link back reads Sign in", () => {
    render(<ForgotPasswordScreen />);
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText("Remembered it?", { exact: false })).toBeTruthy();
  });

  it("the locations error says could not", async () => {
    (getRegions as jest.Mock).mockRejectedValue(new Error("down"));
    render(<WorkspaceStep onDone={jest.fn()} />);
    await screen.findByText("Locations could not be loaded. Your workspace will be created in the one closest to you.");
  });

  it("the choose step counts and the plan line read as before", async () => {
    (useWorkspaceStorage as jest.Mock).mockReturnValue({ data: { total: 1_073_741_824 } });
    render(<ChooseStep workspaceId="ws1" limited={false} onDone={jest.fn()} onSkip={jest.fn()} />);
    await screen.findByText("1,234 photos · 56 videos · about 57.0 GB");
    expect(screen.getByText("Selected: about 57.0 GB of 1.0 GB")).toBeTruthy();
    expect(screen.getByText("Your plan holds 1.0 GB. Narrow the selection below, or add storage.")).toBeTruthy();
    expect(screen.getByText("12 months")).toBeTruthy();
  });

  it("the choose step without a size drops the size part", async () => {
    (estimateLibrary as jest.Mock).mockResolvedValue({ photos: 2, videos: 0, estimatedBytes: null });
    render(<ChooseStep workspaceId="ws1" limited={false} onDone={jest.fn()} onSkip={jest.fn()} />);
    await screen.findByText("2 photos · 0 videos");
  });

  it("the reset countdown and the resend line", () => {
    jest.useFakeTimers();
    try {
      render(<ResetPasswordScreen />);
      expect(screen.getByText("Resend available in 30s")).toBeTruthy();
      expect(screen.getByText("We sent a 6-digit code to a@b.com.")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("the verify subtitle and the welcome progress label", () => {
    useAuthStore.setState({ pendingVerificationEmail: "a@b.com" } as never);
    render(<VerifyScreen />);
    expect(screen.getByText("Enter the code we emailed to a@b.com")).toBeTruthy();
    render(<WelcomeScreen />);
    expect(screen.getByLabelText("Slide 1 of 3")).toBeTruthy();
  });

  it("the default workspace names and the OS-specific path", () => {
    expect(defaultWorkspaceName("Firat Kaya")).toBe("Firat's Files");
    expect(defaultWorkspaceName("")).toBe("My Files");
    expect(formatEstimate(1_073_741_824)).toBe("about 1.0 GB");
  });
});
