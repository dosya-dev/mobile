/**
 * "It logged me out overnight, and the backup restarted from zero."
 *
 * A sign-out is not the only way the app reaches the signed-out screen. If the
 * TOKEN STORE cannot be read, hydrate() has no session to bring up either -
 * but that says nothing about whether a session exists. iOS keychain entries
 * are unreadable while the device is locked, which is exactly when a
 * background backup runs.
 *
 * Treating that as a sign-out is expensive: the shell purges everything
 * account-scoped on the transition (see app/_layout.tsx), which clears the
 * backup ledger and resets backup settings. The session on disk is untouched
 * and still live, so the user comes back signed in - to a backup that has
 * forgotten every file it already uploaded.
 *
 * So an unreadable store must never look like a rejected credential.
 */
jest.mock("./tokenStore", () => ({
  saveTokens: jest.fn(), loadTokens: jest.fn(async () => null), clearTokens: jest.fn(),
  saveUser: jest.fn(), loadUser: jest.fn(async () => null),
}));
jest.mock("./lastMethod", () => ({ setLastMethod: jest.fn(), getLastMethod: jest.fn() }));

import { useAuthStore, getLastSessionDropReason } from "./authStore";

const store = jest.requireMock("./tokenStore") as { loadTokens: jest.Mock; clearTokens: jest.Mock };

beforeEach(() => {
  store.loadTokens.mockReset();
  store.clearTokens.mockClear();
  useAuthStore.setState({ status: "loading", user: null, pending2fa: null, pendingVerificationEmail: null, error: null });
});

describe("hydrate() when the token store cannot be read", () => {
  const unreadable = () => store.loadTokens.mockRejectedValue(new Error("User interaction is not allowed."));

  it("does not reject, so the app still finishes starting up", async () => {
    unreadable();
    await expect(useAuthStore.getState().hydrate()).resolves.toBeUndefined();
  });

  it("does not leave the app stuck on the loading screen", async () => {
    unreadable();
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).not.toBe("loading");
  });

  // The bit that costs the user their backup: no drop reason means the shell
  // does not purge. See shouldPurgeOnSignOut in ./purge.
  it("records no session drop, so the account purge does not run", async () => {
    unreadable();
    await useAuthStore.getState().hydrate();
    expect(getLastSessionDropReason()).toBeNull();
  });

  it("keeps the stored session rather than clearing it", async () => {
    unreadable();
    await useAuthStore.getState().hydrate();
    expect(store.clearTokens).not.toHaveBeenCalled();
  });
});

describe("hydrate() when the store is readable and genuinely empty", () => {
  it("signs out without recording a drop, since there was no session to lose", async () => {
    store.loadTokens.mockResolvedValue(null);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(getLastSessionDropReason()).toBeNull();
  });
});
