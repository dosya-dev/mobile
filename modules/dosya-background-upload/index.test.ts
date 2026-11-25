const mockNative = { stagingUsage: jest.fn(async () => ({ bytes: 0, files: 0 })) };
let mockPresent = true;
jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: jest.fn(() => (mockPresent ? mockNative : null)) }));
import { Platform } from "react-native";
import { backgroundUploadNative, STAGING_MAX_BYTES, STAGING_MAX_FILES } from "./index";

describe("backgroundUploadNative", () => {
  const os = Platform.OS;
  afterEach(() => { (Platform as unknown as { OS: string }).OS = os; mockPresent = true; });
  it("hands back the native module on iOS", () => {
    (Platform as unknown as { OS: string }).OS = "ios";
    expect(backgroundUploadNative()).toBe(mockNative);
  });
  it("is null on Android even when a module of that name exists", () => {
    (Platform as unknown as { OS: string }).OS = "android";
    expect(backgroundUploadNative()).toBeNull();
  });
  it("is null when the native module is absent", () => {
    (Platform as unknown as { OS: string }).OS = "ios"; mockPresent = false;
    expect(backgroundUploadNative()).toBeNull();
  });
  it("publishes the staging budget the orchestrator sizes batches with", () => {
    expect(STAGING_MAX_BYTES).toBe(500 * 1024 * 1024);
    expect(STAGING_MAX_FILES).toBe(200);
  });
});
