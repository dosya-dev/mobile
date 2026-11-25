/**
 * Regression tests for the "logged out ~50 minutes into a backup" report.
 *
 * The session is meant to last 60 days (refresh token TTL); the access token
 * lives 1 hour. Being dropped at ~50 minutes means the refresh path failed, so
 * these lock down the two defects that made a live session look dead.
 */
jest.mock("./tokenStore", () => ({
  saveTokens: jest.fn(), loadTokens: jest.fn(async () => null), clearTokens: jest.fn(),
  saveUser: jest.fn(), loadUser: jest.fn(),
}));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));

import { useAuthStore, refreshSession, getLastSessionDropReason } from "./authStore";
import * as api from "./api";
import { ApiError } from "@/api";

const USER = { id: "u", email: "e", name: "n", created_at: 1 };

beforeEach(() => {
  jest.restoreAllMocks();
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

/** Put a real refresh token into module state the only way the store allows. */
async function signInWithTokens() {
  jest.spyOn(api, "mobileLogin").mockResolvedValue({
    kind: "tokens", access: "access-1", refresh: "refresh-1", user: USER,
  } as never);
  await useAuthStore.getState().signIn("e@x.com", "pw");
  expect(useAuthStore.getState().status).toBe("signedIn");
}

it("reports 'unavailable', NOT 'rejected', when there is no refresh token in memory", async () => {
  // A background task starts a fresh JS context and never mounts the UI that
  // calls hydrate(), so the in-memory token is null. That says nothing about
  // the server's view of the session - reporting "rejected" tore down a live
  // 60-day session over it.
  expect(await refreshSession()).toBe("unavailable");
  expect(useAuthStore.getState().status).toBe("signedOut"); // unchanged, not dropped
});

it("keeps the session when the refresh call fails for a NON-401 reason", async () => {
  await signInWithTokens();
  jest.spyOn(api, "mobileRefresh").mockRejectedValue(new ApiError("server blew up", 500));

  expect(await refreshSession()).toBe("unavailable");
  expect(useAuthStore.getState().status).toBe("signedIn"); // still signed in
});

it("drops the session only when the SERVER rejects the refresh token", async () => {
  await signInWithTokens();
  jest.spyOn(api, "mobileRefresh").mockRejectedValue(new ApiError("nope", 401));

  expect(await refreshSession()).toBe("rejected");
  expect(useAuthStore.getState().status).toBe("signedOut");
  expect(getLastSessionDropReason()?.reason).toBe("server-rejected-refresh");
});

it("swaps in the new token pair on a successful refresh", async () => {
  await signInWithTokens();
  const spy = jest.spyOn(api, "mobileRefresh").mockResolvedValue({ access: "access-2", refresh: "refresh-2" } as never);

  expect(await refreshSession()).toBe("refreshed");
  expect(spy).toHaveBeenCalledWith("refresh-1");
  expect(useAuthStore.getState().status).toBe("signedIn");
});

it("shares one round-trip between concurrent refreshes (single-flight)", async () => {
  await signInWithTokens();
  const spy = jest.spyOn(api, "mobileRefresh").mockResolvedValue({ access: "a2", refresh: "r2" } as never);

  const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
  expect([a, b, c]).toEqual(["refreshed", "refreshed", "refreshed"]);
  expect(spy).toHaveBeenCalledTimes(1);
});

it("records an explicit sign-out distinctly from a credential rejection", async () => {
  await signInWithTokens();
  await useAuthStore.getState().signOut();
  expect(getLastSessionDropReason()?.reason).toBe("explicit-sign-out");
});

/**
 * The second cause of "it logged me out on its own": the refresh token had
 * already been rotated by ANOTHER JS context.
 *
 * The backup task (src/backup/background.ts) runs in its own JS context with
 * its own module-level tokens and its own single-flight guard. When it
 * refreshes, the server rotates the row and the foreground's in-memory copy
 * becomes a dead token. Presenting it returns a real 401 - which the store
 * then read as "the server rejected my credential" and signed the user out of
 * a perfectly live 60-day session.
 *
 * SecureStore is the shared truth between the two contexts, so it is what the
 * refresh path must consult before deciding a session is dead.
 */
describe("a token rotated by another JS context", () => {
  const store = jest.requireMock("./tokenStore") as {
    loadTokens: jest.Mock; saveTokens: jest.Mock; clearTokens: jest.Mock;
  };

  // The module factory's mocks are shared across the whole file, and
  // jest.restoreAllMocks() only restores spies - so call counts and
  // implementations leak in from the tests above unless they are reset here.
  beforeEach(() => {
    store.loadTokens.mockReset().mockResolvedValue(null);
    store.clearTokens.mockClear();
    store.saveTokens.mockClear();
  });

  it("sends the token from disk when another context has already rotated it", async () => {
    await signInWithTokens();
    // The backup context refreshed while we were idle: disk moved on.
    store.loadTokens.mockResolvedValue({ access: "access-9", refresh: "refresh-9" });
    const spy = jest.spyOn(api, "mobileRefresh").mockResolvedValue({ access: "a10", refresh: "r10" } as never);

    expect(await refreshSession()).toBe("refreshed");
    expect(spy).toHaveBeenCalledWith("refresh-9");
  });

  it("does NOT sign the user out when the rejected token was already superseded on disk", async () => {
    await signInWithTokens();
    // Disk still agrees at read time, so we present refresh-1...
    store.loadTokens.mockResolvedValueOnce({ access: "access-1", refresh: "refresh-1" });
    const spy = jest
      .spyOn(api, "mobileRefresh")
      // ...the server rejects it, because the other context rotated it a moment ago...
      .mockRejectedValueOnce(new ApiError("nope", 401))
      .mockResolvedValueOnce({ access: "a11", refresh: "r11" } as never);
    // ...and by now disk carries that other context's newer token.
    store.loadTokens.mockResolvedValue({ access: "access-9", refresh: "refresh-9" });

    expect(await refreshSession()).toBe("refreshed");
    expect(spy).toHaveBeenNthCalledWith(2, "refresh-9");
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(store.clearTokens).not.toHaveBeenCalled();
  });

  it("still signs out when the token the server rejected is the one on disk", async () => {
    await signInWithTokens();
    store.loadTokens.mockResolvedValue({ access: "access-1", refresh: "refresh-1" });
    jest.spyOn(api, "mobileRefresh").mockRejectedValue(new ApiError("nope", 401));

    expect(await refreshSession()).toBe("rejected");
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(getLastSessionDropReason()?.reason).toBe("server-rejected-refresh");
  });

  it("retries only once, so a genuinely dead token cannot loop", async () => {
    await signInWithTokens();
    let call = 0;
    store.loadTokens.mockImplementation(async () => ({ access: "a", refresh: `refresh-${++call}` }));
    const spy = jest.spyOn(api, "mobileRefresh").mockRejectedValue(new ApiError("nope", 401));

    expect(await refreshSession()).toBe("rejected");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
