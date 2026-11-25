import * as SecureStore from "expo-secure-store";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});

import {
  EMPTY_ONBOARDING, readOnboarding, writeOnboarding, clearOnboarding,
  hasSeenWelcome, setWelcomeSeen, __writeQueueSize,
} from "./onboardingState";

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

// jest.clearAllMocks() only clears CALL DATA - an implementation installed by
// mockRejectedValue/mockImplementation survives into every later test in the
// file (this repo's jest config sets neither clearMocks nor resetMocks). The
// throwing tests below would otherwise poison everything that follows them, so
// the backing implementations are reinstalled here rather than assumed intact.
beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  for (const fn of [SecureStore.getItemAsync, SecureStore.setItemAsync, SecureStore.deleteItemAsync]) {
    (fn as jest.Mock).mockReset();
  }
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => { store.set(k, v); });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => { store.delete(k); });
});

describe("onboardingState", () => {
  it("returns the empty shape for an account that has never onboarded", async () => {
    expect(await readOnboarding("acct-1")).toEqual(EMPTY_ONBOARDING);
  });

  it("round-trips a patch without dropping untouched fields", async () => {
    await writeOnboarding("acct-1", { photoPermission: "granted" });
    await writeOnboarding("acct-1", { completedAt: 1234 });
    expect(await readOnboarding("acct-1")).toEqual({
      version: 1, completedAt: 1234, skippedAt: null, photoPermission: "granted",
    });
  });

  it("keeps accounts isolated", async () => {
    await writeOnboarding("acct-1", { completedAt: 1234 });
    expect(await readOnboarding("acct-2")).toEqual(EMPTY_ONBOARDING);
  });

  it("clears one account without touching another", async () => {
    await writeOnboarding("acct-1", { completedAt: 1 });
    await writeOnboarding("acct-2", { completedAt: 2 });
    await clearOnboarding("acct-1");
    expect(await readOnboarding("acct-1")).toEqual(EMPTY_ONBOARDING);
    expect((await readOnboarding("acct-2")).completedAt).toBe(2);
  });

  it("migrates a legacy install so upgraders never see first run again", async () => {
    store.set("dosya.onboarding.completed", "1");
    const s = await readOnboarding("acct-1");
    expect(s.completedAt).not.toBeNull();
  });

  it("does not migrate when the legacy flag is absent", async () => {
    expect((await readOnboarding("acct-1")).completedAt).toBeNull();
  });

  it("migrates only the first account, never every later one", async () => {
    store.set("dosya.onboarding.completed", "1");
    const first = await readOnboarding("acct-1");
    expect(first.completedAt).not.toBeNull();
    // A genuinely new account on the same device must still get first run.
    expect(await readOnboarding("acct-2")).toEqual(EMPTY_ONBOARDING);
  });

  it("tracks the welcome deck device-wide, not per account", async () => {
    expect(await hasSeenWelcome()).toBe(false);
    await setWelcomeSeen();
    expect(await hasSeenWelcome()).toBe(true);
  });

  it("resolves 'seen' rather than rejecting when SecureStore itself throws", async () => {
    // Unlike readOnboarding, this had no try/catch: a rejection here left the
    // caller's state stuck forever (see app/_layout.tsx's welcomeSeen, which
    // starts null and only leaves null once this promise settles). Chosen
    // default is "seen" - an unreadable flag sends a signed-out user to
    // login (reachable, safe) rather than risking the deck showing when the
    // device may have already seen it. The cost is losing the deck once for
    // a device that hit a transient SecureStore failure at exactly this read.
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(hasSeenWelcome()).resolves.toBe(true);
  });

  it("survives corrupt stored JSON", async () => {
    store.set("dosya.onboarding.v1.acct-1", "{not json");
    expect(await readOnboarding("acct-1")).toEqual(EMPTY_ONBOARDING);
  });

  it("never throws at the gate, even when SecureStore itself throws during legacy migration", async () => {
    // First call: the account key lookup, which finds nothing (a fresh
    // account) and falls through to migrateLegacy. Second call: migrateLegacy's
    // OWN SecureStore read (the legacy device-wide flag), which is the one
    // that must be inside the try/catch too - readOnboarding's own doc-comment
    // says it must never throw at a gate that renders the whole app.
    (SecureStore.getItemAsync as jest.Mock)
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => { throw new Error("keychain unavailable"); });
    await expect(readOnboarding("acct-1")).resolves.toEqual(EMPTY_ONBOARDING);
  });

  it("does not lose a concurrent patch to the same account", async () => {
    await Promise.all([
      writeOnboarding("acct-1", { photoPermission: "granted" }),
      writeOnboarding("acct-1", { completedAt: 42 }),
    ]);
    const s = await readOnboarding("acct-1");
    expect(s.photoPermission).toBe("granted");
    expect(s.completedAt).toBe(42);
  });
});

// The module-wide rule (see onboardingState.ts's header): NOTHING exported
// here rejects. Every caller gates a user-visible render or navigation on one
// of these promises, so a rejection removes the user's only way forward and a
// restart reproduces it. These pin the rule itself, one function at a time,
// rather than trusting each call site to remember a .catch.
describe("onboardingState error contract - nothing here ever rejects", () => {
  const throwEverything = () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error("keychain unavailable"));
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error("keychain unavailable"));
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error("keychain unavailable"));
  };

  it("setWelcomeSeen resolves instead of stranding the deck with both exits dead", async () => {
    // welcome.tsx's leave() awaits this BEFORE router.replace, and the deck was
    // entered by replace, so a rejection means no navigation and no back.
    throwEverything();
    await expect(setWelcomeSeen()).resolves.toBeUndefined();
  });

  it("writeOnboarding resolves with the merged state instead of rejecting", async () => {
    // A rejection makes "Not now", "Continue", "Skip for now", the final
    // "Done" and the Backup tab's "Finish setup" permanent no-ops. Degrading
    // to "onboarding re-runs next launch" is recoverable; stranding is not.
    throwEverything();
    await expect(writeOnboarding("acct-1", { completedAt: 7 })).resolves.toEqual({
      version: 1, completedAt: 7, skippedAt: null, photoPermission: "unasked",
    });
  });

  it("keeps writing for the same account after a failed write, rather than wedging the queue", async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain unavailable"));
    await writeOnboarding("acct-1", { completedAt: 7 });
    await writeOnboarding("acct-1", { skippedAt: 9 });
    expect((await readOnboarding("acct-1")).skippedAt).toBe(9);
  });

  it("clearOnboarding resolves instead of rejecting at a sign-out purge", async () => {
    throwEverything();
    await expect(clearOnboarding("acct-1")).resolves.toBeUndefined();
  });

  it("readOnboarding still resolves to the empty state", async () => {
    throwEverything();
    await expect(readOnboarding("acct-1")).resolves.toEqual(EMPTY_ONBOARDING);
  });

  it("hasSeenWelcome still resolves", async () => {
    throwEverything();
    await expect(hasSeenWelcome()).resolves.toBe(true);
  });
});

describe("clearOnboarding shares the write queue", () => {
  it("cannot be undone by a write that was already in flight", async () => {
    // purge (sign-out) used to delete straight from SecureStore, bypassing the
    // queue. An un-awaited write that had already read its state could then
    // land its `set` AFTER the delete and resurrect the key - so the next
    // sign-in saw completedAt, skipped onboarding, and ran against wiped
    // settings, ledger and workspace: the exact pre-redesign failure.
    await writeOnboarding("acct-1", { completedAt: 5 });

    let land!: () => void;
    let setIssued!: () => void;
    const setInFlight = new Promise<void>((r) => { setIssued = r; });
    (SecureStore.setItemAsync as jest.Mock).mockImplementationOnce(
      (k: string, v: string) =>
        new Promise<void>((resolve) => {
          land = () => { store.set(k, v); resolve(); };
          setIssued();
        }),
    );

    const write = writeOnboarding("acct-1", { photoPermission: "granted" });
    // The write has now READ its state and issued its set, which is still
    // pending: precisely the window the purge used to slip into.
    await setInFlight;
    const cleared = clearOnboarding("acct-1");
    land();
    await Promise.all([write, cleared]);

    expect(await readOnboarding("acct-1")).toEqual(EMPTY_ONBOARDING);
  });

  it("prunes its queue entry, so the map does not grow one per account forever", async () => {
    await writeOnboarding("acct-1", { completedAt: 1 });
    await clearOnboarding("acct-1");
    // Nothing observable is left behind: a later write for the same account
    // starts from the empty state, not from a retained tail.
    expect(await readOnboarding("acct-1")).toEqual(EMPTY_ONBOARDING);
    expect(__writeQueueSize()).toBe(0);
  });
});
