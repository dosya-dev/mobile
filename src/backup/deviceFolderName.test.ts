import { chooseDeviceFolderName } from "./deviceFolderName";

const id = "3f9a1c2e-7b4d-4e0f-9a1b-2c3d4e5f6a7b";

describe("chooseDeviceFolderName", () => {
  it("keeps a user-chosen name", () => {
    expect(chooseDeviceFolderName({ deviceName: "Firat's iPhone", modelName: "iPhone 15 Pro", installationId: id })).toBe("Firat's iPhone");
  });

  it("suffixes a generic iOS 16+ name with the installation id", () => {
    // Without the com.apple.developer.device-information.user-assigned-device-name
    // entitlement every iPhone reports itself as just "iPhone". Two such phones
    // in one workspace would share a folder and version each other's IMG_1234.
    expect(chooseDeviceFolderName({ deviceName: "iPhone", modelName: "iPhone 15 Pro", installationId: id })).toBe("iPhone 15 Pro 3f9a1c");
  });

  it("suffixes when the name is just the model", () => {
    expect(chooseDeviceFolderName({ deviceName: "Pixel 8", modelName: "Pixel 8", installationId: id })).toBe("Pixel 8 3f9a1c");
  });

  it("falls back to a model-less generic name", () => {
    expect(chooseDeviceFolderName({ deviceName: null, modelName: null, installationId: id })).toBe("My Phone 3f9a1c");
  });

  it("never produces a name with path separators", () => {
    expect(chooseDeviceFolderName({ deviceName: "a/b\\c", modelName: null, installationId: id })).toBe("a-b-c");
  });
});
