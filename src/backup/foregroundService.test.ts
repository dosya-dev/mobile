const mockNative = { start: jest.fn(), update: jest.fn(), stop: jest.fn() };
let mockNativePresent = true;
jest.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: jest.fn(() => (mockNativePresent ? mockNative : null)),
}));

import { Platform } from "react-native";
import { startBackupService, updateBackupService, stopBackupService, isBackupServiceAvailable } from "./foregroundService";

const setOS = (os: string) => { (Platform as unknown as { OS: string }).OS = os; };
const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  mockNativePresent = true;
  setOS("android");
});

afterAll(() => setOS(originalOS));

describe("backup foreground service", () => {
  it("starts the native service on Android", () => {
    startBackupService("Backing up 12 items");
    expect(mockNative.start).toHaveBeenCalledWith("Backing up 12 items");
  });

  it("passes progress as a whole percentage", () => {
    updateBackupService("Backing up", 0.42);
    expect(mockNative.update).toHaveBeenCalledWith("Backing up", 42);
  });

  it("clamps progress into range", () => {
    updateBackupService("Backing up", 1.7);
    expect(mockNative.update).toHaveBeenCalledWith("Backing up", 100);
    updateBackupService("Backing up", -3);
    expect(mockNative.update).toHaveBeenCalledWith("Backing up", 0);
  });

  it("stops the service", () => {
    stopBackupService();
    expect(mockNative.stop).toHaveBeenCalled();
  });

  it("does nothing on iOS", () => {
    setOS("ios");
    startBackupService("x");
    updateBackupService("x", 0.5);
    stopBackupService();
    // iOS keeps a backup alive through BGTaskScheduler and the Live Activity;
    // a foreground service is an Android concept.
    expect(mockNative.start).not.toHaveBeenCalled();
    expect(mockNative.update).not.toHaveBeenCalled();
    expect(mockNative.stop).not.toHaveBeenCalled();
  });

  it("survives a missing native module (Expo Go)", () => {
    mockNativePresent = false;
    // A backup must never fail because a notification could not be shown.
    expect(() => startBackupService("x")).not.toThrow();
    expect(() => updateBackupService("x", 0.1)).not.toThrow();
    expect(() => stopBackupService()).not.toThrow();
  });

  it("survives the native call throwing", () => {
    mockNative.start.mockImplementation(() => { throw new Error("no permission"); });
    expect(() => startBackupService("x")).not.toThrow();
  });

  it("reports availability so callers can explain the limitation", () => {
    expect(isBackupServiceAvailable()).toBe(true);
    setOS("ios");
    expect(isBackupServiceAvailable()).toBe(false);
  });
});
