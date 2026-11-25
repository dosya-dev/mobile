import { readFileSync } from "fs";
import { join } from "path";

jest.mock("expo-media-library", () => ({ requestPermissionsAsync: jest.fn() }));
jest.mock("@/backup/scanner", () => ({ isPhotoAccessLimited: jest.fn(async () => false) }));

import * as MediaLibrary from "expo-media-library";
import { isPhotoAccessLimited } from "@/backup/scanner";
import { requestPhotoAccess } from "./permissions";

beforeEach(() => jest.clearAllMocks());

describe("requestPhotoAccess", () => {
  it("asks the OS exactly once", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    await requestPhotoAccess();
    expect(MediaLibrary.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("reports granted", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    expect(await requestPhotoAccess()).toBe("granted");
  });

  it("reports limited when the OS gave partial access", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (isPhotoAccessLimited as jest.Mock).mockResolvedValue(true);
    expect(await requestPhotoAccess()).toBe("limited");
  });

  it("reports denied", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    expect(await requestPhotoAccess()).toBe("denied");
  });

  it("reports denied rather than throwing when the module is unavailable", async () => {
    (MediaLibrary.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error("no module"));
    expect(await requestPhotoAccess()).toBe("denied");
  });

  // The whole point of the redesign: contacts must never be requested during
  // first run. A mocked module cannot prove this, so assert on the source.
  it("never touches contacts", () => {
    const src = readFileSync(join(__dirname, "permissions.ts"), "utf8");
    expect(src).not.toMatch(/expo-contacts/);
  });
});
