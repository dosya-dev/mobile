const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
const order: string[] = [];
jest.mock("./api", () => ({
  mobileLogin: jest.fn(),
  mobile2fa: jest.fn(),
  mobileRefresh: jest.fn(),
  mobileLogout: jest.fn(async () => { order.push("logout"); }),
  fetchMe: jest.fn(),
}));
jest.mock("@/api", () => ({
  setTokenProvider: jest.fn(),
  setRefreshHandler: jest.fn(),
  ApiError: jest.requireActual("../api/errors").ApiError,
}));
jest.mock("@/filesProvider/link", () => ({
  relinkFilesProvider: jest.fn(async () => {}),
  unlinkFilesProvider: jest.fn(async () => {}),
}));

import { useAuthStore, onBeforeSignOut } from "./authStore";
import { saveTokens, loadTokens } from "./tokenStore";

/**
 * Push unregistration needs the session it is about to end: DELETE
 * /api/notifications/push/register-device is authenticated, so it has to run
 * before the tokens are revoked and cleared. The store therefore exposes a
 * before-sign-out hook rather than the layout reacting to the status flip,
 * by which time the request could no longer be made.
 */
beforeEach(async () => {
  order.length = 0;
  await saveTokens({ access: "a", refresh: "r" });
  useAuthStore.setState({ status: "signedIn", user: { id: "u1", email: "a@b.c" } as never });
});

describe("onBeforeSignOut", () => {
  it("runs the hook while the session is still live, before the server logout", async () => {
    let tokensAtHook: unknown = "unset";
    const off = onBeforeSignOut(async () => {
      order.push("hook");
      tokensAtHook = await loadTokens();
    });
    await useAuthStore.getState().signOut();
    off();
    expect(order).toEqual(["hook", "logout"]);
    expect(tokensAtHook).toMatchObject({ access: "a" });
    expect(await loadTokens()).toBeNull();
    expect(useAuthStore.getState().status).toBe("signedOut");
  });

  it("a failing hook cannot stop the sign-out", async () => {
    const off = onBeforeSignOut(async () => { throw new Error("offline"); });
    await useAuthStore.getState().signOut();
    off();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(await loadTokens()).toBeNull();
  });

  it("an unregistered hook no longer runs", async () => {
    const hook = jest.fn(async () => {});
    onBeforeSignOut(hook)();
    await useAuthStore.getState().signOut();
    expect(hook).not.toHaveBeenCalled();
  });
});
