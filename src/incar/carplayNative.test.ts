import { Platform } from "react-native";
import { isCarPlaySupported, getCarPlayModule } from "./carplayNative";

describe("carplayNative", () => {
  afterEach(() => {
    Platform.OS = "ios";
  });

  it("reports supported on iOS", () => {
    Platform.OS = "ios";
    expect(isCarPlaySupported()).toBe(true);
  });

  it("reports unsupported on android", () => {
    Platform.OS = "android";
    expect(isCarPlaySupported()).toBe(false);
  });

  it("throws instead of touching the native module on android", () => {
    Platform.OS = "android";
    expect(() => getCarPlayModule()).toThrow("CarPlay is iOS-only");
  });

  it("returns the (mocked) module on iOS", () => {
    Platform.OS = "ios";
    const mod = getCarPlayModule();
    expect(mod.CarPlay).toBeDefined();
    expect(mod.ListTemplate).toBeDefined();
  });
});
