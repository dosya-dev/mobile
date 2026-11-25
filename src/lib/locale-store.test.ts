import { readLocalePreference, writeLocalePreference, LOCALE_STORAGE_KEY } from "./locale-store";

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock("@/lib/keychain", () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: (...a: unknown[]) => mockSetItem(...a),
}));

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
});
afterEach(() => jest.useRealTimers());

describe("readLocalePreference", () => {
  it.each(["xx", "", "tr ", "ur", "{", "TR", "be"])("treats %j as device", async (raw) => {
    mockGetItem.mockResolvedValue(raw);
    expect(await readLocalePreference()).toBe("device");
  });

  it("is device when nothing is stored", async () => {
    mockGetItem.mockResolvedValue(null);
    expect(await readLocalePreference()).toBe("device");
  });

  it("is device when the keychain throws (a locked phone)", async () => {
    mockGetItem.mockRejectedValue(new Error("User interaction is not allowed"));
    expect(await readLocalePreference()).toBe("device");
  });

  it("is device when the keychain throws synchronously", async () => {
    mockGetItem.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await readLocalePreference()).toBe("device");
  });

  it("is device after 1,500 ms when the keychain never answers", async () => {
    jest.useFakeTimers();
    mockGetItem.mockReturnValue(new Promise(() => {}));
    let done: string | null = null;
    const p = readLocalePreference().then((v) => (done = v));
    await jest.advanceTimersByTimeAsync(1499);
    expect(done).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe("device");
  });

  it("returns a stored shipped language, device, and English", async () => {
    for (const v of ["tr", "pt-BR", "zh-Hant", "device", "en"]) {
      mockGetItem.mockResolvedValue(v);
      expect(await readLocalePreference()).toBe(v);
    }
  });

  it("reads the dosya.locale entry", async () => {
    mockGetItem.mockResolvedValue("de");
    await readLocalePreference();
    expect(mockGetItem).toHaveBeenCalledWith("dosya.locale");
    expect(LOCALE_STORAGE_KEY).toBe("dosya.locale");
  });
});

describe("writeLocalePreference", () => {
  it("writes and reads back", async () => {
    let stored: string | null = null;
    mockSetItem.mockImplementation(async (_k: string, v: string) => {
      stored = v;
    });
    mockGetItem.mockImplementation(async () => stored);
    await writeLocalePreference("de");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "de");
    expect(await readLocalePreference()).toBe("de");
  });

  it("swallows a keychain failure", async () => {
    mockSetItem.mockRejectedValue(new Error("locked"));
    await expect(writeLocalePreference("tr")).resolves.toBeUndefined();
  });
});
