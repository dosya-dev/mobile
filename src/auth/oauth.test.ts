jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-linking", () => ({
  parse: (url: string) => {
    const q = url.split("?")[1] ?? "";
    const queryParams = Object.fromEntries(new URLSearchParams(q));
    return { queryParams };
  },
}));
jest.mock("./pkce", () => ({
  createPkcePair: jest.fn(async () => ({
    verifier: "v".repeat(43),
    challenge: "c".repeat(43),
    nonce: "nonce123456",
  })),
}));
jest.mock("./pendingOAuth", () => ({ savePendingOAuth: jest.fn(async () => undefined) }));

import * as WebBrowser from "expo-web-browser";
import { runOAuthBrowserFlow } from "./oauth";
import { savePendingOAuth } from "./pendingOAuth";

const openAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;

beforeEach(() => (savePendingOAuth as jest.Mock).mockClear());

it("returns the code and the echoed state from a successful redirect", async () => {
  openAuthSessionAsync.mockResolvedValue({
    type: "success",
    url: "dosya://auth/callback?code=dmoc_abc&state=nonce123456",
  });
  expect(await runOAuthBrowserFlow("google")).toEqual({
    kind: "code",
    code: "dmoc_abc",
    state: "nonce123456",
  });
});

// The verifier has to be recorded BEFORE the browser opens: on Android the
// redirect can come back through a deep link into a different (or relaunched)
// context, and an unrecorded verifier there is an unredeemable code.
it("records the pending verifier before opening the browser", async () => {
  openAuthSessionAsync.mockImplementation(async () => {
    expect(savePendingOAuth).toHaveBeenCalled();
    return { type: "success", url: "dosya://auth/callback?code=dmoc_abc&state=nonce123456" };
  });
  await runOAuthBrowserFlow("google");
  expect(savePendingOAuth).toHaveBeenCalledTimes(1);
});

it("sends the challenge and the nonce, and never the verifier", async () => {
  openAuthSessionAsync.mockResolvedValue({ type: "success", url: "dosya://auth/callback?code=x&state=nonce123456" });
  await runOAuthBrowserFlow("google");

  const startUrl: string = openAuthSessionAsync.mock.calls[0][0];
  expect(startUrl).toContain("code_challenge=" + "c".repeat(43));
  expect(startUrl).toContain("state=nonce123456");
  expect(startUrl).not.toContain("v".repeat(43));
});

it("returns cancel when the user dismisses the browser", async () => {
  openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
  expect(await runOAuthBrowserFlow("google")).toEqual({ kind: "cancel" });
});

it("returns error when the redirect carries no code", async () => {
  openAuthSessionAsync.mockResolvedValue({ type: "success", url: "dosya://auth/callback" });
  expect(await runOAuthBrowserFlow("github")).toEqual({ kind: "error", message: expect.any(String) });
});

// A reply with no state at all still comes back as a code; the decision to
// refuse it belongs to completeOAuthCode, which is the single place that knows
// whether a nonce was expected.
it("passes a missing state through as null rather than failing here", async () => {
  openAuthSessionAsync.mockResolvedValue({ type: "success", url: "dosya://auth/callback?code=dmoc_abc" });
  expect(await runOAuthBrowserFlow("google")).toEqual({ kind: "code", code: "dmoc_abc", state: null });
});
