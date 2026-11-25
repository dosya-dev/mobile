const mockPerms = { granted: false, canAskAgain: true };
const mockRequestPermissions = jest.fn(async () => ({ granted: true }));
const mockGetToken = jest.fn(async () => ({ data: "ExponentPushToken[abc]" }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ ...mockPerms })),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...(a as [])),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...(a as [])),
}));
jest.mock("expo-device", () => ({ isDevice: true, deviceName: "Ayse's iPhone" }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "proj_1" } } } },
}));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
// The language runtime needs the real react-native; push only needs t() for its two reasons.
jest.mock("@/lib/i18n", () => ({ t: (key: string) => key }));
const mockRegisterDevice = jest.fn(async () => {});
const mockUnregisterDevice = jest.fn(async () => {});
jest.mock("./api", () => ({
  registerPushDevice: (...a: unknown[]) => mockRegisterDevice(...(a as [])),
  unregisterPushDevice: (...a: unknown[]) => mockUnregisterDevice(...(a as [])),
}));

const mockSecureStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecureStore[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in mockSecureStore ? mockSecureStore[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecureStore[k]; }),
}));

import { syncPushRegistration, registerForPush, PUSH_PROMPTED_KEY } from "./push";

/**
 * Why this exists: production held no ios/android push row at all on
 * 2026-09-27. The only call to register a device sat behind the Push switch on
 * the notification-settings screen, and that switch already read as "on", so
 * the one gesture that would have registered a phone was turning it off and on
 * again. Registration now runs when a session starts; these tests pin the
 * permission etiquette around it.
 */
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockSecureStore)) delete mockSecureStore[k];
  mockPerms.granted = false;
  mockPerms.canAskAgain = true;
});

describe("syncPushRegistration", () => {
  it("registers the token without asking when permission is already granted", async () => {
    mockPerms.granted = true;
    const res = await syncPushRegistration("silent");
    expect(res).toEqual({ kind: "registered", token: "ExponentPushToken[abc]" });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetToken).toHaveBeenCalledWith({ projectId: "proj_1" });
    expect(mockRegisterDevice).toHaveBeenCalledWith("ExponentPushToken[abc]", "ios", "Ayse's iPhone");
  });

  it("silent mode never shows the OS prompt", async () => {
    const res = await syncPushRegistration("silent");
    expect(res).toEqual({ kind: "denied" });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockRegisterDevice).not.toHaveBeenCalled();
  });

  it("prompt-once asks the first time and remembers that it did", async () => {
    const first = await syncPushRegistration("prompt-once");
    expect(first.kind).toBe("registered");
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockSecureStore[PUSH_PROMPTED_KEY]).toBe("1");

    // A later session on a device that said no is not asked again - a prompt
    // that comes back on every launch is how apps get notifications disabled
    // in Settings for good.
    const second = await syncPushRegistration("prompt-once");
    expect(second).toEqual({ kind: "denied" });
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it("prompt mode asks every time it can - the settings switch is an explicit request", async () => {
    mockSecureStore[PUSH_PROMPTED_KEY] = "1";
    const res = await registerForPush();
    expect(res.kind).toBe("registered");
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it("reports denied, not registered, when the OS refuses", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ granted: false });
    const res = await syncPushRegistration("prompt");
    expect(res).toEqual({ kind: "denied" });
    expect(mockRegisterDevice).not.toHaveBeenCalled();
  });

  it("does not ask when the OS says it cannot ask again", async () => {
    mockPerms.canAskAgain = false;
    const res = await syncPushRegistration("prompt");
    expect(res).toEqual({ kind: "denied" });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});
