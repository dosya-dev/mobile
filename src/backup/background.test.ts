const mockSecureMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockSecureMem.has(k) ? mockSecureMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecureMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockSecureMem.delete(k); }),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => false) }));
jest.mock("expo-background-task", () => ({
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
const mockMediaListener = { remove: jest.fn() };
jest.mock("expo-media-library", () => ({ addListener: jest.fn(() => mockMediaListener), MediaType: { photo: "photo", video: "video" } }));
const mockManuallyStopped = { value: false };
jest.mock("./orchestrator", () => ({
  runBackup: jest.fn(async () => ({ scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0 })),
  isManuallyStopped: jest.fn(() => mockManuallyStopped.value),
}));
jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "dosm_tok") }));
// The iOS background transport, and the native module behind it. Both are
// absent on Android, which `mockNativePresent` toggles.
const mockTransport = {
  settleFinishedJobs: jest.fn(async () => ({ uploaded: 0, requeued: 0 })),
  reconcileQueuedRows: jest.fn(async () => 0),
  queuedJobCount: jest.fn(async () => 0),
  sweepStagedOrphans: jest.fn(async () => {}),
};
// Passthrough arrows, not the object itself: the factory runs at the first
// require (above these `const` initializers), so it may only DEREFERENCE
// mockTransport later, when a call actually comes in.
jest.mock("./transport/backgroundTransport", () => ({
  settleFinishedJobs: () => mockTransport.settleFinishedJobs(),
  reconcileQueuedRows: () => mockTransport.reconcileQueuedRows(),
  queuedJobCount: () => mockTransport.queuedJobCount(),
  sweepStagedOrphans: () => mockTransport.sweepStagedOrphans(),
}));
const mockNativeListeners: Record<string, (p: unknown) => void> = {};
const mockNativeSub = { remove: jest.fn() };
const mockNativePresent = { value: true };
const mockNative = {
  addListener: jest.fn((event: string, fn: (p: unknown) => void) => {
    mockNativeListeners[event] = fn;
    return mockNativeSub;
  }),
};
jest.mock("../../modules/dosya-background-upload", () => ({
  backgroundUploadNative: () => (mockNativePresent.value ? mockNative : null),
}));
jest.mock("./policy", () => ({
  readPolicyInputs: jest.fn(async () => ({ connected: true, onWifi: true, charging: true, batteryPercent: 90 })),
  shouldRunBackup: jest.fn(() => ({ ok: true })),
}));

import { AppState } from "react-native";
import * as TaskManager from "expo-task-manager";
import {
  runBackupIfAllowed, startMediaChangeListener, startAutoBackupTriggers, registerBackupTask,
  defineBackupTask, startBackgroundUploadEvents, settleBackgroundUploads, __settleIdle, BACKUP_TASK,
} from "./background";
import { useBackupRun } from "./runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS, __resetBackupSettingsHydration } from "./settings";
import { DEFAULT_BACKUP_FILTERS } from "./filters";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { runBackup } from "./orchestrator";
import { getAccessToken } from "@/auth/authStore";
import { useUploadBlock, UPLOAD_BLOCK_KEY, __resetUploadBlockHydration } from "@/upload/uploadBlock";
import { useUploadStore } from "@/upload/store";
import { shouldRunBackup } from "./policy";
import * as MediaLibrary from "expo-media-library";
import * as BackgroundTask from "expo-background-task";
import * as i18n from "@/lib/i18n";
import { usePlayerStore } from "@/player/playerStore";

// Captured at file load, before beforeEach clears mocks: proves the task was
// defined at module scope (not inside a React effect).
const defineCallsAtLoad = (TaskManager.defineTask as jest.Mock).mock.calls.length;
// The periodic handler the OS invokes, captured here for the same reason:
// beforeEach clears the recorded calls it came from.
const taskHandler = (TaskManager.defineTask as jest.Mock).mock.calls[0][1] as () => Promise<unknown>;

// AppState drives the foreground catch-up run; the real one needs a native
// module. clearAllMocks() only clears recorded calls, so this survives.
const mockAppStateSub = { remove: jest.fn() };
jest.spyOn(AppState, "addEventListener").mockReturnValue(mockAppStateSub as never);

beforeEach(() => {
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true }, hydrated: true });
  useWorkspaceStore.setState({ activeId: "w1" } as never);
  useUploadBlock.setState({ reason: null });
  usePlayerStore.setState({ listening: false });
  mockSecureMem.clear();
  __resetUploadBlockHydration();
  jest.clearAllMocks();
});

describe("runBackupIfAllowed", () => {
  it("does not start an automatic run while music is playing", async () => {
    usePlayerStore.setState({ listening: true });
    expect(await runBackupIfAllowed()).toBe("skipped-policy");
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("skips when signed out (no access token)", async () => {
    (getAccessToken as jest.Mock).mockReturnValueOnce(null);
    expect(await runBackupIfAllowed()).toBe("skipped-no-auth");
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("skips when auto-backup is blocked by a prior fatal error (e.g. quota)", async () => {
    useUploadBlock.setState({ reason: "Storage limit reached." });
    expect(await runBackupIfAllowed()).toBe("skipped-blocked");
    expect(runBackup).not.toHaveBeenCalled();
    useUploadBlock.setState({ reason: null });
  });

  it("stays blocked after an app restart: a persisted quota block gates the run", async () => {
    // Fresh process: nothing in memory, but the block was persisted last session.
    mockSecureMem.set(UPLOAD_BLOCK_KEY, "Storage limit reached.");
    expect(await runBackupIfAllowed()).toBe("skipped-blocked");
    expect(runBackup).not.toHaveBeenCalled();
    expect(useUploadBlock.getState().reason).toBe("Storage limit reached.");
  });

  it("skips after a manual Stop until the user starts again (no 2s auto-restart)", async () => {
    mockManuallyStopped.value = true;
    expect(await runBackupIfAllowed()).toBe("skipped-user-stopped");
    expect(runBackup).not.toHaveBeenCalled();
    mockManuallyStopped.value = false;
    expect(await runBackupIfAllowed()).toBe("ran");
  });

  it("runs when enabled, has a workspace, and policy allows", async () => {
    expect(await runBackupIfAllowed()).toBe("ran");
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
  });
  it("skips when auto-backup is disabled", async () => {
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: false } });
    expect(await runBackupIfAllowed()).toBe("skipped-disabled");
    expect(runBackup).not.toHaveBeenCalled();
  });
  it("loads persisted settings first - a headless run has no React tree to have hydrated them", async () => {
    // The exact production shape: auto-backup was switched on in a PREVIOUS app
    // session, so it lives in SecureStore while this process still holds the
    // in-memory defaults (autoBackup: false). Reading the store without
    // hydrating first reports "disabled" and the periodic backup never runs.
    mockSecureMem.set("dosya.backup.settings", JSON.stringify({ ...DEFAULT_BACKUP_SETTINGS, autoBackup: true }));
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: false } });
    __resetBackupSettingsHydration();
    expect(await runBackupIfAllowed()).toBe("ran");
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
  });
  it("does not resurrect auto-backup that was switched off in this session", async () => {
    // Guard on the fix above: once hydrated, a stale persisted value must not
    // clobber the live one (update() persists, so re-reading is redundant).
    mockSecureMem.set("dosya.backup.settings", JSON.stringify({ ...DEFAULT_BACKUP_SETTINGS, autoBackup: true }));
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: false }, hydrated: true });
    expect(await runBackupIfAllowed()).toBe("skipped-disabled");
    expect(runBackup).not.toHaveBeenCalled();
  });
  it("skips when there is no active workspace", async () => {
    useWorkspaceStore.setState({ activeId: null } as never);
    expect(await runBackupIfAllowed()).toBe("skipped-no-workspace");
  });
  it("skips when policy blocks", async () => {
    (shouldRunBackup as jest.Mock).mockReturnValueOnce({ ok: false, reason: "waiting-for-wifi" });
    expect(await runBackupIfAllowed()).toBe("skipped-policy");
    expect(runBackup).not.toHaveBeenCalled();
  });
});

describe("module-scope task definition", () => {
  it("defines the task at module load and is idempotent", () => {
    expect(defineCallsAtLoad).toBeGreaterThanOrEqual(1);
    (TaskManager.defineTask as jest.Mock).mockClear();
    defineBackupTask(); // already defined - must be a no-op
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });
});

describe("registration + media listener", () => {
  it("registers the background task by name", async () => {
    await registerBackupTask();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKUP_TASK, expect.any(Object));
  });
  it("asks for the shortest cadence Android will honour (WorkManager's 15-minute floor)", async () => {
    await registerBackupTask();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKUP_TASK, { minimumInterval: 15 });
  });
});

describe("startAutoBackupTriggers", () => {
  it("watches the media library for the whole signed-in session, not just one screen", () => {
    const dispose = startAutoBackupTriggers();
    expect(MediaLibrary.addListener).toHaveBeenCalledTimes(1);
    dispose();
    expect(mockMediaListener.remove).toHaveBeenCalled();
  });

  it("runs a catch-up when the app is foregrounded, so time spent closed is reconciled", async () => {
    const dispose = startAutoBackupTriggers();
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1] as (s: string) => void;
    onChange("active");
    // The catch-up waits on the settle that precedes it (see the wake-up
    // wiring specs below), so the run is two ticks out, not one.
    await __settleIdle();
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
  });

  it("does not run a catch-up when merely going to background", async () => {
    const dispose = startAutoBackupTriggers();
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1] as (s: string) => void;
    onChange("background");
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).not.toHaveBeenCalled();
    dispose();
  });
  it("triggers a gated run on a media-library change and disposes cleanly", async () => {
    const dispose = startMediaChangeListener(0); // no debounce in the test
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls[0][0];
    cb({ hasIncrementalChanges: true, insertedAssets: [{ id: "x" }] });
    await new Promise((r) => setTimeout(r, 0));
    // Payload entries without a known mediaType are filtered out -> plain auto run.
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
    expect(mockMediaListener.remove).toHaveBeenCalled();
  });
});

describe("targeted runs from media-change payloads", () => {
  it("passes the inserted assets through so the run skips scanning entirely", async () => {
    const dispose = startMediaChangeListener(0);
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls.at(-1)[0];
    cb({
      insertedAssets: [
        { id: "ph1", filename: "IMG_1.jpg", creationTime: 1710000000000, modificationTime: 1710000005000, mediaType: "photo" },
        { id: "vid1", filename: "MOV_1.mp4", creationTime: 1710000001000, modificationTime: 1710000006000, mediaType: "video" },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, {
      auto: true,
      targetedAssets: [
        { id: "ph1", filename: "IMG_1.jpg", createdAt: 1710000000, modifiedAt: 1710000005, mediaType: "photo" },
        { id: "vid1", filename: "MOV_1.mp4", createdAt: 1710000001, modifiedAt: 1710000006, mediaType: "video" },
      ],
    });
    dispose();
  });

  it("drops inserted assets the filters exclude", async () => {
    useBackupSettings.setState({
      settings: {
        ...DEFAULT_BACKUP_SETTINGS, autoBackup: true,
        filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] },
      },
    });
    const dispose = startMediaChangeListener(0);
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls.at(-1)[0];
    cb({
      insertedAssets: [
        { id: "vid1", filename: "MOV_1.mp4", creationTime: 1710000001000, mediaType: "video" },
        { id: "ph1", filename: "IMG_1.jpg", creationTime: 1710000000000, mediaType: "photo" },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    // A brand-new photo arriving here must obey the same filters as a scan -
    // this path bypasses the scanner entirely. (No modificationTime on the
    // payload -> mapped to 0, and the upload skips the mtime header.)
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, {
      auto: true,
      targetedAssets: [{ id: "ph1", filename: "IMG_1.jpg", createdAt: 1710000000, modifiedAt: 0, mediaType: "photo" }],
    });
    dispose();
  });

  it("runs a plain incremental scan when the filters exclude everything inserted", async () => {
    useBackupSettings.setState({
      settings: {
        ...DEFAULT_BACKUP_SETTINGS, autoBackup: true,
        filters: { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] },
      },
    });
    const dispose = startMediaChangeListener(0);
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls.at(-1)[0];
    cb({ insertedAssets: [{ id: "vid1", filename: "MOV_1.mp4", creationTime: 1, mediaType: "video" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
  });

  it("abandons the targeted path entirely when an album filter is active", async () => {
    useBackupSettings.setState({
      settings: {
        ...DEFAULT_BACKUP_SETTINGS, autoBackup: true,
        filters: { ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["A1"] },
      },
    });
    const dispose = startMediaChangeListener(0);
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls.at(-1)[0];
    cb({ insertedAssets: [{ id: "ph1", filename: "IMG_1.jpg", creationTime: 1, mediaType: "photo" }] });
    await new Promise((r) => setTimeout(r, 0));
    // The payload names assets but not their album. Guessing membership is how
    // a filter silently leaks, so the run takes the normal incremental scan
    // instead - that path goes through the album loop.
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
  });

  it("falls back to a normal incremental run when any event in the burst lacks a payload", async () => {
    const dispose = startMediaChangeListener(0);
    const cb = (MediaLibrary.addListener as jest.Mock).mock.calls.at(-1)[0];
    cb({ insertedAssets: [{ id: "ph1", filename: "a.jpg", creationTime: 1, mediaType: "photo" }] });
    cb({}); // unknown change - must poison the burst
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
  });
});

describe("wake-up wiring: every path settles before it plans", () => {
  beforeEach(() => {
    useBackupRun.setState({ phase: "idle", workspaceId: null, workspaceName: null, startedAt: null });
    mockNativePresent.value = true;
    for (const k of Object.keys(mockNativeListeners)) delete mockNativeListeners[k];
  });

  const settledBefore = (other: jest.Mock): boolean =>
    mockTransport.settleFinishedJobs.mock.invocationCallOrder[0] < other.mock.invocationCallOrder[0];

  it("launch: folds in what iOS finished while the app was dead, then reconciles the rows it lost", async () => {
    await settleBackgroundUploads();
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalled();
    expect(mockTransport.reconcileQueuedRows).toHaveBeenCalled();
    // Order matters: reconcile treats "no native job" as lost, and the drain
    // inside the settle is what tells it which jobs have already reported.
    expect(settledBefore(mockTransport.reconcileQueuedRows)).toBe(true);
    // And then the files: a staged copy is only an orphan once reconcile has
    // decided that no row and no native job still owns it.
    expect(mockTransport.sweepStagedOrphans).toHaveBeenCalled();
    expect(mockTransport.reconcileQueuedRows.mock.invocationCallOrder[0])
      .toBeLessThan(mockTransport.sweepStagedOrphans.mock.invocationCallOrder[0]);
  });

  it("reads the saved workspace on a cold start, but never overwrites one already picked", async () => {
    // The reconcile sweeps a ledger per workspace, so a headless start has to
    // know which ones - nothing else in that process has read the selection.
    mockSecureMem.set("dosya.workspace", "w-saved");
    useWorkspaceStore.setState({ activeId: null, hydrated: false } as never);
    await settleBackgroundUploads();
    expect(useWorkspaceStore.getState().activeId).toBe("w-saved");

    // But a workspace picked seconds ago may not have reached the store on
    // disk yet: re-reading it there would put the user back on the old one.
    useWorkspaceStore.setState({ activeId: "w-just-picked", hydrated: false } as never);
    await settleBackgroundUploads();
    expect(useWorkspaceStore.getState().activeId).toBe("w-just-picked");
  });

  it("the periodic task settles before it scans and gives staging its own budget", async () => {
    await taskHandler();
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalled();
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, expect.objectContaining({ auto: true, deadlineMs: expect.any(Number) }));
    expect(settledBefore(runBackup as jest.Mock)).toBe(true);
  });

  it("foregrounding settles before the catch-up run plans", async () => {
    const dispose = startAutoBackupTriggers();
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1] as (s: string) => void;
    onChange("active");
    await __settleIdle();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalled();
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    expect(settledBefore(runBackup as jest.Mock)).toBe(true);
    dispose();
  });

  it("a finished job settles, tops up with a short deadline, and idles the run once the queue is empty", async () => {
    useBackupRun.setState({ phase: "uploading", workspaceId: "w1", workspaceName: "Personal" });
    const dispose = startBackgroundUploadEvents();
    mockNativeListeners.onJobFinished({ jobId: "j1", ok: true });
    await __settleIdle();

    // Events are not buffered while the app is dead and may name a job that is
    // already cancelled, so the payload is never read: the drain inside
    // settleFinishedJobs is the only source of truth.
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalledWith();
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, expect.objectContaining({ auto: true, deadlineMs: expect.any(Number) }));
    expect(settledBefore(runBackup as jest.Mock)).toBe(true);
    expect(useBackupRun.getState().phase).toBe("idle");
    dispose();
    expect(mockNativeSub.remove).toHaveBeenCalled();
  });

  it("settles nothing when the process is signed out", async () => {
    // The same gate runBackupIfAllowed applies: a settle registers finished
    // uploads with the API, and a headless slot after a sign-out has no session.
    (getAccessToken as jest.Mock).mockReturnValueOnce(null);
    await settleBackgroundUploads();
    expect(mockTransport.settleFinishedJobs).not.toHaveBeenCalled();
    expect(mockTransport.reconcileQueuedRows).not.toHaveBeenCalled();
  });

  it("leaves the run card up while an in-process backup is still uploading", async () => {
    // Nothing is queued natively, but a manual run (or a workspace the
    // transport cannot serve) is mid-flight in the upload store. Idling here
    // would leave a live run with no card.
    useBackupRun.setState({ phase: "uploading", workspaceId: "w1", workspaceName: "Personal" });
    useUploadStore.setState({
      items: [{ id: "bk_a_1", name: "a.jpg", uri: "u", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.4 }],
    } as never);

    const dispose = startBackgroundUploadEvents();
    mockNativeListeners.onJobFinished({ jobId: "j1", ok: true });
    await __settleIdle();

    expect(useBackupRun.getState().phase).toBe("uploading");
    useUploadStore.setState({ items: [] } as never);
    dispose();
  });

  it("leaves the run card up while jobs are still queued with iOS", async () => {
    useBackupRun.setState({ phase: "uploading", workspaceId: "w1", workspaceName: "Personal" });
    mockTransport.queuedJobCount.mockResolvedValueOnce(3);
    const dispose = startBackgroundUploadEvents();
    mockNativeListeners.onJobFinished({ jobId: "j1", ok: true });
    await __settleIdle();
    expect(useBackupRun.getState().phase).toBe("uploading");
    dispose();
  });

  it("publishes the OS queue's size to the run state on every finished job, down to zero", async () => {
    // The Backup screen and the drain check read this instead of polling the
    // native queue themselves, so there is one owner for "iOS still has work".
    useBackupRun.setState({ phase: "uploading", workspaceId: "w1", workspaceName: "Personal", backgroundJobs: 9 });
    mockTransport.queuedJobCount.mockResolvedValueOnce(3);
    const dispose = startBackgroundUploadEvents();
    mockNativeListeners.onJobFinished({ jobId: "j1", ok: true });
    await __settleIdle();
    expect(useBackupRun.getState().backgroundJobs).toBe(3);
    expect(useBackupRun.getState().phase).toBe("uploading");

    mockTransport.queuedJobCount.mockResolvedValueOnce(0);
    mockNativeListeners.onJobFinished({ jobId: "j2", ok: true });
    await __settleIdle();
    expect(useBackupRun.getState().backgroundJobs).toBe(0);
    expect(useBackupRun.getState().phase).toBe("idle");
    dispose();
  });

  it("never settles twice at once, however closely the events arrive", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockTransport.settleFinishedJobs.mockImplementationOnce(async () => { await gate; return { uploaded: 0, requeued: 0 }; });
    const dispose = startBackgroundUploadEvents();

    mockNativeListeners.onJobFinished({ jobId: "j1", ok: true });
    mockNativeListeners.onJobFinished({ jobId: "j2", ok: true });
    await Promise.resolve();
    // The second event waits: two drains in parallel would split one batch of
    // results across two complete-direct calls.
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalledTimes(1);

    release();
    await __settleIdle();
    expect(mockTransport.settleFinishedJobs).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("subscribes to nothing on Android, where the native module does not exist", () => {
    mockNativePresent.value = false;
    const dispose = startBackgroundUploadEvents();
    expect(mockNative.addListener).not.toHaveBeenCalled();
    dispose(); // must not throw
  });

  it("is a no-op on Android: nothing was ever handed to the OS to settle", async () => {
    mockNativePresent.value = false;
    const dispose = startAutoBackupTriggers();
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1] as (s: string) => void;
    onChange("active");
    await __settleIdle();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockTransport.settleFinishedJobs).not.toHaveBeenCalled();
    expect(mockTransport.reconcileQueuedRows).not.toHaveBeenCalled();
    // The catch-up run itself is unchanged: Android keeps its in-process engine.
    expect(runBackup).toHaveBeenCalledWith("w1", undefined, { auto: true });
    dispose();
  });

  it("the session triggers own the job-event subscription and let go of it", () => {
    const dispose = startAutoBackupTriggers();
    expect(mockNative.addListener).toHaveBeenCalledWith("onJobFinished", expect.any(Function));
    dispose();
    expect(mockNativeSub.remove).toHaveBeenCalled();
  });
});

describe("multi-destination auto runs", () => {
  it("backs up every configured destination sequentially", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, destinationIds: ["wA", "wB"] },
    });
    expect(await runBackupIfAllowed()).toBe("ran");
    expect((runBackup as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["wA", "wB"]);
  });

  it("stops rolling into the next workspace when a fatal block engages mid-set", async () => {
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true, destinationIds: ["wA", "wB"] },
    });
    (runBackup as jest.Mock).mockImplementationOnce(async () => {
      useUploadBlock.setState({ reason: "Storage limit reached." });
      return { scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0 };
    });
    await runBackupIfAllowed();
    expect((runBackup as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["wA"]);
    useUploadBlock.setState({ reason: null });
  });
});

describe("headless language", () => {
  it("boots the language before the periodic task does any work", async () => {
    // No React tree exists when the OS wakes this task; a notification it posts
    // must already be in the chosen language.
    const ensure = jest.spyOn(i18n, "ensureI18n");
    await taskHandler();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(runBackup).toHaveBeenCalled();
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan((runBackup as jest.Mock).mock.invocationCallOrder[0]);
    ensure.mockRestore();
  });
});