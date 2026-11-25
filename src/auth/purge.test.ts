const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));
// The offline steps run for real in purge.offline.test.ts; here they only
// need to load.
jest.mock("@/offline/background", () => ({ syncRegistration: jest.fn(async () => {}) }));
jest.mock("@/backup/orchestrator", () => ({ stopBackup: jest.fn() }));
jest.mock("@/backup/ledger", () => ({
  clearLedger: jest.fn(async () => {}),
  // The rows behind the jobs iOS still holds: their staged copies have to go
  // before the ledger that names them does.
  getByJobIds: jest.fn(async () => [
    { workspace_id: "w1", local_id: "a", job_id: "j1", session_id: "j1", staged_path: "/s/a", status: "queued" },
    { workspace_id: "w1", local_id: "b", job_id: "j2", session_id: "j2", staged_path: "/s/b", status: "queued" },
  ]),
  // A row iOS no longer knows about (its result was drained) still holds a
  // staged copy, and the ledger is the only place its path is written down.
  listByStatus: jest.fn(async () => [
    { workspace_id: "w1", local_id: "c", job_id: "j3", session_id: "j3", staged_path: "/s/c", status: "queued" },
  ]),
  // Which ledgers to sweep is read from the ledger itself, so a workspace the
  // settings no longer name is not left holding staged copies.
  distinctWorkspaceIds: jest.fn(async () => ["w1"]),
}));
// The iOS background-upload module: uploads it is still running belong to the
// account signing out, and iOS would otherwise keep pushing them to a
// workspace the device no longer has a session for.
const mockNative = {
  stage: jest.fn(async () => ({ staged: [], failed: [] })),
  enqueue: jest.fn(async () => {}),
  pending: jest.fn(async () => [{ jobId: "j1", state: "running" }, { jobId: "j2", state: "queued" }]),
  drain: jest.fn(async () => []),
  cancel: jest.fn(async () => {}),
  stagingUsage: jest.fn(async () => ({ bytes: 0, files: 0 })),
  removeStaged: jest.fn(async () => {}),
  addListener: jest.fn(() => ({ remove() {} })),
};
jest.mock("../../modules/dosya-background-upload", () => ({
  __native: mockNative,
  backgroundUploadNative: () => mockNative,
  STAGING_MAX_BYTES: 500 * 1024 * 1024,
  STAGING_MAX_FILES: 200,
}));
jest.mock("@/backup/history", () => ({ clearHistory: jest.fn(async () => {}) }));
jest.mock("@/contacts/backupContacts", () => ({ clearContactsBackupState: jest.fn(async () => {}) }));
jest.mock("@/backup/completion", () => ({ resetBackupCompletionState: jest.fn() }));
jest.mock("@/backup/statusBridge", () => ({
  clearWidgetLastStats: jest.fn(async () => {}),
  clearWidgetSnapshot: jest.fn(() => {}),
}));
jest.mock("@/backup/watermark", () => ({ clearWatermarks: jest.fn(async () => {}) }));
jest.mock("@/incar/recents", () => ({ clearIncarHistory: jest.fn(async () => {}) }));
jest.mock("@/onboarding/onboardingState", () => ({ clearOnboarding: jest.fn(async () => {}) }));
jest.mock("@/filesProvider/link", () => ({ unlinkFilesProvider: jest.fn(async () => {}) }));
jest.mock("@/player/controller", () => ({ stopAndClear: jest.fn(async () => {}) }));
jest.mock("@/vault/store", () => ({ lockVaultForPurge: jest.fn(async () => {}) }));
jest.mock("@/personas/device/teardown", () => ({ teardownPersonas: jest.fn(), lastPersonasUser: jest.fn(() => "u_last") }));
jest.mock("@/personas/device/wipe", () => ({ wipePersonasDevice: jest.fn(async () => {}) }));
jest.mock("@/personas/device/settings", () => ({ resetReadSettings: jest.fn(async () => {}) }));

import { purgeAccountData } from "./purge";
import { teardownPersonas } from "@/personas/device/teardown";
import { wipePersonasDevice } from "@/personas/device/wipe";
import { resetReadSettings } from "@/personas/device/settings";
import { lockVaultForPurge } from "@/vault/store";
import { unlinkFilesProvider } from "@/filesProvider/link";
import { stopAndClear } from "@/player/controller";
import { clearOnboarding } from "@/onboarding/onboardingState";
import { queryClient } from "@/lib/queryClient";
import { stopBackup } from "@/backup/orchestrator";
import { clearLedger } from "@/backup/ledger";
import { clearHistory } from "@/backup/history";
import { clearContactsBackupState } from "@/contacts/backupContacts";
import { resetBackupCompletionState } from "@/backup/completion";
import { clearWidgetLastStats } from "@/backup/statusBridge";
import * as statusBridge from "@/backup/statusBridge";
import { clearWatermarks } from "@/backup/watermark";
import { clearIncarHistory } from "@/incar/recents";
import { useUploadStore } from "@/upload/store";
import { usePacing } from "@/upload/pacing";
import { useUploadBlock } from "@/upload/uploadBlock";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";

describe("purgeAccountData", () => {
  // clearAllMocks only resets call history (not implementations set via
  // jest.fn(impl) / mockResolvedValue), so it can't disturb this file's other
  // tests - but it stops a later test's mock-call assertions from being
  // satisfied by a call an EARLIER test made on the same shared mock.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes the iOS Files location for this account before the first await", async () => {
    // A quick re-sign-in queues its Files link as soon as the purge yields. The
    // unlink must already be queued by then, or it would run after the link and
    // remove the location the new session just registered.
    let unlinkedBeforeYield = false;
    (stopAndClear as jest.Mock).mockImplementationOnce(async () => {
      unlinkedBeforeYield = (unlinkFilesProvider as jest.Mock).mock.calls.length === 1;
    });
    await purgeAccountData("acct-1");
    expect(unlinkFilesProvider).toHaveBeenCalledWith("acct-1");
    expect(unlinkedBeforeYield).toBe(true);
  });

  it("leaves no account-scoped state behind", async () => {
    // Seed everything a signed-in session accumulates.
    queryClient.setQueryData(["workspaces"], [{ id: "w1", name: "Old Account WS" }]);
    useWorkspaceStore.setState({ activeId: "w1" } as never);
    mockMem.set("dosya.workspace", "w1");
    useUploadStore.setState({
      items: [{ id: "bk_x", name: "x.jpg", uri: "u", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "done", progress: 1 }],
      batchStartedAt: 123,
    });
    useUploadBlock.setState({ reason: "Storage limit reached." });
    mockMem.set("dosya.upload.block", "Storage limit reached.");
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    mockMem.set("dosya.backup.settings", JSON.stringify({ autoBackup: true }));
    mockMem.set("dosya.backup.lastRun", "1710000000");

    const clearSpy = jest.spyOn(queryClient, "clear");
    await purgeAccountData(null);

    expect(stopBackup).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(queryClient.getQueryData(["workspaces"])).toBeUndefined();
    expect(useWorkspaceStore.getState().activeId).toBeNull();
    expect(mockMem.has("dosya.workspace")).toBe(false);
    expect(useUploadStore.getState().items).toHaveLength(0);
    expect(useUploadStore.getState().batchStartedAt).toBeNull();
    expect(useUploadBlock.getState().reason).toBeNull();
    expect(mockMem.has("dosya.upload.block")).toBe(false);
    expect(useBackupSettings.getState().settings).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(mockMem.has("dosya.backup.settings")).toBe(false);
    expect(mockMem.has("dosya.backup.lastRun")).toBe(false);
    expect(clearLedger).toHaveBeenCalled();
    expect(clearHistory).toHaveBeenCalled();
    expect(clearContactsBackupState).toHaveBeenCalled();
    expect(resetBackupCompletionState).toHaveBeenCalled();
    expect(clearWidgetLastStats).toHaveBeenCalled();
    expect(clearWatermarks).toHaveBeenCalled();
    // CarPlay's Continue Listening / Recently Played live in their own SQLite
    // db (src/incar/recents.ts) - without this the next account signing in on
    // the same device sees the previous account's listening history.
    expect(clearIncarHistory).toHaveBeenCalled();
    // Personas: no read loop, reader WebView or photo listing of the previous
    // account survives, and the next one starts on Wi-Fi and charging only.
    expect(teardownPersonas).toHaveBeenCalled();
    expect(resetReadSettings).toHaveBeenCalled();
  });

  it("removes the signed-out user's personas key and caches, falling back to the last user, and a failing wipe does not stop the purge", async () => {
    await purgeAccountData("u_1");
    expect(wipePersonasDevice).toHaveBeenLastCalledWith("u_1");
    await purgeAccountData(null);
    expect(wipePersonasDevice).toHaveBeenLastCalledWith("u_last");
    (wipePersonasDevice as jest.Mock).mockRejectedValueOnce(new Error("keychain locked"));
    await expect(purgeAccountData("u_1")).resolves.toBeUndefined();
    expect(clearLedger).toHaveBeenCalled();
  });

  it("keeps device-level preferences (last sign-in method untouched)", async () => {
    mockMem.set("dosya.last_method", "google");
    await purgeAccountData(null);
    expect(mockMem.get("dosya.last_method")).toBe("google");
  });

  it("turns App lock off, so the next sign-in starts without the old PIN", async () => {
    mockMem.set("dosya.applock.pin", "salt:hash");
    mockMem.set("dosya.applock.after", "300");
    mockMem.set("dosya.applock.fails", "3");
    mockMem.set("dosya.biometric", "1");
    await purgeAccountData(null);
    for (const k of ["dosya.applock.pin", "dosya.applock.after", "dosya.applock.fails", "dosya.biometric"]) {
      expect(mockMem.has(k)).toBe(false);
    }
  });

  it("never throws even if a step fails (best-effort purge)", async () => {
    (clearLedger as jest.Mock).mockRejectedValueOnce(new Error("db locked"));
    await expect(purgeAccountData(null)).resolves.toBeUndefined();
    // Later steps still ran despite the earlier failure.
    expect(clearHistory).toHaveBeenCalled();
  });

  it("clears the native widget snapshot so the next account sees nothing", async () => {
    const spy = jest.spyOn(statusBridge, "clearWidgetSnapshot").mockImplementation(() => {});
    await purgeAccountData(null);
    expect(spy).toHaveBeenCalled();
  });

  it("clears the signed-out account's onboarding state", async () => {
    await purgeAccountData("acct-1");
    expect(clearOnboarding).toHaveBeenCalledWith("acct-1");
  });

  it("locks the Vault and forgets its Spaces list, for the account signing out", async () => {
    await purgeAccountData("acct-1");
    expect(lockVaultForPurge).toHaveBeenCalledWith("acct-1");
  });

  it("purges everything else even without an account id", async () => {
    await expect(purgeAccountData(null)).resolves.toBeUndefined();
    expect(clearOnboarding).not.toHaveBeenCalled();
  });
});

describe("purgeAccountData - background uploads do not outlive the account", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cancels every job iOS still holds and removes their staged copies before the ledger goes", async () => {
    // An account still on a workspace: the ledger it names is where the
    // already-drained rows' staged paths live.
    useWorkspaceStore.setState({ activeId: "w1" } as never);

    await purgeAccountData("acct-1");

    expect(mockNative.cancel).toHaveBeenCalledWith(["j1", "j2"]);
    expect(mockNative.removeStaged).toHaveBeenCalledWith(["/s/a", "/s/b", "/s/c"]);
    // Strictly before clearLedger: the staged paths are only knowable from the
    // rows, so wiping the ledger first would leave the copies on disk forever.
    expect(mockNative.removeStaged.mock.invocationCallOrder[0])
      .toBeLessThan((clearLedger as jest.Mock).mock.invocationCallOrder[0]);
  });
});

describe("purgeAccountData - the manual backup permission does not outlive the account", () => {
  it("withdraws a granted 'over mobile data this time' override", async () => {
    // Signing out while a manual cellular run was in flight: purge's first step
    // is stopBackup (mocked here), so the reset has to be purge's own.
    usePacing.setState({ policyOverride: { wifi: true, charging: true } });
    await purgeAccountData("u1");
    expect(usePacing.getState().policyOverride).toEqual({ wifi: false, charging: false });
  });
});
