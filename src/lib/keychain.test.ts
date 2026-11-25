/**
 * The keychain wrapper for entries the app touches while the phone is locked.
 *
 * The mock keys its map by (service, key), because the whole point of the
 * wrapper is that its entries live in their own keychain service: that is
 * what lets a fresh SecItemAdd give them AFTER_FIRST_UNLOCK accessibility,
 * where an update of the old entry in place would have kept WHEN_UNLOCKED.
 */
const mockMem = new Map<string, string>();
const mockSlot = (k: string, o?: { keychainService?: string }) => `${o?.keychainService ?? "app"}:${k}`;
// Set to simulate the phone being locked: every read of the DEFAULT service
// (the legacy, WHEN_UNLOCKED entries) fails the way iOS fails it.
let mockLegacyLocked = false;

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "afterFirstUnlock",
  getItemAsync: jest.fn(async (k: string, o?: { keychainService?: string }) => {
    if (mockLegacyLocked && !o?.keychainService) throw new Error("User interaction is not allowed.");
    return mockMem.get(mockSlot(k, o)) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string, o?: { keychainService?: string }) => {
    mockMem.set(mockSlot(k, o), v);
  }),
  deleteItemAsync: jest.fn(async (k: string, o?: { keychainService?: string }) => {
    mockMem.delete(mockSlot(k, o));
  }),
}));

import * as SecureStore from "expo-secure-store";
import { getItem, setItem, deleteItem } from "./keychain";

beforeEach(() => {
  jest.clearAllMocks();
  mockMem.clear();
  mockLegacyLocked = false;
});

const KEY = "dosya.backup.lastRun";

describe("keychain (readable while locked)", () => {
  it("writes under AFTER_FIRST_UNLOCK, in its own service", async () => {
    await setItem(KEY, "1710000000");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      KEY,
      "1710000000",
      expect.objectContaining({ keychainAccessible: "afterFirstUnlock", keychainService: expect.any(String) }),
    );
    const opts = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][2];
    expect(opts.keychainService).not.toBe("app");
  });

  it("reads back what it wrote, and null for nothing", async () => {
    expect(await getItem(KEY)).toBeNull();
    await setItem(KEY, "42");
    expect(await getItem(KEY)).toBe("42");
  });

  it("returns a legacy entry and moves it into the new service, copy before delete", async () => {
    // Written by a build that used the default options (WHEN_UNLOCKED, service "app").
    mockMem.set(mockSlot(KEY), "legacy");

    expect(await getItem(KEY)).toBe("legacy");

    expect(mockMem.get(mockSlot(KEY))).toBeUndefined();
    const setCall = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
    expect(setCall[0]).toBe(KEY);
    expect(setCall[1]).toBe("legacy");
    expect(setCall[2]).toMatchObject({ keychainAccessible: "afterFirstUnlock" });
    const setOrder = (SecureStore.setItemAsync as jest.Mock).mock.invocationCallOrder[0];
    const delOrder = (SecureStore.deleteItemAsync as jest.Mock).mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(delOrder);

    // Migrated: readable with the legacy service now unreadable (phone locked).
    mockLegacyLocked = true;
    expect(await getItem(KEY)).toBe("legacy");
    expect(SecureStore.getItemAsync).toHaveBeenLastCalledWith(KEY, expect.objectContaining({ keychainService: expect.any(String) }));
  });

  it("still hands back the legacy value when the move fails", async () => {
    mockMem.set(mockSlot(KEY), "legacy");
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keychain busy"));

    expect(await getItem(KEY)).toBe("legacy");
    expect(mockMem.get(mockSlot(KEY))).toBe("legacy"); // not deleted: the copy never landed
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("an unmigrated legacy entry is unreadable while locked, exactly as before", async () => {
    mockMem.set(mockSlot(KEY), "legacy");
    mockLegacyLocked = true;
    await expect(getItem(KEY)).rejects.toThrow("User interaction is not allowed.");
  });

  it("deleteItem removes both the new and the legacy entry", async () => {
    mockMem.set(mockSlot(KEY), "legacy");
    await setItem(KEY, "new");
    await deleteItem(KEY);
    expect(mockMem.size).toBe(0);
  });

  it("a write does not shadow a stale legacy entry forever: sign-out clears both", async () => {
    mockMem.set(mockSlot(KEY), "legacy");
    await setItem(KEY, "new");
    expect(await getItem(KEY)).toBe("new");
    await deleteItem(KEY);
    expect(await getItem(KEY)).toBeNull();
  });
});
