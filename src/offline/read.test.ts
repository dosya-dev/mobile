jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);
const mockOnline = { value: null as boolean | null };
jest.mock("./network", () => ({ isOnlineNow: () => mockOnline.value }));
jest.mock("./sync", () => ({ runOfflineSync: jest.fn(async () => {}) }));

import { ApiError } from "@/api/errors";
import { resetSqlite } from "./testing/sqliteNode";
import { filesUnder, putFile, resetFs } from "./testing/memoryFs";
import { beginSession, withCommit, __resetSessionForTests, type OfflineSession } from "./session";
import { addMembers, closeOfflineDb, publishSaved, replaceFolders, upsertMeta, upsertPin } from "./db";
import { finalPath } from "./store";
import { runOfflineSync } from "./sync";
import { chooseSource, localFirst, offlineFile, offlineListing, savedCopy, savedOriginalForExport, __resetReadForTests, __setRemoteGraceForTests } from "./read";
import type { DesiredFile } from "./types";

const desired = (id: string, over: Partial<DesiredFile> = {}): DesiredFile => ({
  file_id: id, workspace_id: "w1", folder_id: "P", name: `${id}.txt`, extension: "txt", mime_type: "text/plain",
  size_bytes: 10, current_version: 2, updated_at: 5, lock_mode: "none", ...over,
});

let s: OfflineSession;

beforeEach(async () => {
  __resetSessionForTests();
  await closeOfflineDb();
  resetSqlite();
  resetFs();
  mockOnline.value = null;
  jest.clearAllMocks();
  __resetReadForTests();
  s = beginSession("acct");
  await withCommit(s, async () => {
    await upsertPin(s, { id: "P", kind: "folder", workspace_id: "w1", name: "Pinned", created_at: 1 });
    await replaceFolders(s, "P", [
      { id: "P", workspace_id: "w1", parent_id: "root", name: "Pinned", pin_id: "P" },
      { id: "sub", workspace_id: "w1", parent_id: "P", name: "Sub", pin_id: "P" },
    ]);
    await upsertMeta(s, [desired("a"), desired("b", { name: "B.txt" }), desired("d", { extension: "docx", name: "d.docx", mime_type: "x" }), desired("deep", { folder_id: "sub" })]);
    await addMembers(s, "P", ["a", "b", "d", "deep"]);
    await publishSaved(s, "a", { version: 1, size: 10, rendition: "none", renditionSize: null });
    putFile(finalPath(s, "a", 1, "txt"), 10);
    await publishSaved(s, "d", { version: 2, size: 10, rendition: "ready", renditionSize: 4 });
    putFile(finalPath(s, "d", 2, "docx"), 10);
    putFile(finalPath(s, "d", 2, "docx", "pdf"), 4);
  });
});

describe("savedCopy", () => {
  it("returns the saved bytes and their version", async () => {
    expect(await savedCopy("a")).toEqual({ uri: finalPath(s, "a", 1, "txt"), version: 1, rendition: "none" });
  });

  it("returns the PDF only when it is ready at the saved version", async () => {
    expect(await savedCopy("d", { variant: "pdf" })).toEqual({ uri: finalPath(s, "d", 2, "docx", "pdf"), version: 2, rendition: "ready" });
    expect(await savedCopy("a", { variant: "pdf" })).toBeNull();
  });

  it("is null for a file not saved, or whose bytes are missing", async () => {
    expect(await savedCopy("b")).toBeNull();
    expect(await savedCopy("nope")).toBeNull();
    resetFs();
    expect(await savedCopy("a")).toBeNull();
  });

  it("is null with no session", async () => {
    __resetSessionForTests();
    expect(await savedCopy("a")).toBeNull();
  });
});

describe("savedOriginalForExport", () => {
  const meta = { id: "a", name: "Report Q3.txt", current_version: 1, lock_mode: "none" };

  it("copies the saved original into the cache under the file's own name", async () => {
    expect(await savedOriginalForExport(meta)).toBe("file:///cache/offline-export/a/Report Q3.txt");
    expect(filesUnder("file:///cache/offline-export/")).toEqual(["file:///cache/offline-export/a/Report Q3.txt"]);
  });

  it("two files with the same name export to different paths", async () => {
    await withCommit(s, async () => {
      await upsertMeta(s, [desired("twin")]);
      await addMembers(s, "P", ["twin"]);
      await publishSaved(s, "twin", { version: 2, size: 10, rendition: "none", renditionSize: null });
    });
    putFile(finalPath(s, "twin", 2, "txt"), 10);
    const one = await savedOriginalForExport(meta);
    const two = await savedOriginalForExport({ ...meta, id: "twin", current_version: 2 });
    expect(one).not.toBe(two);
    expect(filesUnder("file:///cache/offline-export/")).toHaveLength(2);
  });

  it("online with a newer version on the server: null, so the caller fetches it", async () => {
    mockOnline.value = true;
    expect(await savedOriginalForExport({ ...meta, current_version: 2 })).toBeNull();
  });

  it("offline, an older saved version is still what there is", async () => {
    mockOnline.value = false;
    expect(await savedOriginalForExport({ ...meta, current_version: 2 })).not.toBeNull();
  });

  it("never for a restricted file or one not saved", async () => {
    expect(await savedOriginalForExport({ ...meta, lock_mode: "view_only" })).toBeNull();
    expect(await savedOriginalForExport({ ...meta, id: "b" })).toBeNull();
  });
});

describe("offlineFile and offlineListing", () => {
  it("describes a covered file from its row", async () => {
    expect(await offlineFile("a")).toMatchObject({
      id: "a", name: "a.txt", current_version: 2, lock_mode: "none", folder_id: "P", workspace_id: "w1", size_bytes: 10,
    });
    expect(await offlineFile("nope")).toBeNull();
  });

  it("lists a pinned folder with its subfolders and breadcrumbs", async () => {
    const page = await offlineListing("w1", "P");
    expect(page?.folders.map((f) => f.id)).toEqual(["sub"]);
    expect(page?.files.map((f) => f.id)).toEqual(["a", "b", "d"]);
    expect(page?.breadcrumbs).toEqual([{ id: "P", name: "Pinned" }]);
    expect(page?.pagination).toEqual({ page: 1, per_page: 3, total_files: 3, total_pages: 1 });
    const sub = await offlineListing("w1", "sub");
    expect(sub?.breadcrumbs).toEqual([{ id: "P", name: "Pinned" }, { id: "sub", name: "Sub" }]);
  });

  it("is null for a folder no pin holds, and for the workspace root", async () => {
    expect(await offlineListing("w1", "elsewhere")).toBeNull();
    expect(await offlineListing("w1", null)).toBeNull();
  });

  it("sorts and filters like the server", async () => {
    const byName = await offlineListing("w1", "P", { filter: "all", sort: "name_desc" });
    expect(byName?.files.map((f) => f.name)).toEqual(["d.docx", "B.txt", "a.txt"]);
    const docs = await offlineListing("w1", "P", { filter: "images", sort: "newest" });
    expect(docs?.files).toEqual([]);
    expect(await offlineListing("w1", "P", { filter: "shared", sort: "newest" })).toBeNull();
  });
});

describe("localFirst", () => {
  it("offline reads local at once without calling remote", async () => {
    mockOnline.value = false;
    const remote = jest.fn(async () => "remote");
    expect(await localFirst(remote, async () => "local")).toBe("local");
    expect(remote).not.toHaveBeenCalled();
  });

  it("offline with nothing local errors at once", async () => {
    mockOnline.value = false;
    const remote = jest.fn(async () => "remote");
    await expect(localFirst(remote, async () => null)).rejects.toMatchObject({ status: 0 });
    expect(remote).not.toHaveBeenCalled();
  });

  it("online prefers the server", async () => {
    mockOnline.value = true;
    expect(await localFirst(async () => "remote", async () => "local")).toBe("remote");
  });

  it("an online network error falls back to local", async () => {
    mockOnline.value = null;
    expect(await localFirst(async () => { throw new ApiError("net", 0); }, async () => "local")).toBe("local");
  });

  it("a 403 is never masked, and asks for a sync when a copy is saved", async () => {
    mockOnline.value = true;
    await expect(localFirst(async () => { throw new ApiError("no", 403); }, async () => "local")).rejects.toMatchObject({ status: 403 });
    expect(runOfflineSync).toHaveBeenCalledWith({ reason: "manual" });
  });

  it("a 403 asks for a sync at most once per file in ten minutes", async () => {
    mockOnline.value = true;
    const refuse = async () => { throw new ApiError("no", 403); };
    for (let i = 0; i < 3; i += 1) await expect(localFirst(refuse, async () => "local", "file:a")).rejects.toMatchObject({ status: 403 });
    await expect(localFirst(refuse, async () => "local", "file:b")).rejects.toMatchObject({ status: 403 });
    expect(runOfflineSync).toHaveBeenCalledTimes(2);
  });

  it("a slow server with a saved copy serves the copy after the grace period", async () => {
    __setRemoteGraceForTests(20);
    mockOnline.value = true; // a captive portal looks online
    expect(await localFirst(() => new Promise<string>(() => {}), async () => "local")).toBe("local");
  });

  it("a slow server with nothing saved is still waited for", async () => {
    __setRemoteGraceForTests(5);
    mockOnline.value = true;
    expect(await localFirst(() => new Promise<string>((r) => setTimeout(() => r("remote"), 30)), async () => null)).toBe("remote");
  });

  it("a 403 for something not saved asks for nothing", async () => {
    mockOnline.value = true;
    await expect(localFirst(async () => { throw new ApiError("no", 403); }, async () => null)).rejects.toMatchObject({ status: 403 });
    expect(runOfflineSync).not.toHaveBeenCalled();
  });

  it("a 500 is not masked either", async () => {
    mockOnline.value = true;
    await expect(localFirst(async () => { throw new ApiError("no", 500); }, async () => "local")).rejects.toMatchObject({ status: 500 });
  });

  it("a broken local read never hides the remote error", async () => {
    await expect(localFirst(async () => { throw new ApiError("net", 0); }, async () => { throw new Error("db"); })).rejects.toMatchObject({ status: 0 });
  });
});

describe("chooseSource", () => {
  const saved = { uri: "file:///docs/offline/acct/files/a-v1.txt", version: 1 };

  it("nothing saved streams", () => {
    expect(chooseSource({ saved: null, serverVersion: 2, online: true, origin: "files", userAskedNewer: false })).toEqual({ kind: "stream" });
  });

  it("files, online, current saved copy: saved", () => {
    expect(chooseSource({ saved, serverVersion: 1, online: true, origin: "files", userAskedNewer: false }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: false });
  });

  it("files, online, outdated saved copy: saved + newer bar, no stream until asked", () => {
    expect(chooseSource({ saved, serverVersion: 2, online: true, origin: "files", userAskedNewer: false }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: true });
    expect(chooseSource({ saved, serverVersion: 2, online: true, origin: "files", userAskedNewer: true })).toEqual({ kind: "stream" });
  });

  it("offline screen, online, outdated: saved, never stream", () => {
    expect(chooseSource({ saved, serverVersion: 2, online: true, origin: "offline-screen", userAskedNewer: true }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: true });
  });

  it("offline screen, current: saved", () => {
    expect(chooseSource({ saved, serverVersion: 1, online: false, origin: "offline-screen", userAskedNewer: false }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: false });
  });

  it("anywhere offline, outdated: saved with update pending, even when asked", () => {
    expect(chooseSource({ saved, serverVersion: 2, online: false, origin: "files", userAskedNewer: true }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: true });
  });

  it("unknown connection behaves as online", () => {
    expect(chooseSource({ saved, serverVersion: 2, online: null, origin: "files", userAskedNewer: true })).toEqual({ kind: "stream" });
  });

  it("an unknown server version is not newer", () => {
    expect(chooseSource({ saved, serverVersion: null, online: true, origin: "files", userAskedNewer: false }))
      .toEqual({ kind: "saved", uri: saved.uri, version: 1, newer: false });
  });
});
