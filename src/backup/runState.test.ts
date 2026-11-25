jest.mock("./foregroundService", () => ({ stopBackupService: jest.fn() }));
import { useBackupRun } from "./runState";

describe("useBackupRun", () => {
  beforeEach(() => {
    useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
  });

  it("startScan moves to scanning, sets workspaceName and startedAt", () => {
    useBackupRun.getState().startScan("My Workspace");
    const s = useBackupRun.getState();
    expect(s.phase).toBe("scanning");
    expect(s.workspaceName).toBe("My Workspace");
    expect(s.startedAt).not.toBeNull();
  });

  it("startScan accepts a null workspaceName", () => {
    useBackupRun.getState().startScan(null);
    expect(useBackupRun.getState().workspaceName).toBeNull();
    expect(useBackupRun.getState().phase).toBe("scanning");
  });

  it("startUpload moves to uploading", () => {
    useBackupRun.getState().startScan("W");
    useBackupRun.getState().startUpload();
    expect(useBackupRun.getState().phase).toBe("uploading");
  });

  it("idle resets phase to idle", () => {
    useBackupRun.getState().startScan("W");
    useBackupRun.getState().startUpload();
    useBackupRun.getState().idle();
    expect(useBackupRun.getState().phase).toBe("idle");
  });

  it("carries the number of jobs iOS still holds, and idle() leaves it alone", () => {
    // The count is a fact about the OS queue, not about this run: a failed
    // scan going idle must not pretend the queue emptied.
    useBackupRun.getState().setBackgroundJobs(7);
    expect(useBackupRun.getState().backgroundJobs).toBe(7);
    useBackupRun.getState().idle();
    expect(useBackupRun.getState().backgroundJobs).toBe(7);
    useBackupRun.getState().setBackgroundJobs(0);
    expect(useBackupRun.getState().backgroundJobs).toBe(0);
  });
});

describe("foreground service lifecycle", () => {
  it("tears the Android service down whenever the engine goes idle", () => {
    // Every exit path (drain, manual Stop, failed scan, fatal error) calls
    // idle(), so this one hook is what keeps the notification from outliving
    // the run.
    const { stopBackupService } = require("./foregroundService");
    useBackupRun.getState().startScan("Personal", "w1");
    useBackupRun.getState().idle();
    expect(stopBackupService).toHaveBeenCalled();
  });
});
