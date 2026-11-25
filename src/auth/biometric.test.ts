const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

import { isBiometricAvailable, authenticateBiometric, getBiometricEnabled, setBiometricEnabled } from "./biometric";

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; jest.clearAllMocks(); });

describe("biometric", () => {
  it("is available when hardware present and enrolled", async () => {
    expect(await isBiometricAvailable()).toBe(true);
  });
  it("authenticate returns success flag", async () => {
    expect(await authenticateBiometric()).toBe(true);
  });
  it("pref defaults to false and round-trips", async () => {
    expect(await getBiometricEnabled()).toBe(false);
    await setBiometricEnabled(true);
    expect(await getBiometricEnabled()).toBe(true);
  });
});
