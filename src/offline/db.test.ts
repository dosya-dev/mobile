jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);

import * as SQLite from "expo-sqlite";
import { resetSqlite } from "./testing/sqliteNode";
import { beginSession, __resetSessionForTests, type OfflineSession } from "./session";
import {
  OFFLINE_SCHEMA_VERSION, addMembers, applyMembers, closeOfflineDb, inTransaction, schemaVersion, deleteFileRows, deletePin, getFileRow, hasLivePin, listChildren,
  listFiles, listFolders, listMembers, listPins, openOfflineDb, orphanedFiles, pinRevision, publishSaved,
  replaceFolders, setPinChecked, setPinStatus, setRendition, upsertMeta, upsertPin,
} from "./db";
import type { DesiredFile } from "./types";

const desired = (id: string, over: Partial<DesiredFile> = {}): DesiredFile => ({
  file_id: id, workspace_id: "w1", folder_id: "fo1", name: `${id}.txt`, extension: "txt",
  mime_type: "text/plain", size_bytes: 10, current_version: 1, updated_at: 1, lock_mode: "none", ...over,
});

let s: OfflineSession;

async function pin(id: string, kind: "file" | "folder" = "folder") {
  return upsertPin(s, { id, kind, workspace_id: "w1", name: id, created_at: 1 });
}

beforeEach(async () => {
  __resetSessionForTests();
  await closeOfflineDb();
  resetSqlite();
  s = beginSession("acct");
  await openOfflineDb(s);
});

describe("offline db", () => {
  it("database file lives in the account root", async () => {
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith("offline.db", undefined, s.root);
    expect(s.root).toBe("file:///docs/offline/acct/");
  });

  it("applyMembers drops a membership on the second consecutive miss and deletes nothing", async () => {
    await pin("p");
    await upsertMeta(s, [desired("a"), desired("b")]);
    await applyMembers(s, "p", ["a", "b"], []);
    await applyMembers(s, "p", ["a"], ["b"]);
    expect((await listMembers(s)).find((m) => m.file_id === "b")?.missing_count).toBe(1);
    await applyMembers(s, "p", ["a"], ["b"]);
    expect((await listMembers(s)).map((m) => m.file_id)).toEqual(["a"]);
    // Membership only: the file row is still there for orphanedFiles to judge.
    expect((await listFiles(s)).map((f) => f.file_id).sort()).toEqual(["a", "b"]);
    expect(await orphanedFiles(s)).toEqual(["b"]);
  });

  it("a miss followed by a sighting resets the count", async () => {
    await pin("p");
    await applyMembers(s, "p", ["a"], []);
    await applyMembers(s, "p", [], ["a"]);
    await applyMembers(s, "p", ["a"], []);
    await applyMembers(s, "p", [], ["a"]);
    expect((await listMembers(s))[0]).toMatchObject({ file_id: "a", missing_count: 1 });
  });

  it("orphanedFiles: a file still covered by another pin is not an orphan", async () => {
    await pin("p1");
    await pin("p2");
    await upsertMeta(s, [desired("shared"), desired("only1")]);
    await applyMembers(s, "p1", ["shared", "only1"], []);
    await applyMembers(s, "p2", ["shared"], []);
    const freed = await deletePin(s, "p1");
    expect(freed).toEqual(["only1"]);
    expect(await orphanedFiles(s)).toEqual(["only1"]);
    expect(await hasLivePin(s, "shared")).toBe(true);
    expect(await hasLivePin(s, "only1")).toBe(false);
  });

  it("re-pinning after unpin gets a higher revision", async () => {
    const first = await pin("p");
    const second = await pin("p");
    expect(second).toBeGreaterThan(first);
    await deletePin(s, "p");
    expect(await pinRevision(s, "p")).toBeNull();
    const third = await pin("p");
    expect(third).toBeGreaterThan(second);
    expect(await pinRevision(s, "p")).toBe(third);
  });

  it("status changes do not move the revision", async () => {
    const r = await pin("p");
    await setPinStatus(s, "p", "error", "nope");
    await setPinChecked(s, ["p"], 99);
    expect(await pinRevision(s, "p")).toBe(r);
    expect((await listPins(s))[0]).toMatchObject({ status: "error", last_error: "nope", last_checked_at: 99 });
  });

  it("deletePin removes the pin, its memberships and its folders", async () => {
    await pin("p");
    await applyMembers(s, "p", ["a"], []);
    await replaceFolders(s, "p", [{ id: "p", workspace_id: "w1", parent_id: null, name: "P", pin_id: "p" }]);
    await deletePin(s, "p");
    expect(await listPins(s)).toEqual([]);
    expect(await listMembers(s)).toEqual([]);
    expect(await listFolders(s)).toEqual([]);
  });

  it("addMembers adds without touching other pins' memberships", async () => {
    await pin("f", "file");
    await addMembers(s, "f", ["f"]);
    expect(await listMembers(s)).toEqual([{ pin_id: "f", file_id: "f", missing_count: 0 }]);
  });

  it("upsertMeta keeps the saved version while the server version moves", async () => {
    await upsertMeta(s, [desired("a")]);
    await publishSaved(s, "a", { version: 1, size: 10, ext: "txt", rendition: "none", renditionSize: null });
    await upsertMeta(s, [desired("a", { current_version: 2, size_bytes: 20, name: "renamed.txt" })]);
    expect(await getFileRow(s, "a")).toMatchObject({
      remote_version: 2, size_bytes: 20, name: "renamed.txt", saved_version: 1, saved_size: 10,
    });
  });

  it("publishSaved records the rendition at the saved version", async () => {
    await upsertMeta(s, [desired("d", { extension: "docx" })]);
    await publishSaved(s, "d", { version: 3, size: 10, ext: "docx", rendition: "ready", renditionSize: 7 });
    expect(await getFileRow(s, "d")).toMatchObject({ saved_version: 3, rendition: "ready", rendition_version: 3, rendition_size: 7 });
    await setRendition(s, "d", { rendition: "failed", version: null, size: null });
    expect(await getFileRow(s, "d")).toMatchObject({ rendition: "failed", rendition_version: null, rendition_size: null });
  });

  it("deleteFileRows removes rows", async () => {
    await upsertMeta(s, [desired("a"), desired("b")]);
    await deleteFileRows(s, ["a"]);
    expect((await listFiles(s)).map((f) => f.file_id)).toEqual(["b"]);
  });

  it("replaceFolders swaps one pin's folders and listChildren browses them", async () => {
    await pin("p");
    await replaceFolders(s, "p", [
      { id: "p", workspace_id: "w1", parent_id: "root", name: "P", pin_id: "p" },
      { id: "c1", workspace_id: "w1", parent_id: "p", name: "C1", pin_id: "p" },
    ]);
    await replaceFolders(s, "p", [
      { id: "p", workspace_id: "w1", parent_id: "root", name: "P", pin_id: "p" },
      { id: "c2", workspace_id: "w1", parent_id: "p", name: "C2", pin_id: "p" },
    ]);
    expect((await listChildren(s, "w1", "p")).map((f) => f.id)).toEqual(["c2"]);
  });

  it("data survives closing and reopening", async () => {
    await pin("p");
    await closeOfflineDb();
    await openOfflineDb(s);
    expect((await listPins(s)).map((p) => p.id)).toEqual(["p"]);
  });

  it("publishSaved records the saved bytes' extension, which a later rename does not move", async () => {
    await upsertMeta(s, [desired("a")]);
    await publishSaved(s, "a", { version: 1, size: 10, ext: "txt", rendition: "none", renditionSize: null });
    await upsertMeta(s, [desired("a", { name: "a.md", extension: "md" })]);
    expect(await getFileRow(s, "a")).toMatchObject({ name: "a.md", extension: "md", saved_ext: "txt" });
  });

  it("upsertMeta leaves an unchanged row unwritten", async () => {
    await upsertMeta(s, [desired("a")]);
    const d = await (SQLite.openDatabaseAsync as jest.Mock).mock.results.at(-1)!.value;
    d.runAsync.mockClear();
    await upsertMeta(s, [desired("a")]);
    const writes = await d.getFirstAsync("SELECT changes() AS n");
    expect(writes.n).toBe(0);
  });

  it("inTransaction rolls everything back when the work fails part way", async () => {
    await pin("p");
    await applyMembers(s, "p", ["a"], []);
    await expect(inTransaction(s, async () => {
      await applyMembers(s, "p", [], ["a"]);
      throw new Error("killed mid-apply");
    })).rejects.toThrow("killed mid-apply");
    // The miss was not counted: a rerun cannot double-count it.
    expect((await listMembers(s))[0].missing_count).toBe(0);
  });

  it("migrates a version-0 database that lacks saved_ext and records the schema version", async () => {
    await closeOfflineDb();
    resetSqlite();
    // A database made by the first build of this feature: files without saved_ext, user_version 0.
    const raw = await (SQLite.openDatabaseAsync as jest.Mock)("offline.db", undefined, s.root);
    await raw.execAsync(`CREATE TABLE files (file_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, folder_id TEXT,
      name TEXT NOT NULL, extension TEXT, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, remote_version INTEGER NOT NULL,
      saved_version INTEGER, saved_size INTEGER, rendition TEXT NOT NULL DEFAULT 'none', rendition_version INTEGER,
      rendition_size INTEGER, updated_at INTEGER NOT NULL);
      INSERT INTO files (file_id, workspace_id, name, extension, mime_type, size_bytes, remote_version, saved_version, updated_at)
      VALUES ('old', 'w1', 'old.txt', 'txt', 'text/plain', 1, 1, 1, 1);`);
    await openOfflineDb(s);
    expect(await getFileRow(s, "old")).toMatchObject({ saved_version: 1, saved_ext: null });
    expect(await schemaVersion(s)).toBe(OFFLINE_SCHEMA_VERSION);
  });

  it("an ended session never reopens its database", async () => {
    const old = s;
    await closeOfflineDb();
    __resetSessionForTests();
    beginSession("acct");
    await expect(listPins(old)).rejects.toThrow("session ended");
  });
});
