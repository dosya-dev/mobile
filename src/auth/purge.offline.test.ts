/**
 * Sign-out and account switch remove every offline byte and row of the account
 * that left (G3 in docs/superpowers/plans/2026-11-04-mobile-offline-files.md),
 * including from a transfer that was running. These run the REAL offline
 * session, database and byte store (an in-memory file system and a real SQLite
 * engine); only the unrelated purge steps are stubbed.
 */
jest.mock("expo-file-system/legacy", () => require("../offline/testing/memoryFs").fsModule);
jest.mock("expo-sqlite", () => require("../offline/testing/sqliteNode").sqliteModule);
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => false) }));
jest.mock("expo-background-task", () => ({
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
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
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-image", () => ({ Image: { clearMemoryCache: jest.fn(async () => true), clearDiskCache: jest.fn(async () => true) } }));
jest.mock("@/files/fileCache", () => ({ clearCachedFileBytes: jest.fn(async () => {}) }));
jest.mock("@/lib/queryPersist", () => ({ clearPersistedQueryCache: jest.fn(async () => {}) }));
jest.mock("@/backup/orchestrator", () => ({ stopBackup: jest.fn() }));
jest.mock("@/backup/ledger", () => ({ clearLedger: jest.fn(async () => {}) }));
jest.mock("@/backup/transport/backgroundTransport", () => ({ clearBackgroundUploads: jest.fn(async () => {}) }));
jest.mock("@/backup/history", () => ({ clearHistory: jest.fn(async () => {}) }));
jest.mock("@/backup/settings", () => ({ resetBackupSettings: jest.fn(async () => {}) }));
jest.mock("@/contacts/backupContacts", () => ({ clearContactsBackupState: jest.fn(async () => {}) }));
jest.mock("@/backup/completion", () => ({ resetBackupCompletionState: jest.fn() }));
jest.mock("@/backup/alertReport", () => ({ clearBackupAlertReport: jest.fn(async () => {}) }));
jest.mock("@/backup/statusBridge", () => ({ clearWidgetLastStats: jest.fn(async () => {}), clearWidgetSnapshot: jest.fn() }));
jest.mock("@/backup/watermark", () => ({ clearWatermarks: jest.fn(async () => {}) }));
jest.mock("@/incar/recents", () => ({ clearIncarHistory: jest.fn(async () => {}) }));
jest.mock("@/upload/persist", () => ({ clearPersistedUploads: jest.fn(async () => {}) }));
jest.mock("@/onboarding/onboardingState", () => ({ clearOnboarding: jest.fn(async () => {}) }));
jest.mock("@/filesProvider/link", () => ({ unlinkFilesProvider: jest.fn(async () => {}) }));
jest.mock("@/player/controller", () => ({ stopAndClear: jest.fn(async () => {}) }));
jest.mock("@/vault/store", () => ({ lockVaultForPurge: jest.fn(async () => {}) }));
jest.mock("@/personas/device/teardown", () => ({ teardownPersonas: jest.fn(), lastPersonasUser: jest.fn(() => null) }));
jest.mock("@/personas/device/wipe", () => ({ wipePersonasDevice: jest.fn(async () => {}) }));
jest.mock("@/personas/device/settings", () => ({ resetReadSettings: jest.fn(async () => {}) }));

import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { ApiError } from "@/api/errors";
import { dropSqliteUnder, resetSqlite } from "../offline/testing/sqliteNode";
import { filesUnder, fsState, putFile, resetFs } from "../offline/testing/memoryFs";
import { accountRoot, beginSession, currentSession, withCommit, __resetSessionForTests, type OfflineSession } from "../offline/session";
import { addMembers, closeOfflineDb, listPins, publishSaved, upsertMeta, upsertPin } from "../offline/db";
import { finalPath } from "../offline/store";
import * as sync from "../offline/sync";
import { useOfflineStore } from "../offline/offlineStore";
import { pendingOfflinePurge, purgeAccountData, __setOfflineStepBoundForTests } from "./purge";
import { clearCachedFileBytes } from "@/files/fileCache";
import { OFFLINE_ROOT } from "../offline/session";

let s: OfflineSession;

async function plantSaved(session: OfflineSession, pinId: string, fileId: string) {
  await withCommit(session, async () => {
    await upsertPin(session, { id: pinId, kind: "folder", workspace_id: "w1", name: pinId, created_at: 1 });
    await upsertMeta(session, [{
      file_id: fileId, workspace_id: "w1", folder_id: pinId, name: `${fileId}.txt`, extension: "txt", mime_type: "text/plain",
      size_bytes: 10, current_version: 1, updated_at: 1, lock_mode: "none",
    }]);
    await addMembers(session, pinId, [fileId]);
    await publishSaved(session, fileId, { version: 1, size: 10, rendition: "none", renditionSize: null });
    putFile(finalPath(session, fileId, 1, "txt"), 10);
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
  __setOfflineStepBoundForTests(null);
  s = beginSession("acct");
});

describe("purgeAccountData and offline files", () => {
  it("purge ends the offline session (waiting for a running commit), unregisters the task and wipes the account root", async () => {
    await plantSaved(s, "P", "a");
    await useOfflineStore.getState().refresh();
    expect(useOfflineStore.getState().pins).toHaveLength(1);
    (TaskManager.isTaskRegisteredAsync as jest.Mock).mockResolvedValueOnce(true);

    // A commit is holding the lock when the purge starts. The wipe must wait
    // for it, and whatever it wrote must still go.
    let release!: () => void;
    let committing!: () => void;
    const inCommit = new Promise<void>((r) => { committing = r; });
    const commit = withCommit(s, async () => {
      committing();
      await new Promise<void>((r) => { release = r; });
      putFile(finalPath(s, "late", 1, "txt"), 10);
    });
    await inCommit;
    const purge = purgeAccountData("acct");
    await new Promise((r) => setTimeout(r, 10));
    // Still waiting on the commit: nothing wiped under it yet.
    expect(filesUnder(accountRoot("acct")).length).toBeGreaterThan(0);
    release();
    await commit;
    await purge;

    expect(currentSession()).toBeNull();
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith("dosya-offline-sync");
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
    expect(useOfflineStore.getState().pins).toEqual([]);
    expect(useOfflineStore.getState().savedFileIds.size).toBe(0);
    // A new session for the same account opens an empty database.
    const again = beginSession("acct");
    expect(await listPins(again)).toEqual([]);
  });

  it("a download finishing after purge writes nothing", async () => {
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
    // Half the bytes are already in tmp/ when the purge starts; the transfer
    // then runs to its end after the purge has finished. A cancelled native
    // download never moves its file into place (iOS completes into its own
    // temp location; Android's open stream points at an unlinked file), so
    // the rest only lands if the task was not cancelled.
    let release!: () => void;
    let started!: () => void;
    const downloading = new Promise<void>((r) => { started = r; });
    fsState.impl = async (ctl) => {
      putFile(ctl.dest, 5);
      started();
      await new Promise<void>((r) => { release = r; });
      if (!ctl.cancelled) putFile(ctl.dest, 10);
      return 200;
    };
    const run = sync.runOfflineSync({ reason: "pin" });
    await downloading;

    await purgeAccountData("acct");
    expect(filesUnder(accountRoot("acct"))).toEqual([]);

    release();
    await run;
    await new Promise((r) => setTimeout(r, 10));

    expect(currentSession()).toBeNull();
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
    const again = beginSession("acct");
    expect(await listPins(again)).toEqual([]);
  });

  it("purge with no account id wipes the account whose session is running", async () => {
    await plantSaved(s, "P", "a");
    await purgeAccountData(null);
    expect(currentSession()).toBeNull();
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
  });

  it("an account switch: the previous account's purge leaves the next account's session running", async () => {
    // The next account has already begun (its session fenced the old one). The
    // purge of the old account removes its files, and nothing of the new one's.
    await plantSaved(s, "P", "a");
    const next = beginSession("acct-2");
    await plantSaved(next, "Q", "b");
    await purgeAccountData("acct");
    expect(currentSession()?.accountId).toBe("acct-2");
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
    expect(filesUnder(accountRoot("acct-2"))).toHaveLength(1);
    expect((await listPins(next)).map((p) => p.id)).toEqual(["Q"]);
    expect(BackgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();
  });

  it("pendingOfflinePurge is set while a purge's offline steps run, and clear after", async () => {
    expect(pendingOfflinePurge()).toBeNull();
    const purge = purgeAccountData("acct");
    const pending = pendingOfflinePurge();
    expect(pending).not.toBeNull();
    await pending;
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
    await purge;
    expect(pendingOfflinePurge()).toBeNull();
  });
});

describe("purge bounds and settings", () => {
  it("a commit that never finishes does not stop the rest of sign-out, and a late commit is fenced", async () => {
    __setOfflineStepBoundForTests(20);
    await plantSaved(s, "P", "a");
    let committing!: () => void;
    const inCommit = new Promise<void>((r) => { committing = r; });
    void withCommit(s, async () => { committing(); await new Promise(() => {}); });
    await inCommit;
    const lateWrite = jest.fn(async () => "wrote");
    const late = withCommit(s, lateWrite);
    await purgeAccountData("acct");
    expect(clearCachedFileBytes).toHaveBeenCalled();
    expect(currentSession()).toBeNull();
    expect(filesUnder(accountRoot("acct"))).toEqual([]);
    expect(lateWrite).not.toHaveBeenCalled();
    void late;
  });

  it("a database close that never resolves does not stop the rest of sign-out", async () => {
    __setOfflineStepBoundForTests(20);
    await plantSaved(s, "P", "a");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require("../offline/db") as { closeOfflineDb: () => Promise<void> };
    const spy = jest.spyOn(dbModule, "closeOfflineDb").mockReturnValue(new Promise(() => {}));
    await purgeAccountData("acct");
    expect(clearCachedFileBytes).toHaveBeenCalled();
    expect(pendingOfflinePurge()).toBeNull();
    spy.mockRestore();
  });

  it("resets the mobile-data and budget settings, so the next account does not inherit them", async () => {
    await useOfflineStore.getState().hydrate();
    useOfflineStore.getState().setAllowCellular(true);
    useOfflineStore.getState().setBudget(5 * 1024 ** 3);
    await purgeAccountData("acct");
    expect(useOfflineStore.getState()).toMatchObject({ allowCellular: false, budgetBytes: null });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect((require("@/lib/keychain") as { deleteItem: jest.Mock }).deleteItem).toHaveBeenCalledWith("dosya.offline.settings");
  });

  it("with no account named and no session running, the offline data left on disk still goes", async () => {
    await plantSaved(s, "P", "a");
    await closeOfflineDb();
    __resetSessionForTests(); // a cold start: no session was ever begun this launch
    putFile(`${OFFLINE_ROOT}other/files/x-v1.txt`, 10);
    await purgeAccountData(null);
    expect(filesUnder(OFFLINE_ROOT)).toEqual([]);
  });
});
