import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { currentDeviceId, ensureDeviceId, isValidDeviceId, DEVICE_ID_HEADER, __resetDeviceId } from "./deviceId";

const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "3f1a9c5e-3b6e-4a0e-9a2b-9d1f8a2c7e41") }));

const secure = SecureStore as jest.Mocked<typeof SecureStore>;
const crypto = Crypto as jest.Mocked<typeof Crypto>;
const KEY = "dosya.device.id";
const UUID = "3f1a9c5e-3b6e-4a0e-9a2b-9d1f8a2c7e41";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  __resetDeviceId();
  secure.setItemAsync.mockImplementation(async (k: string, v: string) => { store[k] = v; });
  secure.getItemAsync.mockImplementation(async (k: string) => (k in store ? store[k] : null));
  crypto.randomUUID.mockImplementation(() => UUID);
  secure.setItemAsync.mockClear();
  secure.getItemAsync.mockClear();
  crypto.randomUUID.mockClear();
});

describe("isValidDeviceId", () => {
  it("matches the bounds the server validates on", () => {
    expect(isValidDeviceId(UUID)).toBe(true);
    expect(isValidDeviceId("a".repeat(8))).toBe(true);
    expect(isValidDeviceId("a".repeat(128))).toBe(true);
    expect(isValidDeviceId("a".repeat(7))).toBe(false);
    expect(isValidDeviceId("a".repeat(129))).toBe(false);
    expect(isValidDeviceId("has space")).toBe(false);
    expect(isValidDeviceId("")).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
  });
});

describe("ensureDeviceId", () => {
  it("mints once and persists it", async () => {
    const id = await ensureDeviceId();
    expect(id).toBe(UUID);
    expect(store[KEY]).toBe(id);
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it("survives a restart", async () => {
    const first = await ensureDeviceId();
    __resetDeviceId(); // a fresh process, same keychain
    crypto.randomUUID.mockImplementation(() => "would-be-a-second-identity-000000000");

    expect(await ensureDeviceId()).toBe(first);
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1); // nothing rewritten
  });

  it("never mints twice when several callers race at startup", async () => {
    const [a, b, c] = await Promise.all([ensureDeviceId(), ensureDeviceId(), ensureDeviceId()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it("replaces a stored value the server would reject", async () => {
    store[KEY] = "no good";
    expect(await ensureDeviceId()).toBe(UUID);
    expect(store[KEY]).toBe(UUID);
  });

  /**
   * The load-bearing pair. A device identity is a nice-to-have and reporting a
   * paused backup is not, so neither an unreadable store nor an unwritable one
   * may throw or come back empty.
   */
  it("still yields an id when the store cannot be read", async () => {
    secure.getItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    expect(isValidDeviceId(await ensureDeviceId())).toBe(true);
  });

  it("still yields an id when the store cannot be written", async () => {
    secure.setItemAsync.mockRejectedValueOnce(new Error("keychain full"));
    const id = await ensureDeviceId();
    expect(isValidDeviceId(id)).toBe(true);
    // ...and it holds for the life of the process, so this run reports one
    // device rather than a new one per request.
    expect(await ensureDeviceId()).toBe(id);
    expect(currentDeviceId()).toBe(id);
  });

  it("falls back to its own generator when the native one is missing", async () => {
    crypto.randomUUID.mockImplementation(() => { throw new Error("no native module"); });
    const original = globalThis.crypto;
    // @ts-expect-error - simulating a runtime with neither generator
    delete globalThis.crypto;
    try {
      expect(isValidDeviceId(await ensureDeviceId())).toBe(true);
    } finally {
      globalThis.crypto = original;
    }
  });
});

describe("currentDeviceId", () => {
  it("is null until the id resolves, so apiRequest omits the header rather than sending a blank one", async () => {
    expect(currentDeviceId()).toBeNull();
    const id = await ensureDeviceId();
    expect(currentDeviceId()).toBe(id);
  });

  it("names the header the server reads", () => {
    expect(DEVICE_ID_HEADER.toLowerCase()).toBe("x-dosya-device");
  });
});
