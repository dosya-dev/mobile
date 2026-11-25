jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);
const mockKeychain = new Map<string, string>();
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItem: jest.fn(async (k: string) => { mockKeychain.delete(k); }),
}));

import { resetSqlite } from "./testing/sqliteNode";
import { beginSession, __resetSessionForTests } from "./session";
import { closeOfflineDb, publishSaved, upsertMeta, upsertPin } from "./db";
import { useOfflineStore, OFFLINE_SETTINGS_KEY } from "./offlineStore";
import type { DesiredFile } from "./types";

const desired = (id: string, v = 1): DesiredFile => ({
  file_id: id, workspace_id: "w1", folder_id: null, name: id, extension: "txt", mime_type: "text/plain",
  size_bytes: 1, current_version: v, updated_at: 1, lock_mode: "none",
});

beforeEach(async () => {
  __resetSessionForTests();
  await closeOfflineDb();
  resetSqlite();
  mockKeychain.clear();
  useOfflineStore.getState().reset();
  await useOfflineStore.getState().resetSettings();
  mockKeychain.clear();
  useOfflineStore.setState({ allowCellular: false, budgetBytes: null, hydrated: false });
});

describe("offline store", () => {
  it("refresh reads pins, saved files and pending updates from the database", async () => {
    const s = beginSession("acct");
    await upsertPin(s, { id: "p", kind: "folder", workspace_id: "w1", name: "P", created_at: 1 });
    await upsertMeta(s, [desired("cur"), desired("old", 2), desired("none")]);
    await publishSaved(s, "cur", { version: 1, size: 1, rendition: "none", renditionSize: null });
    await publishSaved(s, "old", { version: 1, size: 1, rendition: "none", renditionSize: null });
    await useOfflineStore.getState().refresh();
    const st = useOfflineStore.getState();
    expect(st.pins.map((p) => p.id)).toEqual(["p"]);
    expect([...st.savedFileIds].sort()).toEqual(["cur", "old"]);
    expect([...st.updatePendingIds]).toEqual(["old"]);
  });

  it("refresh with no session empties the lists", async () => {
    useOfflineStore.setState({ savedFileIds: new Set(["x"]) });
    await useOfflineStore.getState().refresh();
    expect(useOfflineStore.getState().savedFileIds.size).toBe(0);
  });

  it("settings persist and hydrate", async () => {
    await useOfflineStore.getState().hydrate();
    useOfflineStore.getState().setAllowCellular(true);
    useOfflineStore.getState().setBudget(5 * 1024 ** 3);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(mockKeychain.get(OFFLINE_SETTINGS_KEY)!)).toEqual({ allowCellular: true, budgetBytes: 5 * 1024 ** 3 });
    useOfflineStore.setState({ allowCellular: false, budgetBytes: null, hydrated: false });
    await useOfflineStore.getState().hydrate();
    expect(useOfflineStore.getState()).toMatchObject({ allowCellular: true, budgetBytes: 5 * 1024 ** 3 });
  });

  it("a toggle made while hydrate is still reading is kept, and does not wipe the stored budget", async () => {
    mockKeychain.set(OFFLINE_SETTINGS_KEY, JSON.stringify({ allowCellular: false, budgetBytes: 5 }));
    const keychain = jest.requireMock("@/lib/keychain") as { getItem: jest.Mock };
    let release!: () => void;
    keychain.getItem.mockImplementationOnce(async (k: string) => {
      await new Promise<void>((r) => { release = r; });
      return mockKeychain.get(k) ?? null;
    });
    const hydrating = useOfflineStore.getState().hydrate();
    useOfflineStore.getState().setAllowCellular(true);
    release();
    await hydrating;
    await new Promise((r) => setTimeout(r, 0));
    expect(useOfflineStore.getState()).toMatchObject({ allowCellular: true, budgetBytes: 5 });
    expect(JSON.parse(mockKeychain.get(OFFLINE_SETTINGS_KEY)!)).toEqual({ allowCellular: true, budgetBytes: 5 });
  });

  it("resetSettings returns to Wi-Fi only and no budget, and forgets the stored choice", async () => {
    useOfflineStore.getState().setAllowCellular(true);
    useOfflineStore.getState().setBudget(10);
    await new Promise((r) => setTimeout(r, 0));
    await useOfflineStore.getState().resetSettings();
    expect(useOfflineStore.getState()).toMatchObject({ allowCellular: false, budgetBytes: null });
    expect(mockKeychain.has(OFFLINE_SETTINGS_KEY)).toBe(false);
  });

  it("defaults are Wi-Fi only and no budget", async () => {
    await useOfflineStore.getState().hydrate();
    expect(useOfflineStore.getState()).toMatchObject({ allowCellular: false, budgetBytes: null });
  });

  it("reset clears account state but keeps device settings", async () => {
    useOfflineStore.setState({ pins: [{ id: "p" } as never], savedFileIds: new Set(["a"]), allowCellular: true, progress: { done: 1, total: 2, bytesDone: 1, bytesTotal: 2 } });
    useOfflineStore.getState().reset();
    expect(useOfflineStore.getState()).toMatchObject({ pins: [], progress: null, allowCellular: true });
    expect(useOfflineStore.getState().savedFileIds.size).toBe(0);
  });
});
