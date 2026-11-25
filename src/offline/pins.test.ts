jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);
jest.mock("expo-network", () => ({
  NetworkStateType: { NONE: "NONE", CELLULAR: "CELLULAR", WIFI: "WIFI" },
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, type: "WIFI" })),
  addNetworkStateListener: jest.fn(() => ({ remove: () => {} })),
}));
const mockApi = { handler: null as null | ((path: string, opts?: { body?: any }) => Promise<unknown>) };
jest.mock("@/api/client", () => ({
  apiRequest: jest.fn((path: string, opts?: { body?: unknown }) => mockApi.handler!(path, opts)),
  EDGE_CHALLENGE_CODE: "edge_challenge",
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", refreshSession: jest.fn(async () => "refreshed") }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
jest.mock("../../modules/dosya-media-extras", () => ({ setExcludedFromBackup: jest.fn(async () => true) }));

import { apiRequest } from "@/api/client";
import { ApiError } from "@/api/errors";
import { dropSqliteUnder, resetSqlite } from "./testing/sqliteNode";
import { filesUnder, fsState, putFile, resetFs } from "./testing/memoryFs";
import { beginSession, currentSession, registerTask, withCommit, __resetSessionForTests, type OfflineSession } from "./session";
import {
  addMembers, closeOfflineDb, listFiles, listMembers, listPins, pinRevision, publishSaved, upsertMeta, upsertPin,
} from "./db";
import { finalPath } from "./store";
import * as sync from "./sync";
import { useOfflineStore } from "./offlineStore";
import { LARGE_FOLDER_BYTES, canPin, estimateFolder, pinFile, pinFolder, removeAll, unpin } from "./pins";
import type { FileItem, FolderItem } from "@/files/types";
import type { DesiredFile } from "./types";

const desired = (id: string, over: Partial<DesiredFile> = {}): DesiredFile => ({
  file_id: id, workspace_id: "w1", folder_id: "P", name: `${id}.txt`, extension: "txt", mime_type: "text/plain",
  size_bytes: 10, current_version: 1, updated_at: 1, lock_mode: "none", ...over,
});

const fileItem = (id: string, over: Partial<FileItem> = {}): FileItem => ({
  id, name: `${id}.txt`, size_bytes: 10, mime_type: "text/plain", extension: "txt", created_at: 1, updated_at: 1,
  current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0, ...over,
});

const folderItem = (id: string): FolderItem => ({
  id, name: id, created_at: 1, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none",
});

let s: OfflineSession;

/** A pin with saved files, planted directly. */
async function plant(pinId: string, fileIds: string[]) {
  await withCommit(s, async () => {
    await upsertPin(s, { id: pinId, kind: "folder", workspace_id: "w1", name: pinId, created_at: 1 });
    await upsertMeta(s, fileIds.map((id) => desired(id)));
    await addMembers(s, pinId, fileIds);
    for (const id of fileIds) {
      await publishSaved(s, id, { version: 1, size: 10, rendition: "none", renditionSize: null });
      putFile(finalPath(s, id, 1, "txt"), 10);
    }
  });
}

beforeEach(async () => {
  __resetSessionForTests();
  await closeOfflineDb();
  resetSqlite();
  resetFs();
  fsState.onDelete.push(dropSqliteUnder);
  sync.__resetSyncForTests();
  jest.clearAllMocks();
  mockApi.handler = async () => { throw new ApiError("offline", 0); };
  useOfflineStore.getState().reset();
  s = beginSession("acct");
});

describe("canPin", () => {
  it("canPin refuses view_only, full_lock, vault", () => {
    expect(canPin({ lock_mode: "view_only" }, { inVault: false })).toEqual({ ok: false, reason: "restricted" });
    expect(canPin({ lock_mode: "full_lock" }, { inVault: false })).toEqual({ ok: false, reason: "restricted" });
    expect(canPin({ lock_mode: "none" }, { inVault: true })).toEqual({ ok: false, reason: "vault" });
    expect(canPin({ lock_mode: "none" }, { inVault: false })).toEqual({ ok: true });
  });

  it("an unknown or missing lock mode is refused too", () => {
    expect(canPin({ lock_mode: "" }, { inVault: false })).toEqual({ ok: false, reason: "restricted" });
    expect(canPin({ lock_mode: "something_new" }, { inVault: false })).toEqual({ ok: false, reason: "restricted" });
  });
});

describe("unpin", () => {
  it("unpin offline frees space at once, no API call", async () => {
    await plant("P", ["a", "b"]);
    await unpin("P");
    expect(apiRequest).not.toHaveBeenCalled();
    expect(await listPins(s)).toEqual([]);
    expect(await listFiles(s)).toEqual([]);
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("unpin keeps files another pin covers", async () => {
    await plant("P", ["a", "shared"]);
    await plant("Q", ["shared"]);
    await unpin("P");
    expect((await listFiles(s)).map((f) => f.file_id)).toEqual(["shared"]);
    expect(filesUnder(s.root)).toEqual([finalPath(s, "shared", 1, "txt")]);
    expect((await listMembers(s)).map((m) => m.pin_id)).toEqual(["Q"]);
  });

  it("unpin cancels the orphan's running download", async () => {
    await plant("P", ["a", "shared"]);
    await plant("Q", ["shared"]);
    const orphanTask = { cancelAsync: jest.fn(async () => {}) };
    const sharedTask = { cancelAsync: jest.fn(async () => {}) };
    registerTask("a", orphanTask);
    registerTask("shared", sharedTask);
    await unpin("P");
    expect(orphanTask.cancelAsync).toHaveBeenCalled();
    expect(sharedTask.cancelAsync).not.toHaveBeenCalled();
  });

  it("re-pinning after unpin gets a higher revision", async () => {
    await pinFolder(folderItem("P"), "w1");
    const first = await pinRevision(s, "P");
    await unpin("P");
    await pinFolder(folderItem("P"), "w1");
    expect(await pinRevision(s, "P")).toBeGreaterThan(first!);
  });
});

describe("pin", () => {
  it("pinFile covers the file at once and starts a sync", async () => {
    const run = jest.spyOn(sync, "runOfflineSync").mockResolvedValue();
    await pinFile(fileItem("f1"), "w1");
    expect((await listPins(s))[0]).toMatchObject({ id: "f1", kind: "file", workspace_id: "w1", status: "pending" });
    expect(await listMembers(s)).toEqual([{ pin_id: "f1", file_id: "f1", missing_count: 0 }]);
    expect((await listFiles(s))[0]).toMatchObject({ file_id: "f1", saved_version: null, remote_version: 1 });
    expect(run).toHaveBeenCalledWith({ reason: "pin" });
    expect(useOfflineStore.getState().pins.map((p) => p.id)).toEqual(["f1"]);
    run.mockRestore();
  });

  it("pinFolder records the pin and starts a sync", async () => {
    const run = jest.spyOn(sync, "runOfflineSync").mockResolvedValue();
    await pinFolder(folderItem("P"), "w1");
    expect((await listPins(s))[0]).toMatchObject({ id: "P", kind: "folder" });
    expect(run).toHaveBeenCalledWith({ reason: "pin" });
    run.mockRestore();
  });

  it("refuses a restricted file", async () => {
    await expect(pinFile(fileItem("f1", { lock_mode: "view_only" }), "w1")).rejects.toThrow();
    expect(await listPins(s)).toEqual([]);
  });
});

describe("estimateFolder", () => {
  it("counts the files and only the bytes not already saved", async () => {
    await plant("Q", ["have"]);
    mockApi.handler = async () => ({
      ok: true, hasMore: false, nextCursor: null, folders: [],
      files: [
        { id: "have", name: "h", size_bytes: 10, mime_type: "x", extension: null, folder_id: "P", updated_at: 1, current_version: 1, lock_mode: "none" },
        { id: "new", name: "n", size_bytes: 300, mime_type: "x", extension: null, folder_id: "P", updated_at: 1, current_version: 1, lock_mode: "none" },
        { id: "locked", name: "l", size_bytes: 5000, mime_type: "x", extension: null, folder_id: "P", updated_at: 1, current_version: 1, lock_mode: "view_only" },
      ],
    });
    expect(await estimateFolder("w1", "P")).toEqual({ files: 2, additionalBytes: 300 });
  });

  it("rejects when the folder cannot be read", async () => {
    await expect(estimateFolder("w1", "P")).rejects.toThrow();
  });

  it("the large-folder threshold is 1 GiB", () => {
    expect(LARGE_FOLDER_BYTES).toBe(1024 ** 3);
  });
});

describe("removeAll", () => {
  it("removeAll during a transfer leaves nothing", async () => {
    // A folder pin with one file, served by a fake API, and a download that
    // holds until Remove all has finished.
    await withCommit(s, () => upsertPin(s, { id: "P", kind: "folder", workspace_id: "w1", name: "P", created_at: 1 }).then(() => undefined));
    mockApi.handler = async (path, opts) => {
      if (path.startsWith("/api/sync/snapshot")) {
        return { ok: true, hasMore: false, nextCursor: null, folders: [], files: [
          { id: "a", name: "a.txt", size_bytes: 10, mime_type: "text/plain", extension: "txt", folder_id: "P", updated_at: 1, current_version: 1, lock_mode: "none" },
        ] };
      }
      if (path === "/api/sync/download-check") return { ok: true, decisions: Object.fromEntries(opts!.body.file_ids.map((id: string) => [id, "allowed"])) };
      if (path === "/api/sync/download-manifest") return { ok: true, downloads: [{ fileId: "a", url: "https://r2.test/a?size=10", name: "a", size: 10 }] };
      throw new ApiError("unexpected", 500);
    };
    let release!: () => void;
    let started!: () => void;
    const downloading = new Promise<void>((r) => { started = r; });
    fsState.impl = async (ctl) => {
      started();
      await new Promise<void>((r) => { release = r; });
      putFile(ctl.dest, 10);
      return 200;
    };
    const run = sync.runOfflineSync({ reason: "pin" });
    await downloading;
    const removing = removeAll();
    release?.();
    await removing;
    await run;
    await new Promise((r) => setTimeout(r, 10));
    const after = currentSession()!;
    expect(after.accountId).toBe("acct");
    expect(await listPins(after)).toEqual([]);
    expect(await listFiles(after)).toEqual([]);
    expect(filesUnder(after.root)).toEqual([]);
    expect(useOfflineStore.getState().pins).toEqual([]);
  });

  it("removeAll with nothing running clears every pin", async () => {
    await plant("P", ["a"]);
    await removeAll();
    const after = currentSession()!;
    expect(await listPins(after)).toEqual([]);
    expect(filesUnder(after.root)).toEqual([]);
  });
});
