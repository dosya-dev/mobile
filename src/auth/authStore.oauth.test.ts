jest.mock("./tokenStore", () => ({ saveTokens: jest.fn(), loadTokens: jest.fn(), clearTokens: jest.fn(), saveUser: jest.fn(), loadUser: jest.fn() }));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));
// runOAuthBrowserFlow is what records the pending PKCE pair, and it is mocked
// out below - so the record is supplied here instead. completeOAuthCode refuses
// a callback with nothing pending (authStore.oauthNonce.test.ts), which is the
// whole point of that check, so the browser-flow mocks must echo this nonce.
// Literals inlined: a jest.mock factory may not close over out-of-scope vars.
jest.mock("./pendingOAuth", () => ({
  loadPendingOAuth: jest.fn(async () => ({
    verifier: "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
    nonce: "nonce1234567",
    startedAt: 1,
  })),
  savePendingOAuth: jest.fn(async () => undefined),
  clearPendingOAuth: jest.fn(async () => undefined),
}));

const NONCE = "nonce1234567";

import { Platform } from "react-native";
import { useAuthStore } from "./authStore";
import * as oauth from "./oauth";
import * as api from "./api";

beforeEach(() => {
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

it("signs in on a successful OAuth exchange", async () => {
  jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({ kind: "code", code: "dmoc_x", state: NONCE });
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue({
    kind: "tokens", access: "a", refresh: "r", user: { id: "u", email: "e", name: "n", created_at: 1 },
  });
  await useAuthStore.getState().signInWithOAuth("google");
  expect(useAuthStore.getState().status).toBe("signedIn");
});

it("routes to 2fa when the exchange requires it", async () => {
  jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({ kind: "code", code: "dmoc_x", state: NONCE });
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue({ kind: "2fa", method: "email", challengeToken: "c" });
  await useAuthStore.getState().signInWithOAuth("github");
  expect(useAuthStore.getState().pending2fa).toEqual({ method: "email", challengeToken: "c" });
  expect(useAuthStore.getState().status).toBe("signedOut");
});

it("is a silent no-op on cancel", async () => {
  jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({ kind: "cancel" });
  await useAuthStore.getState().signInWithOAuth("google");
  expect(useAuthStore.getState().error).toBeNull();
  expect(useAuthStore.getState().status).toBe("signedOut");
});

it("surfaces a flow error", async () => {
  jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({ kind: "error", message: "Could not open the sign-in page." });
  await useAuthStore.getState().signInWithOAuth("google");
  expect(useAuthStore.getState().error).toBe("Could not open the sign-in page.");
});

const mockAppleSignIn = jest.fn();
const fakeAppleModule = {
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...a: unknown[]) => mockAppleSignIn(...a),
} as never;

describe("signInWithApple (native)", () => {
  beforeEach(() => mockAppleSignIn.mockReset());

  it("verifies the identity token via the API and signs in", async () => {
    mockAppleSignIn.mockResolvedValue({
      identityToken: "apple.jwt.token",
      authorizationCode: "c0de",
      fullName: { givenName: "Firat", familyName: "Kaya" },
    });
    jest.spyOn(api, "mobileAppleLogin").mockResolvedValue({
      kind: "tokens", access: "acc", refresh: "ref", user: { id: "u1", email: "f@x.co", name: "Firat", created_at: 1 },
    });
    await useAuthStore.getState().signInWithApple(fakeAppleModule);
    // The authorization code goes with it: the server exchanges it for the
    // refresh token Apple's revoke API needs at account deletion (5.1.1(v)).
    expect(api.mobileAppleLogin).toHaveBeenCalledWith("apple.jwt.token", "Firat Kaya", "c0de");
    expect(useAuthStore.getState().status).toBe("signedIn");
  });

  it("treats a dismissed sheet as a non-error", async () => {
    mockAppleSignIn.mockRejectedValue(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    await useAuthStore.getState().signInWithApple(fakeAppleModule);
    expect(useAuthStore.getState().error).toBeNull();
  });

  it("routes a 2FA-protected account into the challenge flow", async () => {
    mockAppleSignIn.mockResolvedValue({ identityToken: "apple.jwt.token", fullName: null });
    jest.spyOn(api, "mobileAppleLogin").mockResolvedValue({
      kind: "2fa", method: "totp", challengeToken: "chal_1",
    });
    await useAuthStore.getState().signInWithApple(fakeAppleModule);
    expect(useAuthStore.getState().pending2fa).toEqual({ method: "totp", challengeToken: "chal_1" });
    // A credential without a code (older module shape) still signs in, sending null.
    expect(api.mobileAppleLogin).toHaveBeenCalledWith("apple.jwt.token", "", null);
  });
});

// expo-apple-authentication has no Android implementation, but the provider
// list is the same on both platforms (guideline 4.8 parity, and the Apple
// button sits second on Android). So off iOS the same call has to take the
// auth-session route instead - against /api/auth/mobile/apple, which the web
// Apple callback already recognises as a mobile flow.
describe("signInWithApple (browser fallback off iOS)", () => {
  afterEach(() => { Platform.OS = "ios"; });

  it("runs the browser flow rather than reaching for the native module", async () => {
    Platform.OS = "android";
    const flow = jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({
      kind: "code", code: "dmoc_a", state: NONCE,
    });
    jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue({
      kind: "tokens", access: "a", refresh: "r", user: { id: "u", email: "e", name: "n", created_at: 1 },
    });
    await useAuthStore.getState().signInWithApple();
    expect(flow).toHaveBeenCalledWith("apple");
    expect(useAuthStore.getState().status).toBe("signedIn");
  });

  it("still uses the native sheet on iOS", async () => {
    Platform.OS = "ios";
    // Cleared, not just spied: earlier tests in this file share the module and
    // their calls would otherwise count as this one's.
    const flow = jest.spyOn(oauth, "runOAuthBrowserFlow");
    flow.mockClear();
    mockAppleSignIn.mockResolvedValue({ identityToken: "apple.jwt.token", fullName: null });
    jest.spyOn(api, "mobileAppleLogin").mockResolvedValue({
      kind: "tokens", access: "acc", refresh: "ref", user: { id: "u1", email: "f@x.co", name: "F", created_at: 1 },
    });
    await useAuthStore.getState().signInWithApple(fakeAppleModule);
    expect(flow).not.toHaveBeenCalled();
    expect(api.mobileAppleLogin).toHaveBeenCalled();
  });
});
