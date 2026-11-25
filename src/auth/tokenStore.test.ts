import { saveTokens, loadTokens, clearTokens } from "./tokenStore";

const store: Record<string, string> = {};
// Writes throw once a save has already made this many. Models the store going
// away partway through a multi-write save (process killed, keychain locked).
let mockFailWritesAfter = Infinity;
let mockWritesThisSave = 0;

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "afterFirstUnlock",
  WHEN_UNLOCKED: "whenUnlocked",
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockWritesThisSave >= mockFailWritesAfter) throw new Error("User interaction is not allowed.");
    mockWritesThisSave++;
    store[k] = v;
  }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));

const SecureStore = require("expo-secure-store");

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mockFailWritesAfter = Infinity;
  mockWritesThisSave = 0;
  (SecureStore.setItemAsync as jest.Mock).mockClear();
});

describe("tokenStore", () => {
  it("returns null when nothing is stored", async () => {
    expect(await loadTokens()).toBeNull();
  });

  it("round-trips a token pair", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    expect(await loadTokens()).toEqual({ access: "dosm_a", refresh: "dosr_b" });
  });

  it("clears the stored pair", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });
    await clearTokens();
    expect(await loadTokens()).toBeNull();
  });

  /**
   * The pair used to be two independent SecureStore writes. A process killed
   * between them - routine for a backgrounded app mid-backup - left disk
   * holding the NEW access token beside the OLD refresh token, and loadTokens
   * handed that mix back as if it were a real session. The refresh token in it
   * is a generation behind, and the server's prev-token grace is only one
   * generation deep, so the next rotation past it earns a 401 and signs the
   * user out.
   */
  it("never leaves a half-written pair when the store fails mid-save", async () => {
    await saveTokens({ access: "dosm_gen1", refresh: "dosr_gen1" });

    // The save gets one write in and then the store goes away. Whether that
    // fails the save at all is the implementation's business - a save that
    // needs a single write simply survives it.
    mockWritesThisSave = 0;
    mockFailWritesAfter = 1;
    await saveTokens({ access: "dosm_gen2", refresh: "dosr_gen2" }).catch(() => {});

    // Whichever generation survived, both halves must come from the SAME one.
    // A mix is a refresh token one generation behind its access token, and the
    // server's prev-token grace is only one generation deep.
    const loaded = await loadTokens();
    expect(loaded).not.toBeNull();
    const generation = (token: string) => token.split("_")[1];
    expect(generation(loaded!.access)).toBe(generation(loaded!.refresh));
  });

  /**
   * iOS keychain items default to WHEN_UNLOCKED, which makes them unreadable
   * while the device is locked - exactly when a background backup runs. The
   * tokens must survive a locked screen, so they are stored AFTER_FIRST_UNLOCK.
   */
  it("stores the pair so it stays readable while the device is locked", async () => {
    await saveTokens({ access: "dosm_a", refresh: "dosr_b" });

    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    for (const call of (SecureStore.setItemAsync as jest.Mock).mock.calls) {
      expect(call[2]).toMatchObject({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    }
  });

  /** Installs that predate the single-key layout must not be signed out by an update. */
  it("reads a pair written by an older build's two-key layout", async () => {
    store["dosya.access"] = "dosm_legacy";
    store["dosya.refresh"] = "dosr_legacy";

    expect(await loadTokens()).toEqual({ access: "dosm_legacy", refresh: "dosr_legacy" });
  });

  it("does not resurrect a legacy pair after the session is cleared", async () => {
    store["dosya.access"] = "dosm_legacy";
    store["dosya.refresh"] = "dosr_legacy";
    await loadTokens();

    await clearTokens();

    expect(await loadTokens()).toBeNull();
  });
});
