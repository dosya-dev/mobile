const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));
jest.mock("expo-local-authentication", () => ({}));

import {
  clearAppLock, getFailedTries, getLockAfter, hasPin, isValidPin, onAppLockChange, resetFailedTries,
  setBiometricUnlock, setLockAfter, setPin, verifyPin, DEFAULT_LOCK_AFTER, MAX_PIN_TRIES,
} from "./appLock";
import { getBiometricEnabled } from "./biometric";

beforeEach(() => mockMem.clear());

describe("appLock", () => {
  it("accepts only six digits", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    expect(isValidPin("12345a")).toBe(false);
  });

  it("stores a salted hash, never the PIN", async () => {
    await setPin("482913");
    expect(await hasPin()).toBe(true);
    const stored = mockMem.get("dosya.applock.pin")!;
    expect(stored).not.toContain("482913");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it("verifies the right PIN and rejects a wrong one", async () => {
    await setPin("482913");
    expect(await verifyPin("482913")).toEqual({ ok: true });
    expect(await verifyPin("000000")).toEqual({ ok: false, triesLeft: MAX_PIN_TRIES - 1 });
  });

  it("counts wrong tries across calls and resets on success", async () => {
    await setPin("482913");
    await verifyPin("000000");
    await verifyPin("000000");
    expect(await getFailedTries()).toBe(2);
    await verifyPin("482913");
    expect(await getFailedTries()).toBe(0);
  });

  it("reaches zero tries left at the limit", async () => {
    await setPin("482913");
    let last;
    for (let i = 0; i < MAX_PIN_TRIES; i++) last = await verifyPin("000000");
    expect(last).toEqual({ ok: false, triesLeft: 0 });
  });

  it("refuses even the right PIN once the limit is reached", async () => {
    await setPin("482913");
    mockMem.set("dosya.applock.fails", String(MAX_PIN_TRIES));
    expect(await verifyPin("482913")).toEqual({ ok: false, triesLeft: 0 });
  });

  it("a passed biometric check clears the wrong-try count", async () => {
    await setPin("482913");
    await verifyPin("000000");
    await resetFailedTries();
    expect(await getFailedTries()).toBe(0);
  });

  it("defaults Lock after to one minute and ignores unknown values", async () => {
    expect(await getLockAfter()).toBe(DEFAULT_LOCK_AFTER);
    await setLockAfter(0);
    expect(await getLockAfter()).toBe(0);
    mockMem.set("dosya.applock.after", "42");
    expect(await getLockAfter()).toBe(DEFAULT_LOCK_AFTER);
  });

  it("clearAppLock removes the PIN, biometric unlock, timer and try count", async () => {
    await setPin("482913");
    await setBiometricUnlock(true);
    await setLockAfter(300);
    await verifyPin("000000");
    await clearAppLock();
    expect(await hasPin()).toBe(false);
    expect(await getBiometricEnabled()).toBe(false);
    expect(await getLockAfter()).toBe(DEFAULT_LOCK_AFTER);
    expect(await getFailedTries()).toBe(0);
  });

  it("tells listeners about every change", async () => {
    const fn = jest.fn();
    const off = onAppLockChange(fn);
    await setPin("482913");
    await setLockAfter(900);
    await setBiometricUnlock(true);
    await clearAppLock();
    expect(fn).toHaveBeenCalledTimes(4);
    off();
    await setPin("111111");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
