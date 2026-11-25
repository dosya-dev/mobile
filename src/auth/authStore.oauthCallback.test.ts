/**
 * Regression tests for "Unmatched Route  dosya://auth/callback?code=…".
 *
 * On Android, Chrome resolves the custom scheme by firing an Intent, so the OS
 * can deliver the redirect to MainActivity as a deep link instead of handing it
 * back to WebBrowser.openAuthSessionAsync. The app/auth/callback route then
 * finishes the exchange through completeOAuthCode - which must also survive the
 * case where BOTH paths deliver the same single-use code.
 */
jest.mock("./tokenStore", () => ({
  saveTokens: jest.fn(), loadTokens: jest.fn(), clearTokens: jest.fn(),
  saveUser: jest.fn(), loadUser: jest.fn(),
}));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));
// A pending flow IS recorded for every case here. These tests are about deep
// -link delivery - double-spend, 2FA routing, retry - not about the nonce, and
// completeOAuthCode now refuses outright when nothing is pending (see
// authStore.oauthNonce.test.ts for why). Each call below therefore echoes the
// nonce, exactly as a real callback from the deployed API does.
// Literals are inlined: a jest.mock factory may not close over out-of-scope vars.
jest.mock("./pendingOAuth", () => ({
  loadPendingOAuth: jest.fn(async () => ({
    verifier: "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv",
    nonce: "nonce1234567",
    startedAt: 1,
  })),
  savePendingOAuth: jest.fn(async () => undefined),
  clearPendingOAuth: jest.fn(async () => undefined),
}));

import { useAuthStore } from "./authStore";
import * as api from "./api";
import * as oauth from "./oauth";
import { ApiError } from "@/api";

const NONCE = "nonce1234567";
const VERIFIER = "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv";
const USER = { id: "u", email: "e", name: "n", created_at: 1 };
const TOKENS = { kind: "tokens", access: "a", refresh: "r", user: USER } as const;

beforeEach(() => {
  jest.restoreAllMocks();
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

it("signs in from a deep-linked code alone, with no browser flow", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_deeplink", NONCE);
  expect(exchange).toHaveBeenCalledWith("dmoc_deeplink", VERIFIER);
  expect(useAuthStore.getState().status).toBe("signedIn");
});

it("exchanges a given code only once, so the deep link can't double-spend it", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_once", NONCE);
  await useAuthStore.getState().completeOAuthCode("dmoc_once", NONCE);
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().error).toBeNull();
});

it("does not consume the browser flow's code twice when both paths fire", async () => {
  jest.spyOn(oauth, "runOAuthBrowserFlow").mockResolvedValue({ kind: "code", code: "dmoc_both", state: NONCE });
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);

  await useAuthStore.getState().signInWithOAuth("google");
  await useAuthStore.getState().completeOAuthCode("dmoc_both", NONCE); // deep link lands after

  expect(exchange).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().status).toBe("signedIn");
});

it("routes a deep-linked code into the 2fa challenge", async () => {
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue({ kind: "2fa", method: "totp", challengeToken: "c" } as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_2fa", NONCE);
  expect(useAuthStore.getState().pending2fa).toEqual({ method: "totp", challengeToken: "c" });
  expect(useAuthStore.getState().status).toBe("signedOut");
});

it("surfaces an error and allows a retry when the exchange fails", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockRejectedValueOnce(new ApiError("boom", 500));
  await useAuthStore.getState().completeOAuthCode("dmoc_retry", NONCE);
  expect(useAuthStore.getState().error).toBe("boom");

  // the failed code must NOT stay marked consumed, or the retry silently no-ops
  exchange.mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_retry", NONCE);
  expect(useAuthStore.getState().status).toBe("signedIn");
});
