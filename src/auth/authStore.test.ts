const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("./api", () => ({
  mobileLogin: jest.fn(),
  mobile2fa: jest.fn(),
  mobileRefresh: jest.fn(),
  mobileLogout: jest.fn(),
  fetchMe: jest.fn(),
}));

// authStore registers its single-flight refresh handler with the real API
// client at module load time (`setRefreshHandler(fn)`). Mock `@/api` so we
// can capture that handler directly instead of exercising it through HTTP.
//
// IMPORTANT: declare this WITHOUT an initializer (no `= null`). Babel's
// CommonJS module transform hoists the `import "./authStore"` below to run
// before any top-level statement in this file (imports are always fully
// evaluated first, per ES module semantics) - but jest.mock() calls are
// hoisted even further, above that. If this had `= null`, that assignment
// would still execute as a plain statement *after* the (also-hoisted)
// import, silently clobbering the value the mock factory just set during
// module evaluation. Leaving it undeclared avoids emitting that clobbering
// assignment; verified via a diff of the actual babel-jest transform output.
let capturedRefresh: (() => Promise<boolean>) | null;
jest.mock("@/api", () => ({
  setTokenProvider: jest.fn(),
  setRefreshHandler: (fn: () => Promise<boolean>) => { capturedRefresh = fn; },
  // The real ApiError - the store must distinguish a 401 (credential actually
  // rejected) from a transport failure, so this cannot be a stub.
  ApiError: jest.requireActual("../api/errors").ApiError,
}));

import { useAuthStore } from "./authStore";
import * as authApi from "./api";
import { ApiError } from "../api/errors";
// The real token store (only expo-secure-store underneath it is mocked), so
// these tests assert on the SESSION rather than on how it happens to be laid
// out in the keychain. They used to poke at "dosya.access"/"dosya.refresh"
// directly, which made them fail the moment the pair became a single entry.
import { saveTokens, loadTokens } from "./tokenStore";

const USER = { id: "u", email: "a@b.com", name: "A", created_at: 1 };

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  useAuthStore.setState({ status: "loading", user: null, pending2fa: null, error: null });
  jest.clearAllMocks();
});

describe("authStore", () => {
  it("signs in with tokens and becomes signedIn", async () => {
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({ kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER });
    await useAuthStore.getState().signIn("a@b.com", "pw");
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(await loadTokens()).toEqual({ access: "dosm_a", refresh: "dosr_b" });
  });

  it("routes to 2fa when required", async () => {
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({ kind: "2fa", method: "totp", challengeToken: "chal" });
    await useAuthStore.getState().signIn("a@b.com", "pw");
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(useAuthStore.getState().pending2fa).toEqual({ method: "totp", challengeToken: "chal" });
  });

  it("completes 2fa and becomes signedIn", async () => {
    useAuthStore.setState({ pending2fa: { method: "totp", challengeToken: "chal" } });
    (authApi.mobile2fa as jest.Mock).mockResolvedValue({ access: "dosm_a", refresh: "dosr_b", user: USER });
    await useAuthStore.getState().submit2fa("123456", false);
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().pending2fa).toBeNull();
  });

  it("surfaces the error message on a failed sign-in", async () => {
    (authApi.mobileLogin as jest.Mock).mockRejectedValue(Object.assign(new Error("Invalid email or password"), { name: "ApiError" }));
    await useAuthStore.getState().signIn("a@b.com", "wrong");
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(useAuthStore.getState().error).toBe("Invalid email or password");
  });

  it("hydrate with a stored valid session becomes signedIn", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    (authApi.fetchMe as jest.Mock).mockResolvedValue(USER);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it("hydrate with no stored tokens becomes signedOut", async () => {
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("hydrate caches the profile so a later offline start has a name to show", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    (authApi.fetchMe as jest.Mock).mockResolvedValue(USER);
    await useAuthStore.getState().hydrate();
    expect(JSON.parse(store["dosya.user"])).toEqual(USER);
  });

  // Opening the app before the network is back must not destroy the stored
  // session - that turned a moment of no signal into a forced re-login.
  it("hydrate keeps the stored session when /api/me fails with a network error", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    store["dosya.user"] = JSON.stringify(USER);
    (authApi.fetchMe as jest.Mock).mockRejectedValue(new ApiError("Network request failed", 0));

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user).toEqual(USER);
    expect((await loadTokens())?.refresh).toBe("dosr_b");
  });

  it("hydrate clears the stored session when /api/me rejects the credential", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    store["dosya.user"] = JSON.stringify(USER);
    (authApi.fetchMe as jest.Mock).mockRejectedValue(new ApiError("Invalid or expired token", 401));

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(await loadTokens()).toBeNull();
    expect(store["dosya.user"]).toBeUndefined();
  });

  it("signOut clears tokens and state", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    useAuthStore.setState({ status: "signedIn", user: USER });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(await loadTokens()).toBeNull();
  });

  it("signOut revokes the session on the server with the refresh token", async () => {
    // The server revokes the linked Files-app session with it. Before this
    // call existed a signed-out phone's session stayed valid for 60 days.
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({ kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER });
    (authApi.mobileLogout as jest.Mock).mockResolvedValue(undefined);
    await useAuthStore.getState().signIn("a@b.com", "pw");
    await useAuthStore.getState().signOut();
    expect(authApi.mobileLogout).toHaveBeenCalledWith("dosr_b", expect.anything());
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("signOut still signs out when the server cannot be reached", async () => {
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({ kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER });
    (authApi.mobileLogout as jest.Mock).mockRejectedValue(new Error("Network request failed"));
    await useAuthStore.getState().signIn("a@b.com", "pw");
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(await loadTokens()).toBeNull();
  });
});

// The single-flight refresh handler is registered with `@/api` at module
// load time and isn't reachable through the public store actions, so these
// tests call the captured handler directly. `accessToken`/`refreshToken`/
// `refreshing` are module-level closures over the whole file (not zustand
// state), so `beforeEach`'s `setState` reset doesn't touch them - each test
// below starts by calling `signOut()`, which clears `accessToken`/
// `refreshToken` deterministically. `refreshing` self-resets to null once a
// call to `capturedRefresh()` resolves (that's exactly the invariant the
// regression test below is checking), so as long as every test awaits it to
// completion before the next test runs, no explicit reset is needed there.
describe("single-flight refresh handler", () => {
  beforeEach(async () => {
    await useAuthStore.getState().signOut();
  });

  it("regression: a no-token refresh does not wedge the single-flight state for later refreshes", async () => {
    expect(typeof capturedRefresh).toBe("function");

    // No refresh token yet (just signed out) - should resolve WITHOUT ever
    // calling mobileRefresh, and - this is the bug under test - without
    // leaving `refreshing` stuck as a resolved promise.
    //
    // The outcome is "unavailable", not "rejected": no token in memory says
    // nothing about the server's view of the session (a background task runs
    // in a fresh JS context that never hydrated). Reporting "rejected" here
    // made callers tear down a live 60-day session - see
    // authStore.sessionLifetime.test.ts.
    await expect(capturedRefresh!()).resolves.toBe("unavailable");
    expect(authApi.mobileRefresh).not.toHaveBeenCalled();

    // Now establish a real session with a real refresh token.
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({
      kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER,
    });
    await useAuthStore.getState().signIn("a@b.com", "pw");
    expect(useAuthStore.getState().status).toBe("signedIn");

    // If `refreshing` were still wedged at the stale settled promise, this
    // would resolve "rejected" and mobileRefresh would never be called.
    (authApi.mobileRefresh as jest.Mock).mockResolvedValue({ access: "dosm_c", refresh: "dosr_d" });
    await expect(capturedRefresh!()).resolves.toBe("refreshed");
    expect(authApi.mobileRefresh).toHaveBeenCalledTimes(1);
    expect(authApi.mobileRefresh).toHaveBeenCalledWith("dosr_b");
    expect((await loadTokens())?.access).toBe("dosm_c");
  });

  /** Sign in so the module-level access/refresh tokens hold a real session. */
  async function signedInSession() {
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({
      kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER,
    });
    await useAuthStore.getState().signIn("a@b.com", "pw");
    expect(useAuthStore.getState().status).toBe("signedIn");
  }

  it("clears the session when the server rejects the refresh token", async () => {
    await signedInSession();

    (authApi.mobileRefresh as jest.Mock).mockRejectedValue(new ApiError("Invalid or expired refresh token", 401));
    await expect(capturedRefresh!()).resolves.toBe("rejected");

    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(await loadTokens()).toBeNull();
  });

  // A dropped packet mid-refresh used to delete a 60-day refresh token and drop
  // the user at the login screen. The refresh failed, but the session did not.
  it("keeps the session when a refresh fails with a network error", async () => {
    await signedInSession();

    (authApi.mobileRefresh as jest.Mock).mockRejectedValue(new ApiError("Network request failed", 0));
    await expect(capturedRefresh!()).resolves.toBe("unavailable");

    expect(useAuthStore.getState().status).toBe("signedIn");
    expect((await loadTokens())?.refresh).toBe("dosr_b");
  });

  it("keeps the session when a refresh fails with a server error", async () => {
    await signedInSession();

    (authApi.mobileRefresh as jest.Mock).mockRejectedValue(new ApiError("Service unavailable", 503));
    await expect(capturedRefresh!()).resolves.toBe("unavailable");

    expect(useAuthStore.getState().status).toBe("signedIn");
    expect((await loadTokens())?.refresh).toBe("dosr_b");
  });

  it("dedupes concurrent calls into a single mobileRefresh round-trip (best-effort)", async () => {
    (authApi.mobileLogin as jest.Mock).mockResolvedValue({
      kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER,
    });
    await useAuthStore.getState().signIn("a@b.com", "pw");

    let resolveRefresh: (v: { access: string; refresh: string }) => void = () => {};
    const pending = new Promise<{ access: string; refresh: string }>((resolve) => { resolveRefresh = resolve; });
    (authApi.mobileRefresh as jest.Mock).mockReturnValue(pending);

    const p1 = capturedRefresh!();
    const p2 = capturedRefresh!();
    resolveRefresh({ access: "dosm_e", refresh: "dosr_f" });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe("refreshed");
    expect(r2).toBe("refreshed");
    expect(authApi.mobileRefresh).toHaveBeenCalledTimes(1);
  });
});
