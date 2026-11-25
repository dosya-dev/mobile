jest.mock("expo-device", () => ({ deviceName: "Pixel", modelName: "Pixel 8" }));
jest.mock("@/lib/deviceId", () => ({ ensureDeviceId: async () => "abcdef0123456789" }));
const created: { parent: string | null; name: string }[] = [];
jest.mock("@/files/mutations", () => ({ createFolder: jest.fn(async (_ws: string, parent: string | null, name: string) => { created.push({ parent, name }); }) }));
// listFiles returns existing children so the resolver can find-or-create.
jest.mock("@/files/api", () => ({
  listFiles: jest.fn(async ({ folderId }: any) => ({ folders: created.filter((c) => c.parent === (folderId ?? null)).map((c) => ({ id: `${c.name}#${c.parent}`, name: c.name })), files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } })),
}));

import { resolveBackupFolder, resolveContactsFolder, findContactsFolder } from "./folders";

beforeEach(() => { created.length = 0; });

describe("resolveBackupFolder", () => {
  it("creates the Mobile Backup/<device>/Camera Roll/YYYY/MM chain", async () => {
    const captured = Math.floor(new Date("2024-03-15T10:00:00Z").getTime() / 1000);
    const leaf = await resolveBackupFolder("w1", captured);
    const names = created.map((c) => c.name);
    expect(names).toEqual(["Mobile Backup", "Pixel", "Camera Roll", "2024", "03"]);
    expect(typeof leaf).toBe("string");
  });

  it("gives a generic iPhone its own folder per installation", async () => {
    jest.resetModules();
    // doMock outlives resetModules, so the Pixel factory is put back in
    // finally; the later re-require tests expect it.
    jest.doMock("expo-device", () => ({ deviceName: "iPhone", modelName: "iPhone 15" }));
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolveBackupFolder: resolve } = require("./folders");
      await resolve("w1", Math.floor(new Date("2024-03-15T10:00:00Z").getTime() / 1000));
      expect(created.map((c) => c.name)).toEqual(["Mobile Backup", "iPhone 15 abcdef", "Camera Roll", "2024", "03"]);
    } finally {
      jest.doMock("expo-device", () => ({ deviceName: "Pixel", modelName: "Pixel 8" }));
    }
  });

  it("files a photo by local time, not UTC", async () => {
    // A 9am 1 January photo in Sydney or Istanbul is still 31 December in UTC,
    // and the old code filed it under the previous year's December folder.
    // Rather than depend on the machine's timezone, pin the getters directly:
    // the chain must follow the local ones and ignore their UTC counterparts.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveBackupFolder: resolve } = require("./folders");
    const spies = [
      jest.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026),
      jest.spyOn(Date.prototype, "getMonth").mockReturnValue(0),
      jest.spyOn(Date.prototype, "getUTCFullYear").mockReturnValue(2025),
      jest.spyOn(Date.prototype, "getUTCMonth").mockReturnValue(11),
    ];
    try {
      await resolve("w1", 1_767_222_000);
      expect(created.map((c) => c.name)).toEqual(["Mobile Backup", "Pixel", "Camera Roll", "2026", "01"]);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe("resolveContactsFolder", () => {
  it("creates the Mobile Backup/<device>/Contacts chain", async () => {
    // Fresh module instance: the previous describe block already populated
    // this module's singleton `cache` for "Mobile Backup"/"Pixel", which
    // would short-circuit those segments here. jest.resetModules() +
    // require (this project's jest-expo/babel-jest setup doesn't support
    // top-level `await import()`) gives a clean cache for this test.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveContactsFolder } = require("./folders");
    const leaf = await resolveContactsFolder("w1");
    const names = created.map((c) => c.name);
    expect(names).toEqual(["Mobile Backup", "Pixel", "Contacts"]);
    expect(typeof leaf).toBe("string");
  });
});

describe("findContactsFolder (read-only)", () => {
  it("returns null when the Contacts chain does not exist", async () => {
    jest.resetModules();
    const { findContactsFolder: find } = require("./folders");
    expect(await find("w1")).toBeNull();
  });

  it("finds a contacts backup made before per-installation folders, under the legacy generic name", async () => {
    // Every un-entitled iPhone used to back up into "Mobile Backup/iPhone".
    // After the folder rename the restore must still find that backup, or
    // every existing user sees "No contacts backup found".
    jest.resetModules();
    jest.doMock("expo-device", () => ({ deviceName: "iPhone", modelName: "iPhone 15" }));
    try {
      created.push({ parent: null, name: "Mobile Backup" });
      created.push({ parent: "Mobile Backup#null", name: "iPhone" });
      created.push({ parent: "iPhone#Mobile Backup#null", name: "Contacts" });
      const { findContactsFolder: find } = require("./folders");
      expect(await find("w1")).toBe("Contacts#iPhone#Mobile Backup#null");
    } finally {
      jest.doMock("expo-device", () => ({ deviceName: "Pixel", modelName: "Pixel 8" }));
    }
  });

  it("finds a contacts backup made by another installation of the same model", async () => {
    // A new phone, or a reinstall, mints a new installation id, so its own
    // folder is empty. Restore is exactly the moment that matters.
    jest.resetModules();
    jest.doMock("expo-device", () => ({ deviceName: "iPhone", modelName: "iPhone 15" }));
    try {
      created.push({ parent: null, name: "Mobile Backup" });
      created.push({ parent: "Mobile Backup#null", name: "iPhone 15 zzzzzz" });
      created.push({ parent: "iPhone 15 zzzzzz#Mobile Backup#null", name: "Contacts" });
      const { findContactsFolder: find } = require("./folders");
      expect(await find("w1")).toBe("Contacts#iPhone 15 zzzzzz#Mobile Backup#null");
    } finally {
      jest.doMock("expo-device", () => ({ deviceName: "Pixel", modelName: "Pixel 8" }));
    }
  });

  it("returns the leaf id when the chain exists, without creating folders", async () => {
    jest.resetModules();
    const mod = require("./folders");
    await mod.resolveContactsFolder("w1"); // creates Mobile Backup/<device>/Contacts
    const before = created.length;
    const leaf = await mod.findContactsFolder("w1");
    expect(typeof leaf).toBe("string");
    expect(created.length).toBe(before); // read-only: no new folders
  });
});
