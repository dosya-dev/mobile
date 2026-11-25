// Read settings: when this phone reads (mode) and whether it may use mobile data. Kept in the keychain.
const mockStore = new Map<string, string>();
const mockHold: { gate: Promise<void> | null } = { gate: null };
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async (k: string) => {
    const v = mockStore.get(k) ?? null;
    if (k === "dosya.personas.read-anywhere" && mockHold.gate) await mockHold.gate;
    return v;
  }),
  setItem: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); }),
  deleteItem: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));

import {
  askNotificationsOnce, loadReadSettings, MOBILE_DATA_KEY, NOTIFICATIONS_ASKED_KEY, READ_MODE_KEY, readSettings, resetReadSettings,
  setMobileData, setReadMode, subscribeReadSettings,
} from "./settings";

const OLD_KEY = "dosya.personas.read-anywhere";
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(async () => { mockHold.gate = null; mockStore.clear(); await resetReadSettings(); });

describe("read settings", () => {
  it("defaults to charging and Wi-Fi only", async () => {
    expect(readSettings()).toEqual({ mode: "charging", mobileData: false });
    expect(await loadReadSettings()).toEqual({ mode: "charging", mobileData: false });
  });

  it('read-anywhere "1" migrates to anytime + mobile data once and deletes the old key', async () => {
    mockStore.set(OLD_KEY, "1");
    expect(await loadReadSettings()).toEqual({ mode: "anytime", mobileData: true });
    expect(mockStore.get(READ_MODE_KEY)).toBe("anytime");
    expect(mockStore.get(MOBILE_DATA_KEY)).toBe("1");
    expect(mockStore.has(OLD_KEY)).toBe(false);
  });

  it("an existing new key beats the legacy key (migrates once)", async () => {
    mockStore.set(READ_MODE_KEY, "open");
    mockStore.set(OLD_KEY, "1");
    expect((await loadReadSettings()).mode).toBe("open");
    expect(mockStore.get(READ_MODE_KEY)).toBe("open");
  });

  it("reset during a migrating load leaves nothing stored", async () => {
    mockStore.set(OLD_KEY, "1");
    let release!: () => void;
    mockHold.gate = new Promise<void>((r) => { release = r; });
    const p = loadReadSettings();
    await flush();
    await resetReadSettings();
    release();
    await p;
    await flush();
    expect([...mockStore.keys()]).toEqual([]);
    expect(readSettings()).toEqual({ mode: "charging", mobileData: false });
  });

  it("a set during a migrating load keeps the user's value on disk", async () => {
    mockStore.set(OLD_KEY, "1");
    let release!: () => void;
    mockHold.gate = new Promise<void>((r) => { release = r; });
    const p = loadReadSettings();
    await flush();
    setReadMode("open");
    setMobileData(false);
    release();
    await p;
    await flush();
    expect(mockStore.get(READ_MODE_KEY)).toBe("open");
    expect(mockStore.get(MOBILE_DATA_KEY)).toBe("0");
    expect(readSettings()).toEqual({ mode: "open", mobileData: false });
  });

  it("set before load persists even when equal to the default", async () => {
    setReadMode("charging");
    setMobileData(false);
    await flush();
    expect(mockStore.get(READ_MODE_KEY)).toBe("charging");
    expect(mockStore.get(MOBILE_DATA_KEY)).toBe("0");
  });

  it("a set before load wins", async () => {
    mockStore.set(READ_MODE_KEY, "anytime");
    mockStore.set(MOBILE_DATA_KEY, "1");
    const p = loadReadSettings();
    setReadMode("open");
    await p;
    expect(readSettings()).toEqual({ mode: "open", mobileData: true });
  });

  it("stored values survive reload", async () => {
    const fn = jest.fn();
    const off = subscribeReadSettings(fn);
    setReadMode("anytime");
    setMobileData(true);
    expect(fn).toHaveBeenCalledTimes(2);
    await flush();
    expect(mockStore.get(READ_MODE_KEY)).toBe("anytime");
    expect(mockStore.get(MOBILE_DATA_KEY)).toBe("1");
    off();
    // Fresh in-memory state, same keychain.
    const saved = new Map(mockStore);
    await resetReadSettings();
    for (const [k, v] of saved) mockStore.set(k, v);
    expect(await loadReadSettings()).toEqual({ mode: "anytime", mobileData: true });
  });

  it("reset clears all keys and announces", async () => {
    mockStore.set(OLD_KEY, "1");
    mockStore.set(NOTIFICATIONS_ASKED_KEY, "1");
    setReadMode("open");
    setMobileData(true);
    await flush();
    const fn = jest.fn();
    subscribeReadSettings(fn);
    await resetReadSettings();
    expect(readSettings()).toEqual({ mode: "charging", mobileData: false });
    expect([...mockStore.keys()]).toEqual([]);
    expect(fn).toHaveBeenCalled();
  });

  it("unknown stored mode reads as charging", async () => {
    mockStore.set(READ_MODE_KEY, "bogus");
    expect((await loadReadSettings()).mode).toBe("charging");
  });

  describe("askNotificationsOnce", () => {
    it("asks once, remembers it in the keychain, and asks again after a reset", async () => {
      const ask = jest.fn(async () => true);
      expect(await askNotificationsOnce(ask)).toBe(true);
      expect(mockStore.get(NOTIFICATIONS_ASKED_KEY)).toBe("1");
      expect(await askNotificationsOnce(ask)).toBe(false);
      expect(ask).toHaveBeenCalledTimes(1);
      await resetReadSettings();
      expect(mockStore.has(NOTIFICATIONS_ASKED_KEY)).toBe(false);
      expect(await askNotificationsOnce(ask)).toBe(true);
      expect(ask).toHaveBeenCalledTimes(2);
    });

    it("two quick choices ask once", async () => {
      const ask = jest.fn(async () => true);
      const [a, b] = await Promise.all([askNotificationsOnce(ask), askNotificationsOnce(ask)]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(ask).toHaveBeenCalledTimes(1);
    });

    it("a flag stored by an earlier session means no ask", async () => {
      mockStore.set(NOTIFICATIONS_ASKED_KEY, "1");
      const ask = jest.fn(async () => true);
      expect(await askNotificationsOnce(ask)).toBe(false);
      expect(ask).not.toHaveBeenCalled();
    });
  });
});
