/**
 * Purging on sign-OUT was also what stopped one account inheriting another's
 * cached files, workspaces and backup ledger. Now that the sign-out purge only
 * runs for a KNOWN drop (see shouldPurgeOnSignOut), that guarantee needs its
 * own footing: catch the switch at sign-IN, where the two account ids are
 * actually both in hand.
 *
 * This also covers the case the sign-out hook never could - the app being
 * killed while signed in, so nothing observed a transition at all.
 */
jest.mock("./tokenStore", () => ({
  saveTokens: jest.fn(), loadTokens: jest.fn(async () => null), clearTokens: jest.fn(),
  saveUser: jest.fn(), loadUser: jest.fn(async () => null),
}));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));

import { useAuthStore, takeAccountSwitch } from "./authStore";
import { queryClient } from "@/lib/queryClient";
import * as api from "./api";

const store = jest.requireMock("./tokenStore") as { loadUser: jest.Mock; saveUser: jest.Mock };

const userA = { id: "user-a", email: "a@x.com", name: "A", created_at: 1 };
const userB = { id: "user-b", email: "b@x.com", name: "B", created_at: 2 };

async function signInAs(user: typeof userA) {
  jest.spyOn(api, "mobileLogin").mockResolvedValue({
    kind: "tokens", access: "access-1", refresh: "refresh-1", user,
  } as never);
  await useAuthStore.getState().signIn(user.email, "pw");
}

beforeEach(() => {
  jest.restoreAllMocks();
  store.loadUser.mockReset().mockResolvedValue(null);
  store.saveUser.mockClear();
  takeAccountSwitch(); // drain anything a previous test left behind
  queryClient.clear();
  useAuthStore.setState({ status: "signedOut", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

describe("account switch detection", () => {
  it("reports the previous account when a DIFFERENT one signs in", async () => {
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userB);
    expect(takeAccountSwitch()).toBe("user-a");
  });

  it("reports nothing when the SAME account signs in again", async () => {
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userA);
    expect(takeAccountSwitch()).toBeNull();
  });

  it("reports nothing on a first sign-in, when there is no previous account", async () => {
    store.loadUser.mockResolvedValue(null);
    await signInAs(userA);
    expect(takeAccountSwitch()).toBeNull();
  });

  it("reports a switch only once, so the purge cannot run twice", async () => {
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userB);
    expect(takeAccountSwitch()).toBe("user-a");
    expect(takeAccountSwitch()).toBeNull();
  });

  it("still signs the new account in", async () => {
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userB);
    expect(useAuthStore.getState().status).toBe("signedIn");
    expect(useAuthStore.getState().user?.id).toBe("user-b");
  });
});

/**
 * The switch purge is asynchronous and runs from an effect AFTER the store has
 * already flipped to the new user, and it only reaches queryClient.clear()
 * behind a dozen awaited teardown steps. Every one of those is a frame in which
 * the new account's screens render against the old account's cached responses -
 * which is how another user's storage allowance appeared above the account card
 * in Settings. So the cache has to go here, synchronously, before the flip.
 */
describe("cached responses across an account change", () => {
  it("drops the previous account's cached responses before the new user lands", async () => {
    queryClient.setQueryData(["workspace-dashboard"], { total: { limit_bytes: 999, used_bytes: 1, free_bytes: 998 } });
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userB);
    expect(queryClient.getQueryData(["workspace-dashboard"])).toBeUndefined();
  });

  it("keeps them when the SAME account signs in again", async () => {
    queryClient.setQueryData(["workspace-dashboard"], { total: { limit_bytes: 999, used_bytes: 1, free_bytes: 998 } });
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userA);
    expect(queryClient.getQueryData(["workspace-dashboard"])).toBeDefined();
  });

  it("drops them on an explicit sign-out, which is the only chance to", async () => {
    // clearTokens() also deletes the stored user, so the NEXT sign-in sees no
    // previous account and reports no switch - nothing downstream would catch
    // this cache if sign-out did not.
    store.loadUser.mockResolvedValue(userA);
    await signInAs(userA);
    queryClient.setQueryData(["workspace-dashboard"], { total: { limit_bytes: 999, used_bytes: 1, free_bytes: 998 } });
    await useAuthStore.getState().signOut();
    expect(queryClient.getQueryData(["workspace-dashboard"])).toBeUndefined();
  });
});
