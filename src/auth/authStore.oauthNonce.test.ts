/**
 * The check that makes an injected `dosya://auth/callback?code=…` inert.
 *
 * A custom scheme is not a private channel: another installed app can register
 * it, and any web page can navigate to it. Before this, the app exchanged
 * whatever code arrived - so a code minted for an account the ATTACKER controls
 * would sign the user into that account, and everything they backed up
 * afterwards would land in the attacker's workspace.
 *
 * The app therefore generates a nonce before opening the browser and refuses
 * any callback that cannot echo it back.
 */
jest.mock("./tokenStore", () => ({
  saveTokens: jest.fn(), loadTokens: jest.fn(), clearTokens: jest.fn(),
  saveUser: jest.fn(), loadUser: jest.fn(),
}));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));

const mockPending = { current: null as { verifier: string; nonce: string; startedAt: number } | null };
jest.mock("./pendingOAuth", () => ({
  loadPendingOAuth: jest.fn(async () => mockPending.current),
  savePendingOAuth: jest.fn(async () => undefined),
  clearPendingOAuth: jest.fn(async () => { mockPending.current = null; }),
}));

import { useAuthStore } from "./authStore";
import * as api from "./api";
import { clearPendingOAuth } from "./pendingOAuth";

const USER = { id: "u", email: "e", name: "n", created_at: 1 };
const TOKENS = { kind: "tokens", access: "a", refresh: "r", user: USER } as const;
const VERIFIER = "v".repeat(43);

beforeEach(() => {
  jest.restoreAllMocks();
  (clearPendingOAuth as jest.Mock).mockClear();
  mockPending.current = { verifier: VERIFIER, nonce: "goodnonce123", startedAt: Date.now() };
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

it("exchanges the code, with the verifier, when the nonce matches", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_ok", "goodnonce123");

  expect(exchange).toHaveBeenCalledWith("dmoc_ok", VERIFIER);
  expect(useAuthStore.getState().status).toBe("signedIn");
});

it("refuses a callback carrying somebody else's nonce", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_wrong_nonce", "attackernonce");

  expect(exchange).not.toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe("signedOut");
  expect(useAuthStore.getState().error).toMatch(/didn't come from this app/);
});

// The downgrade attempt: omit the parameter and hope the check is skipped.
it("refuses a callback with no nonce at all while a flow is pending", async () => {
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_absent_nonce", null);

  expect(exchange).not.toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe("signedOut");
});

it("drops the pending verifier when it refuses, so a retry cannot reuse it", async () => {
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_drops_verifier", "wrong");
  expect(clearPendingOAuth).toHaveBeenCalled();
});

// Distinct code per case on purpose: `lastConsumedOAuthCode` is module state
// that outlives an individual test, so reusing "dmoc_ok" here would be
// short-circuited by the dedup guard and pass for the wrong reason.
it("clears the pending verifier once a sign-in completes", async () => {
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_ok_clears", "goodnonce123");
  expect(clearPendingOAuth).toHaveBeenCalled();
});

// A 2FA branch still spends the code, so the verifier is spent with it.
it("clears the pending verifier when the exchange routes to 2FA", async () => {
  jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue({ kind: "2fa", method: "totp", challengeToken: "c" } as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_2fa", "goodnonce123");

  expect(useAuthStore.getState().pending2fa).toEqual({ method: "totp", challengeToken: "c" });
  expect(clearPendingOAuth).toHaveBeenCalled();
});

// The case this file exists for. "Nothing pending" is the resting state of an
// app that is not signing in, so it is the condition an attacker picks: fire
// dosya://auth/callback?code=… at an idle app and, if the absent record excused
// the check, the app would exchange a code minted for the attacker's account
// and adopt it. The server cannot backstop this - a challenge-less code is
// redeemable without a verifier, and the attacker chooses whether to send a
// challenge when they start the flow.
it("refuses a code when no flow is pending at all", async () => {
  mockPending.current = null;
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_injected", null);

  expect(exchange).not.toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe("signedOut");
  expect(useAuthStore.getState().error).toMatch(/didn't come from this app/);
});

// Same refusal even when the injected link carries a plausible-looking nonce:
// with no record to compare against there is nothing that could match.
it("refuses a code with no pending flow even if it carries a nonce", async () => {
  mockPending.current = null;
  const exchange = jest.spyOn(api, "mobileOAuthExchange").mockResolvedValue(TOKENS as never);
  await useAuthStore.getState().completeOAuthCode("dmoc_injected", "attackernonce1");

  expect(exchange).not.toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe("signedOut");
});
