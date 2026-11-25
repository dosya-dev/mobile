const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));

import { startStatusBridge, __resetStatusBridge, deriveSnapshot } from "./statusBridge";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useAppearance } from "@/theme/themeStore";
import { THEME_TOKENS } from "@/theme/tokens";
import { queryClient } from "@/lib/queryClient";
import { useBackupRun } from "./runState";
import { useUploadStore } from "@/upload/store";
import type { UploadItem } from "@/upload/types";

const item = (id: string, status: UploadItem["status"], progress = 0): UploadItem => ({
  id, name: id, uri: "u", size: 100, mime: "image/jpeg", folderId: null, workspaceId: "w1", status, progress,
});

function fakeNative() {
  return {
    setSnapshot: jest.fn(),
    startActivity: jest.fn(),
    updateActivity: jest.fn(),
    endActivity: jest.fn(),
  };
}

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  clock = 1_000_000;
  mockMem.clear();
  __resetStatusBridge();
  useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
  useUploadStore.setState({ items: [], batchStartedAt: null });
  useWorkspaceStore.setState({ activeId: "w1" } as never);
  useAppearance.setState({ theme: "default", mode: "system" } as never);
  queryClient.clear();
});

describe("deriveSnapshot", () => {
  it("counts only backup items", () => {
    useUploadStore.setState({
      batchStartedAt: clock - 10_000,
      items: [item("bk_1", "done", 1), item("bk_2", "uploading", 0.5), item("manual", "uploading", 0.5)],
    });
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    const s = deriveSnapshot(clock);
    expect(s.total).toBe(2);
    expect(s.done).toBe(1);
    expect(s.workspaceName).toBe("Personal");
    expect(s.phase).toBe("uploading");
  });

  it("carries workspace storage from the query cache and the active theme's colors", () => {
    queryClient.setQueryData(["workspace-storage", "w1"], { used: 12, total: 50, free: 38 });
    useAppearance.setState({ theme: "ocean" } as never);
    const s = deriveSnapshot(clock);
    expect(s.storageUsed).toBe(12);
    expect(s.storageTotal).toBe(50);
    expect(s.theme.light.go).toBe(THEME_TOKENS.ocean.light.primary);
    expect(s.theme.dark.bg).toBe(THEME_TOKENS.ocean.dark.card);
  });

  it("leaves storage null when the query has not resolved", () => {
    const s = deriveSnapshot(clock);
    expect(s.storageUsed).toBeNull();
    expect(s.storageTotal).toBeNull();
  });
});

describe("startStatusBridge", () => {
  it("starts, updates (throttled), and ends the Live Activity across a run", () => {
    const native = fakeNative();
    startStatusBridge(native, now);

    // Run starts: scanning phase + first items enqueued -> activity starts.
    useBackupRun.setState({ phase: "uploading", workspaceName: "Personal", startedAt: 1 });
    useUploadStore.setState({ batchStartedAt: clock, items: [item("bk_1", "uploading", 0.1), item("bk_2", "queued")] });
    expect(native.startActivity).toHaveBeenCalledWith("Personal", 2);

    // Progress within the throttle window -> no update yet.
    useUploadStore.setState({ batchStartedAt: clock, items: [item("bk_1", "uploading", 0.5), item("bk_2", "queued")] });
    expect(native.updateActivity).not.toHaveBeenCalled();

    // Past the throttle window -> update flows.
    clock += 4_000;
    useUploadStore.setState({ batchStartedAt: clock - 4_000, items: [item("bk_1", "done", 1), item("bk_2", "uploading", 0.2)] });
    expect(native.updateActivity).toHaveBeenCalled();

    // Run drains -> activity ends with the final counts.
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    useUploadStore.setState({ items: [item("bk_1", "done", 1), item("bk_2", "done", 1)] });
    expect(native.endActivity).toHaveBeenCalledWith(2, 2);
  });

  it("pushes widget snapshots on phase transitions and throttles the rest", () => {
    const native = fakeNative();
    startStatusBridge(native, now);

    useBackupRun.setState({ phase: "scanning", workspaceName: "P", startedAt: 1 }); // transition -> push
    const pushes = native.setSnapshot.mock.calls.length;
    expect(pushes).toBeGreaterThan(0);

    useUploadStore.setState({ items: [item("bk_1", "queued")] }); // same phase, inside 15s window -> no push
    expect(native.setSnapshot.mock.calls.length).toBe(pushes);

    clock += 16_000;
    useUploadStore.setState({ items: [item("bk_1", "uploading", 0.4)] }); // window passed -> push
    expect(native.setSnapshot.mock.calls.length).toBe(pushes + 1);
  });

  it("is a silent no-op without the native module", () => {
    startStatusBridge(null, now);
    useBackupRun.setState({ phase: "scanning", workspaceName: "P", startedAt: 1 });
    // nothing to assert beyond "no throw" - the bridge must never crash the app
  });
});

// iOS background transport: the OS carries the uploads, the JS upload store
// never holds them and the run phase is idle once the scan is done. Seen on a
// device: no Live Activity at all while a backup was clearly running.
describe("startStatusBridge - background transport jobs", () => {
  type JobState = { jobId: string; state: "queued" | "running" | "done" | "failed"; bytesSent: number; bytesTotal: number };
  function fakeTransport(initial: JobState[]) {
    const listeners: Record<string, (p: never) => void> = {};
    let jobs = initial;
    return {
      native: {
        pending: jest.fn(async () => jobs),
        addListener: jest.fn((event: string, fn: (p: never) => void) => {
          listeners[event] = fn;
          return { remove: () => { delete listeners[event]; } };
        }),
      },
      setJobs: (next: JobState[]) => { jobs = next; },
      finish: (jobId: string, ok = true) => (listeners.onJobFinished as (r: unknown) => void)({ jobId, ok }),
      progress: (bytesSent: number, bytesTotal: number) => (listeners.onProgress as (p: unknown) => void)({ bytesSent, bytesTotal }),
      listeners,
    };
  }
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const job = (jobId: string, state: JobState["state"]): JobState => ({ jobId, state, bytesSent: 0, bytesTotal: 100 });

  it("starts the Live Activity from queued background jobs alone, with the run idle and the store empty", async () => {
    const native = fakeNative();
    const t = fakeTransport([job("a", "queued"), job("b", "running"), job("c", "queued")]);
    useBackupRun.setState({ phase: "idle", workspaceName: "Personal", startedAt: null });
    startStatusBridge(native, now, t.native);
    await flush();
    expect(native.startActivity).toHaveBeenCalledWith("Personal", 3);
    expect(deriveSnapshot(clock).phase).toBe("uploading");
  });

  it("counts finished jobs as done and keeps the total stable while the queue drains", async () => {
    const native = fakeNative();
    const t = fakeTransport([job("a", "running"), job("b", "queued"), job("c", "queued")]);
    startStatusBridge(native, now, t.native);
    await flush();
    // One finishes and is drained by the settle before we look again.
    t.setJobs([job("b", "running"), job("c", "queued")]);
    clock += 4_000;
    t.finish("a");
    await flush();
    expect(native.updateActivity).toHaveBeenLastCalledWith(1, 3, 0);
  });

  it("ends the activity, with the final counts, when the last background job is gone", async () => {
    const native = fakeNative();
    const t = fakeTransport([job("a", "running")]);
    startStatusBridge(native, now, t.native);
    await flush();
    t.setJobs([]);
    t.finish("a");
    await flush();
    expect(native.endActivity).toHaveBeenCalledWith(1, 1);
  });

  it("feeds the transport's own speed into the activity when nothing moves in-process", async () => {
    const native = fakeNative();
    const t = fakeTransport([job("a", "running"), job("b", "queued")]);
    startStatusBridge(native, now, t.native);
    await flush();
    t.progress(1_000_000, 5_000_000);
    clock += 1_000;
    t.progress(2_000_000, 5_000_000);
    clock += 3_000; // past the activity throttle
    t.progress(2_500_000, 5_000_000);
    await flush();
    const last = native.updateActivity.mock.calls.at(-1)!;
    expect(last[2]).toBeGreaterThan(0);
  });

  it("does not double-count a job the in-process store also knows about", async () => {
    // The large-file fallback uploads in-process; those items are bk_ rows in
    // the store and never background jobs, so the two totals simply add.
    const native = fakeNative();
    const t = fakeTransport([job("a", "queued")]);
    startStatusBridge(native, now, t.native);
    await flush();
    useUploadStore.setState({ batchStartedAt: clock, items: [item("bk_big", "uploading", 0.5)] });
    expect(deriveSnapshot(clock).total).toBe(2);
  });
});

describe("startStatusBridge - last-run stats + theme pushes", () => {
  it("freezes lastRunAt/count/peak-speed when the run drains and pushes immediately", () => {
    const native = fakeNative();
    startStatusBridge(native, now);

    useBackupRun.setState({ phase: "uploading", workspaceName: "P", startedAt: 1 });
    useUploadStore.setState({ batchStartedAt: clock - 10_000, items: [item("bk_1", "uploading", 0.5), item("bk_2", "queued")] });
    clock += 4_000;
    useUploadStore.setState({ batchStartedAt: clock - 14_000, items: [item("bk_1", "done", 1), item("bk_2", "uploading", 0.5)] });

    // Drain.
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
    useUploadStore.setState({ items: [item("bk_1", "done", 1), item("bk_2", "done", 1)] });

    const pushed = JSON.parse(native.setSnapshot.mock.calls.at(-1)[0]);
    expect(pushed.lastRunAt).toBe(Math.floor(clock / 1000));
    expect(pushed.lastRunCount).toBe(2);
    expect(pushed.lastSpeedBps).toBeGreaterThan(0);
  });

  it("a theme change forces an immediate widget push (re-skin)", () => {
    const native = fakeNative();
    startStatusBridge(native, now);
    const before = native.setSnapshot.mock.calls.length;
    useAppearance.setState({ theme: "amber" } as never);
    expect(native.setSnapshot.mock.calls.length).toBe(before + 1);
    const pushed = JSON.parse(native.setSnapshot.mock.calls.at(-1)[0]);
    expect(pushed.theme.light.go).toBe(THEME_TOKENS.amber.light.primary);
  });
});
