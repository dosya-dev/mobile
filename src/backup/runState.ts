import { create } from "zustand";
import { stopBackupService } from "./foregroundService";

export type BackupPhase = "idle" | "scanning" | "uploading";

interface BackupRunState {
  phase: BackupPhase;
  workspaceName: string | null;
  workspaceId: string | null; // which workspace the engine is writing to right now
  startedAt: number | null; // unix seconds
  startScan: (workspaceName: string | null, workspaceId?: string | null) => void;
  startUpload: () => void;
  idle: () => void;
  /** Assets the last run could not materialize (iCloud original would not
   * download / Limited access) - they retry next run, but must be VISIBLE. */
  lastUnreadable: number;
  setLastUnreadable: (n: number) => void;
  /** Uploads iOS is carrying in its own background session (queued or
   * running). The orchestrator writes it as it hands a run over, the
   * background-upload events keep it current, and it is what keeps the phase
   * at "uploading" with nothing in the JS upload store. A fact about the OS
   * queue rather than about one run, so idle() leaves it alone. */
  backgroundJobs: number;
  setBackgroundJobs: (n: number) => void;
}

export const useBackupRun = create<BackupRunState>((set) => ({
  phase: "idle",
  workspaceName: null,
  workspaceId: null,
  startedAt: null,
  startScan: (workspaceName, workspaceId = null) =>
    set({ phase: "scanning", workspaceName, workspaceId, startedAt: Math.floor(Date.now() / 1000) }),
  startUpload: () => set({ phase: "uploading" }),
  // Every path out of a run funnels through here - a drained upload queue, a
  // manual Stop, a failed scan, a fatal workspace error. Tearing the Android
  // foreground service down here rather than at each call site is what stops
  // the notification outliving the engine.
  idle: () => {
    stopBackupService();
    set({ phase: "idle", workspaceId: null });
  },
  lastUnreadable: 0,
  setLastUnreadable: (n) => set({ lastUnreadable: n }),
  backgroundJobs: 0,
  setBackgroundJobs: (n) => set({ backgroundJobs: n }),
}));
