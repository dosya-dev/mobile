jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("./testing/sqliteNode").sqliteModule);
const mockNet = {
  state: { isConnected: true, type: "WIFI" } as { isConnected: boolean; type: string },
  listeners: [] as ((e: unknown) => void)[],
};
jest.mock("expo-network", () => ({
  NetworkStateType: { NONE: "NONE", UNKNOWN: "UNKNOWN", CELLULAR: "CELLULAR", WIFI: "WIFI", ETHERNET: "ETHERNET" },
  getNetworkStateAsync: jest.fn(async () => mockNet.state),
  addNetworkStateListener: jest.fn((fn: (e: unknown) => void) => {
    mockNet.listeners.push(fn);
    return { remove: () => { mockNet.listeners = mockNet.listeners.filter((l) => l !== fn); } };
  }),
}));
const mockApi = { handler: null as null | ((path: string, opts?: { method?: string; body?: any }) => Promise<unknown>) };
jest.mock("@/api/client", () => ({
  apiRequest: jest.fn((path: string, opts?: { method?: string; body?: unknown }) => mockApi.handler!(path, opts)),
  EDGE_CHALLENGE_CODE: "edge_challenge",
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok", refreshSession: jest.fn(async () => "refreshed") }));
const mockKeychain = new Map<string, string>();
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItem: jest.fn(async () => {}),
}));
jest.mock("../../modules/dosya-media-extras", () => ({ setExcludedFromBackup: jest.fn(async () => true) }));

import * as FileSystem from "expo-file-system/legacy";
import { apiRequest } from "@/api/client";
import { ApiError } from "@/api/errors";
import { dropSqliteUnder, resetSqlite } from "./testing/sqliteNode";
import { filesUnder, fsModule, fsState, putFile, resetFs, type DownloadCtl } from "./testing/memoryFs";
import { beginSession, endSession, withCommit, __resetSessionForTests, type OfflineSession } from "./session";
import {
  addMembers, closeOfflineDb, deleteFileRows, deletePin, getFileRow, listFiles, listMembers, listPins, pinRevision, upsertPin,
} from "./db";
import { removeFileBytes, wipeAccount } from "./store";
import { useOfflineStore } from "./offlineStore";
import {
  FREE_SPACE_FLOOR_BYTES, RENDITION_RESERVE, fitsBudget, fitsHeadroom, runOfflineSync, __resetSyncForTests,
  __setSleepForTests, __setTimeoutsForTests,
} from "./sync";
import * as db from "./db";
import { savedCopy } from "./read";
import { OFFLINE_ROOT } from "./session";
import { __setRequestTimeoutForTests } from "./http";
import { usePlayerStore } from "@/player/playerStore";

const MiB = 1024 ** 2;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface SFile { id: string; folder: string; version: number; size: number; lock?: string; mime?: string; ext?: string }
const server = {
  folders: [] as { id: string; name: string; parent_id: string | null }[],
  files: new Map<string, SFile>(),
  check: null as null | ((ws: string, ids: string[]) => unknown),
  onSnapshot: null as null | (() => Promise<void>),
};

function addFile(f: SFile) {
  server.files.set(f.id, f);
}

function subtreeOf(root: string): Set<string> {
  const scope = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const fo of server.folders) if (fo.parent_id && scope.has(fo.parent_id) && !scope.has(fo.id)) { scope.add(fo.id); grew = true; }
  }
  return scope;
}

function installServer() {
  mockApi.handler = async (path, opts) => {
    if (path.startsWith("/api/sync/snapshot")) {
      await server.onSnapshot?.();
      const root = new URL(`https://x${path}`).searchParams.get("folder_id")!;
      const scope = subtreeOf(root);
      return {
        ok: true,
        files: [...server.files.values()].filter((f) => scope.has(f.folder)).map((f) => ({
          id: f.id, name: `${f.id}.${f.ext ?? "txt"}`, size_bytes: f.size, mime_type: f.mime ?? "text/plain",
          extension: f.ext ?? "txt", region: "eu", folder_id: f.folder, updated_at: 1, current_version: f.version,
          source_modified_at: null, ...(f.lock === undefined ? { lock_mode: "none" } : f.lock === "" ? {} : { lock_mode: f.lock }),
        })),
        folders: server.folders.filter((fo) => scope.has(fo.id) && fo.id !== root),
        nextCursor: null, hasMore: false, root_folder_id: root,
      };
    }
    if (path.startsWith("/api/files/")) {
      const f = server.files.get(decodeURIComponent(path.split("/").pop()!));
      if (!f) throw new ApiError("Not found", 404);
      return {
        ok: true,
        file: {
          id: f.id, name: `${f.id}.${f.ext ?? "txt"}`, size_bytes: f.size, mime_type: f.mime ?? "text/plain",
          extension: f.ext ?? "txt", created_at: 1, updated_at: 1, current_version: f.version,
          lock_mode: f.lock ?? "none", share_count: 0, comment_count: 0, folder_id: f.folder, workspace_id: "w1",
        },
      };
    }
    if (path === "/api/sync/download-check") {
      const { workspace_id, file_ids } = opts!.body as { workspace_id: string; file_ids: string[] };
      if (server.check) {
        const r = server.check(workspace_id, file_ids);
        if (r instanceof Error) throw r;
        return r;
      }
      return { ok: true, decisions: Object.fromEntries(file_ids.map((id) => [id, server.files.has(id) ? "allowed" : "denied"])) };
    }
    if (path === "/api/sync/download-manifest") {
      const { file_ids } = opts!.body as { file_ids: string[] };
      return {
        ok: true,
        downloads: file_ids.filter((id) => server.files.has(id)).map((id) => {
          const f = server.files.get(id)!;
          return { fileId: id, url: `https://r2.test/${id}?v=${f.version}&size=${f.size}`, name: id, size: f.size };
        }),
      };
    }
    throw new ApiError(`unexpected ${path}`, 500);
  };
}

const calls = (prefix: string) => (apiRequest as jest.Mock).mock.calls.filter((c) => (c[0] as string).startsWith(prefix));
const tick = () => new Promise((r) => setTimeout(r, 0));

let s: OfflineSession;
const filesDir = () => `${s.root}files/`;
const tmpDir = () => `${s.root}tmp/`;

async function pinFolder(id: string) {
  await withCommit(s, () => upsertPin(s, { id, kind: "folder", workspace_id: "w1", name: id, created_at: Date.now() }));
}

/** An unpin commit, without cancelling transfers - the race the publish re-check must win alone. */
async function unpinRaw(id: string) {
  await withCommit(s, async () => {
    const orphans = await deletePin(s, id);
    for (const o of orphans) await removeFileBytes(s, o);
    await deleteFileRows(s, orphans);
  });
}

const savedVersions = async () =>
  Object.fromEntries((await listFiles(s)).filter((r) => r.saved_version != null).map((r) => [r.file_id, r.saved_version]));

function defaultImpl() {
  fsState.impl = async (ctl: DownloadCtl) => {
    if (ctl.url.includes("preview-pdf")) {
      putFile(ctl.dest, 7);
      return 200;
    }
    const m = /[?&]size=(\d+)/.exec(ctl.url);
    putFile(ctl.dest, m ? Number(m[1]) : 10);
    return 200;
  };
}

beforeEach(async () => {
  __resetSessionForTests();
  await closeOfflineDb();
  resetSqlite();
  resetFs();
  defaultImpl();
  mockKeychain.clear();
  mockNet.state = { isConnected: true, type: "WIFI" };
  mockNet.listeners = [];
  server.folders = [];
  server.files = new Map();
  server.check = null;
  server.onSnapshot = null;
  installServer();
  __setSleepForTests(async () => {});
  __resetSyncForTests();
  __setTimeoutsForTests({ stallMs: 60_000, runCeilingMs: 15 * 60_000, lateWriteGraceMs: 10 });
  __setRequestTimeoutForTests(null);
  useOfflineStore.getState().reset();
  useOfflineStore.setState({ allowCellular: false, budgetBytes: null, hydrated: false });
  usePlayerStore.setState({ listening: false });
  jest.clearAllMocks();
  s = beginSession("acct");
});

describe("budget and headroom", () => {
  it("fitsBudget counts the retained result, minus what the new version replaces", () => {
    expect(fitsBudget({ retained: 100, oldSaved: 100, oldRendition: 0, newSize: 100, newRendition: 0, budget: 100 })).toBe(true);
    expect(fitsBudget({ retained: 100, oldSaved: 100, oldRendition: 0, newSize: 101, newRendition: 0, budget: 100 })).toBe(false);
    expect(fitsBudget({ retained: 1e12, oldSaved: 0, oldRendition: 0, newSize: 1e12, newRendition: 0, budget: null })).toBe(true);
  });

  it("fitsHeadroom keeps the floor free", () => {
    expect(fitsHeadroom({ free: FREE_SPACE_FLOOR_BYTES + 10, incoming: 10 })).toBe(true);
    expect(fitsHeadroom({ free: FREE_SPACE_FLOOR_BYTES + 10, incoming: 11 })).toBe(false);
  });

  it("the PDF reserve is at least 5 MiB", () => {
    expect(RENDITION_RESERVE(1)).toBe(5 * MiB);
    expect(RENDITION_RESERVE(8 * MiB)).toBe(8 * MiB);
  });
});

describe("music playing", () => {
  it.each(["foreground", "background", "network"] as const)("a %s sync does not start", async (reason) => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    usePlayerStore.setState({ listening: true });
    await runOfflineSync({ reason });
    expect(await savedVersions()).toEqual({});
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it.each(["manual", "pin"] as const)("a %s sync still runs: the user asked for it", async (reason) => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    usePlayerStore.setState({ listening: true });
    await runOfflineSync({ reason });
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("music starting mid-run stops the next download and leaves the pin to retry", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "P", version: 1, size: 10 });
    addFile({ id: "c", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    let downloads = 0;
    fsState.impl = async (ctl) => {
      downloads += 1;
      putFile(ctl.dest, 10);
      usePlayerStore.setState({ listening: true });
      return 200;
    };
    await runOfflineSync({ reason: "foreground" });
    expect(downloads).toBe(1);
    expect((await listPins(s))[0].status).toBe("pending");
  });

  it("a pin tapped during an automatic run keeps that run going", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    let downloads = 0;
    fsState.impl = async (ctl) => {
      downloads += 1;
      putFile(ctl.dest, 10);
      usePlayerStore.setState({ listening: true });
      void runOfflineSync({ reason: "pin" });
      return 200;
    };
    await runOfflineSync({ reason: "foreground" });
    expect(downloads).toBe(2);
  });
});

describe("runOfflineSync", () => {
  it("saves a pinned folder's files on Wi-Fi", async () => {
    server.folders = [{ id: "sub", name: "Sub", parent_id: "P" }];
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "sub", version: 2, size: 20 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ a: 1, b: 2 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`, `${filesDir()}b-v2.txt`]);
    expect((await listPins(s))[0]).toMatchObject({ status: "ready" });
    expect((await listPins(s))[0].last_checked_at).not.toBeNull();
    expect(useOfflineStore.getState().savedFileIds).toEqual(new Set(["a", "b"]));
  });

  it("temp file from a killed run swept first", async () => {
    putFile(`${tmpDir()}killed.part`, 999);
    mockNet.state = { isConnected: false, type: "NONE" };
    await pinFolder("P");
    await runOfflineSync({ reason: "foreground" });
    expect(filesUnder(tmpDir())).toEqual([]);
  });

  it("no connection: nothing is asked and nothing changes", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    mockNet.state = { isConnected: false, type: "NONE" };
    (apiRequest as jest.Mock).mockClear();
    server.files.delete("a");
    await runOfflineSync({ reason: "foreground" });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("role loses download_files: saved files deleted on cellular with transfers off and nothing to transfer", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ a: 1, b: 1 });

    mockNet.state = { isConnected: true, type: "CELLULAR" };
    server.check = () => new ApiError("You don't have download permission", 403, "no_download_permission");
    (apiRequest as jest.Mock).mockClear();
    await runOfflineSync({ reason: "manual" });
    expect(await listFiles(s)).toEqual([]);
    expect(filesUnder(s.root)).toEqual([]);
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
  });

  it("a per-file denial removes that file only", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.check = (_ws, ids) => ({ ok: true, decisions: Object.fromEntries(ids.map((id) => [id, id === "a" ? "denied" : "allowed"])) });
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ b: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}b-v1.txt`]);
  });

  it("access unknown: no deletions, no transfers", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.get("a")!.version = 2;
    server.check = () => new ApiError("busy", 503);
    (apiRequest as jest.Mock).mockClear();
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`]);
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
    expect(useOfflineStore.getState().updatePendingIds).toEqual(new Set(["a"]));
  });

  it("unpin the last covering pin during a download: no bytes or rows reappear", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      putFile(ctl.dest, 10);
      // The download has finished; the unpin commit lands before the publish.
      await unpinRaw("P");
      return 200;
    };
    await runOfflineSync({ reason: "pin" });
    expect(await listPins(s)).toEqual([]);
    expect(await listFiles(s)).toEqual([]);
    expect(filesUnder(s.root)).toEqual([]);
    // And the next run brings nothing back.
    defaultImpl();
    await runOfflineSync({ reason: "manual" });
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("unpin during the metadata check: its stale results are ignored, no rows reappear", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    server.onSnapshot = async () => { server.onSnapshot = null; await unpinRaw("P"); };
    await runOfflineSync({ reason: "pin" });
    expect(await listPins(s)).toEqual([]);
    expect(await listFiles(s)).toEqual([]);
    expect(await listMembers(s)).toEqual([]);
    expect(filesUnder(s.root)).toEqual([]);
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
  });

  it("re-pin during the check: results for the old revision are ignored", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const before = await pinRevision(s, "P");
    server.onSnapshot = async () => {
      server.onSnapshot = null;
      await unpinRaw("P");
      await pinFolder("P");
    };
    await runOfflineSync({ reason: "pin" });
    expect(await pinRevision(s, "P")).toBeGreaterThan(before!);
    expect(await listMembers(s)).toEqual([]);
    expect(await listFiles(s)).toEqual([]);
    // The re-pin's own run picks the folder up.
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("file moves from pin A to pin B in one run, A processed first: bytes never deleted", async () => {
    addFile({ id: "x", folder: "A", version: 1, size: 10 });
    await pinFolder("A");
    await pinFolder("B");
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ x: 1 });
    const downloads = fsState.downloads.length;

    server.files.get("x")!.folder = "B";
    await runOfflineSync({ reason: "manual" });
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ x: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}x-v1.txt`]);
    expect((await listMembers(s)).map((m) => m.pin_id)).toEqual(["B"]);
    expect(fsState.downloads.length).toBe(downloads);
  });

  it("a gone pin stays listed as gone; its files go unless another pin covers them", async () => {
    addFile({ id: "onlyA", folder: "A", version: 1, size: 10 });
    addFile({ id: "both", folder: "A", version: 1, size: 10 });
    await pinFolder("A");
    // "both" is also pinned on its own, so A going leaves it a second cover.
    await withCommit(s, async () => {
      await upsertPin(s, { id: "both", kind: "file", workspace_id: "w1", name: "both", created_at: Date.now() });
      await addMembers(s, "both", ["both"]);
    });
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ both: 1, onlyA: 1 });

    const base = mockApi.handler!;
    mockApi.handler = async (path, opts) => {
      if (path.includes("folder_id=A")) throw new ApiError("Not allowed", 403);
      return base(path, opts);
    };
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ both: 1 });
    expect((await listPins(s)).find((p) => p.id === "A")?.status).toBe("gone");
  });

  it("publishing a new version keeps the previous one until the next run's sweep (it may be open)", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.get("a")!.version = 2;
    server.files.get("a")!.size = 12;
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 2 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`, `${filesDir()}a-v2.txt`]);
    await runOfflineSync({ reason: "manual" });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v2.txt`]);
  });

  it("transfers on cellular wait for Wi-Fi when mobile data is off; the check still runs", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    mockNet.state = { isConnected: true, type: "CELLULAR" };
    await runOfflineSync({ reason: "pin" });
    expect(calls("/api/sync/snapshot")).toHaveLength(1);
    expect(calls("/api/sync/download-check")).toHaveLength(1);
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
    expect((await listPins(s))[0].status).toBe("waiting_wifi");
    useOfflineStore.getState().setAllowCellular(true);
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("original fits but original + PDF reserve does not: original saved, rendition skipped", async () => {
    addFile({ id: "d", folder: "P", version: 1, size: 100, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    useOfflineStore.getState().setBudget(1000);
    await runOfflineSync({ reason: "pin" });
    expect(await getFileRow(s, "d")).toMatchObject({ saved_version: 1, rendition: "skipped", rendition_version: null });
    expect(fsState.downloads.some((d) => d.url.includes("preview-pdf"))).toBe(false);
    expect((await listPins(s))[0].status).toBe("ready");
  });

  it("an office file is saved with its PDF at the same version", async () => {
    addFile({ id: "d", folder: "P", version: 3, size: 100, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    expect(await getFileRow(s, "d")).toMatchObject({ saved_version: 3, rendition: "ready", rendition_version: 3, rendition_size: 7 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}d-v3-pdf.pdf`, `${filesDir()}d-v3.docx`]);
    const pdf = fsState.downloads.find((d) => d.url.includes("preview-pdf"))!;
    expect(pdf.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("a conversion still running is waited for", async () => {
    addFile({ id: "d", folder: "P", version: 1, size: 100, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    let polls = 0;
    fsState.impl = async (ctl) => {
      if (ctl.url.includes("preview-pdf")) {
        polls += 1;
        putFile(ctl.dest, polls < 3 ? 20 : 7);
        return polls < 3 ? 503 : 200;
      }
      putFile(ctl.dest, 100);
      return 200;
    };
    await runOfflineSync({ reason: "pin" });
    expect(polls).toBe(3);
    expect(await getFileRow(s, "d")).toMatchObject({ rendition: "ready", rendition_size: 7 });
  });

  it("a failed conversion leaves the file available with rendition failed", async () => {
    addFile({ id: "d", folder: "P", version: 1, size: 100, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      putFile(ctl.dest, ctl.url.includes("preview-pdf") ? 30 : 100);
      return ctl.url.includes("preview-pdf") ? 422 : 200;
    };
    await runOfflineSync({ reason: "pin" });
    expect(await getFileRow(s, "d")).toMatchObject({ saved_version: 1, rendition: "failed" });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}d-v1.docx`]);
  });

  it("rendition larger than reserved is dropped as skipped, file still ready", async () => {
    const size = 6 * MiB;
    addFile({ id: "d", folder: "P", version: 1, size, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      if (ctl.url.includes("preview-pdf")) {
        ctl.progress(RENDITION_RESERVE(size) + 1);
        return new Promise(() => {});
      }
      putFile(ctl.dest, size);
      return 200;
    };
    await runOfflineSync({ reason: "pin" });
    expect(await getFileRow(s, "d")).toMatchObject({ saved_version: 1, rendition: "skipped" });
    expect((await listPins(s))[0].status).toBe("ready");
    expect(filesUnder(tmpDir())).toEqual([]);
  });

  it("budget full, same-size replacement is allowed", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 100 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    useOfflineStore.getState().setBudget(100);
    server.files.get("a")!.version = 2;
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 2 });
    await runOfflineSync({ reason: "manual" }); // the sweep takes v1
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v2.txt`]);
  });

  it("bigger replacement over budget is refused, saved version kept", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 100 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    useOfflineStore.getState().setBudget(150);
    server.files.get("a")!.version = 2;
    server.files.get("a")!.size = 200;
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`]);
    expect((await listPins(s))[0].status).toBe("over_budget");
  });

  it("not enough free space marks no_space and keeps what is saved", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 100 });
    await pinFolder("P");
    fsState.capacity = FREE_SPACE_FLOOR_BYTES + 50;
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({});
    expect((await listPins(s))[0].status).toBe("no_space");
  });

  it("transfer cancelled when written bytes exceed size_bytes", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 100 });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      ctl.progress(101);
      return new Promise(() => {});
    };
    await runOfflineSync({ reason: "pin" });
    expect(fsState.downloads[0].cancelled).toBe(true);
    expect(await savedVersions()).toEqual({});
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("transfer cancelled when free space hits the floor mid-transfer", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 100 * MiB });
    await pinFolder("P");
    fsState.capacity = FREE_SPACE_FLOOR_BYTES + 101 * MiB;
    fsState.impl = async (ctl) => {
      fsState.capacity -= 50 * MiB; // another app fills the disk while we download
      ctl.progress(10 * MiB); // past the probe threshold: free space is read again
      await tick();
      ctl.progress(70 * MiB);
      return new Promise(() => {});
    };
    await runOfflineSync({ reason: "pin" });
    expect(fsState.downloads[0].cancelled).toBe(true);
    expect(await savedVersions()).toEqual({});
    expect((await listPins(s))[0].status).toBe("no_space");
  });

  it("leaving Wi-Fi mid-transfer cancels; saved version kept", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.get("a")!.version = 2;
    fsState.impl = async () => {
      mockNet.state = { isConnected: true, type: "CELLULAR" };
      for (const l of [...mockNet.listeners]) l(mockNet.state);
      return new Promise(() => {});
    };
    await runOfflineSync({ reason: "manual" });
    expect(fsState.downloads[fsState.downloads.length - 1].cancelled).toBe(true);
    expect(await savedVersions()).toEqual({ a: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`]);
    expect(filesUnder(tmpDir())).toEqual([]);
    expect((await listPins(s))[0].status).toBe("waiting_wifi");
  });

  it("HTTP error body never published", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      putFile(ctl.dest, 10, '{"ok":false,"error":"expired"}');
      return 403;
    };
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({});
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("a manifest 403 deletes nothing; the next check decides", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.get("a")!.version = 2;
    const base = mockApi.handler!;
    mockApi.handler = async (path, opts) => {
      if (path === "/api/sync/download-manifest") throw new ApiError("Not a member", 403);
      return base(path, opts);
    };
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}a-v1.txt`]);
  });

  it("missing lock_mode keeps the saved copy and starts no transfer", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.get("a")!.lock = "";
    server.files.get("a")!.version = 2;
    (apiRequest as jest.Mock).mockClear();
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
  });

  it("endSession during publish waits for it, then wipes; nothing survives", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    addFile({ id: "b", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const log: string[] = [];
    const realMove = (fsModule.moveAsync as jest.Mock).getMockImplementation()!;
    let ended: Promise<void> | null = null;
    (fsModule.moveAsync as jest.Mock).mockImplementationOnce(async (args: { from: string; to: string }) => {
      ended = endSession().then(() => { log.push("session ended"); });
      await tick();
      await realMove(args);
      log.push("published");
    });
    const run = runOfflineSync({ reason: "pin" });
    await new Promise<void>((r) => { const wait = () => (ended ? r() : setTimeout(wait, 1)); wait(); });
    await ended;
    // The purge, as sign-out runs it.
    await closeOfflineDb();
    await wipeAccount("acct");
    dropSqliteUnder(s.root);
    await run;
    expect(log).toEqual(["published", "session ended"]);
    expect(filesUnder(s.root)).toEqual([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("never throws, even when the database cannot open", async () => {
    await pinFolder("P");
    (fsModule.getFreeDiskStorageAsync as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    jest.spyOn(FileSystem, "readDirectoryAsync").mockRejectedValueOnce(new Error("io"));
    mockApi.handler = async () => { throw new Error("boom"); };
    await expect(runOfflineSync({ reason: "manual" })).resolves.toBeUndefined();
  });

  it("a second call while running joins it and runs once more after", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const first = runOfflineSync({ reason: "pin" });
    const second = runOfflineSync({ reason: "manual" });
    await Promise.all([first, second]);
    expect(calls("/api/sync/snapshot")).toHaveLength(2);
  });
});

describe("review fixes", () => {
  it("a rename between runs keeps the copy openable, and the sweep keeps it", async () => {
    addFile({ id: "n", folder: "P", version: 3, size: 10, ext: "txt" });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    // Renamed on the server: same version, new name and extension.
    server.files.get("n")!.ext = "md";
    await runOfflineSync({ reason: "manual" });
    await runOfflineSync({ reason: "manual" });
    expect(await getFileRow(s, "n")).toMatchObject({ extension: "md", saved_ext: "txt", saved_version: 3 });
    expect(await savedCopy("n")).toEqual({ uri: `${filesDir()}n-v3.txt`, version: 3, rendition: "none" });
    expect(filesUnder(filesDir())).toEqual([`${filesDir()}n-v3.txt`]);
  });

  it("switching to cellular during the check phase starts no transfer", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    server.onSnapshot = async () => { mockNet.state = { isConnected: true, type: "CELLULAR" }; };
    await runOfflineSync({ reason: "pin" });
    expect(calls("/api/sync/download-manifest")).toHaveLength(0);
    expect(fsState.downloads).toHaveLength(0);
    expect((await listPins(s))[0].status).toBe("waiting_wifi");
  });

  it("losing Wi-Fi between transfer batches stops before the next batch", async () => {
    for (let i = 0; i < 60; i += 1) addFile({ id: `f${String(i).padStart(2, "0")}`, folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    let downloads = 0;
    fsState.impl = async (ctl) => {
      downloads += 1;
      putFile(ctl.dest, 10);
      // Drop to cellular without an event, as a missed listener would.
      if (downloads === 50) mockNet.state = { isConnected: true, type: "CELLULAR" };
      return 200;
    };
    await runOfflineSync({ reason: "pin" });
    expect(calls("/api/sync/download-manifest")).toHaveLength(1);
    expect(downloads).toBe(50);
  });

  it("Ethernet counts as Wi-Fi", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    mockNet.state = { isConnected: true, type: "ETHERNET" };
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("an unknown network type (a VPN on iOS) waits for Wi-Fi", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    mockNet.state = { isConnected: true, type: "UNKNOWN" };
    await runOfflineSync({ reason: "pin" });
    expect(await savedVersions()).toEqual({});
    expect((await listPins(s))[0].status).toBe("waiting_wifi");
  });

  it("an apply that fails part way changes nothing, so a rerun counts one miss, not two", async () => {
    addFile({ id: "x", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    server.files.delete("x");
    server.check = (_ws, ids) => ({ ok: true, decisions: Object.fromEntries(ids.map((id) => [id, "allowed"])) });
    const spy = jest.spyOn(db, "upsertMeta").mockRejectedValueOnce(new Error("killed"));
    await runOfflineSync({ reason: "manual" });
    expect((await listMembers(s))[0]).toMatchObject({ file_id: "x", missing_count: 0 });
    spy.mockRestore();
    await runOfflineSync({ reason: "manual" });
    expect((await listMembers(s))[0]).toMatchObject({ file_id: "x", missing_count: 1 });
    expect(await savedVersions()).toEqual({ x: 1 });
  });

  it("a download with no progress is cancelled after the stall limit", async () => {
    __setTimeoutsForTests({ stallMs: 20 });
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    fsState.impl = async () => new Promise(() => {});
    await runOfflineSync({ reason: "pin" });
    expect(fsState.downloads[0].cancelled).toBe(true);
    expect(await savedVersions()).toEqual({});
    expect(filesUnder(tmpDir())).toEqual([]);
  });

  it("a request that never answers times out and the run ends", async () => {
    __setRequestTimeoutForTests(20);
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const base = mockApi.handler!;
    mockApi.handler = async (path, opts) => (path === "/api/sync/download-manifest" ? new Promise(() => {}) : base(path, opts));
    await runOfflineSync({ reason: "pin" });
    expect((await listPins(s))[0].status).toBe("error");
  });

  it("a run stuck past the ceiling releases the next run", async () => {
    __setTimeoutsForTests({ runCeilingMs: 30 });
    __setRequestTimeoutForTests(60_000);
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const base = mockApi.handler!;
    let hang = true;
    mockApi.handler = async (path, opts) => (hang && path.startsWith("/api/sync/snapshot") ? new Promise(() => {}) : base(path, opts));
    await runOfflineSync({ reason: "pin" });
    hang = false;
    await runOfflineSync({ reason: "manual" });
    expect(await savedVersions()).toEqual({ a: 1 });
  });

  it("a download cannot start after endSession", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    const base = mockApi.handler!;
    mockApi.handler = async (path, opts) => {
      const r = await base(path, opts);
      if (path === "/api/sync/download-manifest") await endSession();
      return r;
    };
    await runOfflineSync({ reason: "pin" });
    expect(fsState.downloads).toHaveLength(0);
    expect(filesUnder(`${s.root}tmp/`)).toEqual([]);
    expect(filesUnder(`${s.root}files/`)).toEqual([]);
  });

  it("a late native write into a signed-out account's root is removed", async () => {
    addFile({ id: "a", folder: "P", version: 1, size: 10 });
    await pinFolder("P");
    fsState.impl = async (ctl) => {
      // Sign-out lands mid-download; the native side still writes afterwards.
      await endSession();
      await closeOfflineDb();
      await wipeAccount("acct");
      setTimeout(() => putFile(ctl.dest, 10), 2);
      return new Promise(() => {});
    };
    await runOfflineSync({ reason: "pin" });
    await new Promise((r) => setTimeout(r, 40));
    expect(filesUnder(s.root)).toEqual([]);
  });

  it("another account's directory left by a killed purge is swept on start", async () => {
    putFile(`${OFFLINE_ROOT}someone-else/files/x-v1.txt`, 10);
    putFile(`${OFFLINE_ROOT}someone-else/offline.db`, 1);
    await pinFolder("P");
    await runOfflineSync({ reason: "pin" });
    expect(filesUnder(`${OFFLINE_ROOT}someone-else/`)).toEqual([]);
  });

  it("an unpin during a conversion wait ends the polling", async () => {
    addFile({ id: "d", folder: "P", version: 1, size: 100, mime: DOCX, ext: "docx" });
    await pinFolder("P");
    let polls = 0;
    fsState.impl = async (ctl) => {
      if (ctl.url.includes("preview-pdf")) {
        polls += 1;
        putFile(ctl.dest, 20);
        return 503;
      }
      putFile(ctl.dest, 100);
      return 200;
    };
    __setSleepForTests(async () => { if (polls === 2) await unpinRaw("P"); });
    await runOfflineSync({ reason: "pin" });
    expect(polls).toBe(2);
    expect(await listFiles(s)).toEqual([]);
    expect(filesUnder(s.root)).toEqual([]);
  });
});
