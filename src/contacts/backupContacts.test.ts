import { useUploadStore } from "@/upload/store";

jest.mock("./contactsSource", () => ({
  readAllContacts: jest.fn(async () => [
    { name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", phones: [], emails: [] },
    { name: "Bob", phones: [], emails: [] },
  ]),
}));
jest.mock("@/backup/folders", () => ({ resolveContactsFolder: jest.fn(async () => "folder1") }));
jest.mock("@/upload/controller", () => ({ startUploads: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 321 })),
}));
const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
}));

import * as FileSystem from "expo-file-system/legacy";
import { startUploads } from "@/upload/controller";
import { backupContacts, getLastContactsBackupAt } from "./backupContacts";

beforeEach(() => {
  useUploadStore.setState({ items: [] });
  for (const k of Object.keys(store)) delete store[k];
  jest.clearAllMocks();
});

describe("backupContacts", () => {
  it("writes a dated .vcf, enqueues a text/vcard upload, and starts the queue", async () => {
    const res = await backupContacts("w1");
    expect(res.count).toBe(2);
    expect(res.fileName).toMatch(/^contacts-\d{4}-\d{2}-\d{2}\.vcf$/);

    // wrote the temp file with vCard content
    const writeArgs = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0];
    expect(writeArgs[0]).toBe(`file:///cache/${res.fileName}`);
    expect(writeArgs[1]).toContain("BEGIN:VCARD");

    const items = useUploadStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: res.fileName, uri: `file:///cache/${res.fileName}`, size: 321,
      mime: "text/vcard", folderId: "folder1", workspaceId: "w1", status: "queued", progress: 0,
    });
    expect(items[0].id.startsWith("ct_")).toBe(true);
    expect(startUploads).toHaveBeenCalledTimes(1);
  });

  it("records the last-backup time", async () => {
    expect(await getLastContactsBackupAt()).toBeNull();
    await backupContacts("w1");
    const ts = await getLastContactsBackupAt();
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(0);
  });
});
