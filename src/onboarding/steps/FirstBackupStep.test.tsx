import { StrictMode } from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";

// Babel's jest-hoist plugin forbids a jest.mock() factory from closing over an
// out-of-scope variable unless its name is `mock`-prefixed (see ChooseStep.test.tsx
// for the same fix) - so `update` from the brief becomes `mockUpdate` here.
const mockUpdate = jest.fn(async () => {});
jest.mock("@/backup/settings", () => ({
  useBackupSettings: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ settings: { autoBackup: true } }),
    { getState: () => ({ update: mockUpdate }) },
  ),
}));
jest.mock("@/backup/orchestrator", () => ({
  runBackup: jest.fn(async () => ({ scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0, unreadable: 0, skippedLarge: 0 })),
  clearManualStop: jest.fn(),
}));

// The upload store is deliberately NOT mocked. It used to be faked as a static
// `items` array, which is what hid the counter bug for the whole branch: the
// real store FOLDS every finished bk_ item out of `items` (foldSettledBk, run
// in the finally of each successful upload) and into `settledBk`. A fake that
// only holds items can never reproduce that, so a screen reading the raw array
// looked correct under test while counting down on a device. It is a plain
// zustand store with no native dependencies, so the real one runs here - same
// choice app/(tabs)/backup.test.tsx already makes.
import { useUploadStore } from "@/upload/store";
import { useBackupRun } from "@/backup/runState";
import type { UploadItem } from "@/upload/types";
import { runBackup, clearManualStop } from "@/backup/orchestrator";
import { FirstBackupStep } from "./FirstBackupStep";

const bkItem = (id: string, status: UploadItem["status"], size = 100): UploadItem => ({
  id, name: `${id}.jpg`, uri: "file://x", size, mime: "image/jpeg",
  folderId: null, workspaceId: "ws1", status, progress: status === "done" ? 1 : 0,
});

const props = { workspaceId: "ws1", workspaceName: "Firat's Files", onDone: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  useUploadStore.setState({ items: [], batchStartedAt: null, settledBk: { count: 0, bytes: 0 } });
  useBackupRun.setState({ phase: "idle", workspaceName: null, workspaceId: null, startedAt: null });
  (runBackup as jest.Mock).mockResolvedValue({ scanned: 0, enqueued: 0, deduped: 0, largeUploaded: 0, largeFailed: 0, unreadable: 0, skippedLarge: 0 });
});

describe("FirstBackupStep", () => {
  it("turns auto-backup ON - the defect this whole flow exists to fix", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ autoBackup: true })));
  });

  it("actually starts a run", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalledWith("ws1", "Firat's Files", expect.anything()));
  });

  it("clears a stale manual stop so the run is not refused", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(clearManualStop).toHaveBeenCalled());
  });

  // A plain rerender() with unchanged props wouldn't re-invoke the effect even
  // without the `started` ref (its deps haven't changed) - that would pass
  // against a guarded AND an unguarded implementation alike, so it proves
  // nothing. StrictMode genuinely double-invokes the effect (mount, cleanup,
  // mount again) regardless of props, which is the actual case the ref guards
  // against - this app doesn't render under StrictMode anywhere today, but
  // the guard's own justification is exactly this behavior, so the test
  // drives it for real rather than asserting something a rerender alone
  // can't distinguish.
  it("starts the run exactly once even when StrictMode double-invokes the effect", async () => {
    render(
      <StrictMode>
        <FirstBackupStep {...props} />
      </StrictMode>,
    );
    await waitFor(() => expect(runBackup).toHaveBeenCalled());
    // Let any second (guarded-against) invocation's microtasks run before
    // asserting the final count.
    await new Promise((r) => setTimeout(r, 0));
    expect(runBackup).toHaveBeenCalledTimes(1);
  });

  it("tells the user the app can be closed", async () => {
    render(<FirstBackupStep {...props} />);
    expect(await screen.findByText(/close the app/i)).toBeTruthy();
  });

  // Split from the brief's single "finishes even when the run throws" test:
  // Done is unconditional either way (StepScreen always wires onPrimary to
  // onDone), so pressing it and checking onDone can't discriminate a guarded
  // catch from a missing one. This assertion checks the thing a missing catch
  // would actually get wrong - the screen it lands on.
  it("shows a plain-language failure state when the run throws", async () => {
    (runBackup as jest.Mock).mockRejectedValue(new Error("network"));
    render(<FirstBackupStep {...props} />);
    expect(await screen.findByText(/Backup could not start/i)).toBeTruthy();
  });

  it("does not trap the user after a failed run - Done still completes the step", async () => {
    (runBackup as jest.Mock).mockRejectedValue(new Error("network"));
    render(<FirstBackupStep {...props} />);
    fireEvent.press(await screen.findByTestId("step-primary"));
    expect(props.onDone).toHaveBeenCalled();
  });

  it("reports done when the user taps through", async () => {
    render(<FirstBackupStep {...props} />);
    fireEvent.press(await screen.findByTestId("step-primary"));
    expect(props.onDone).toHaveBeenCalled();
  });

  it("does not call runBackup with an empty workspace id, and says so honestly", async () => {
    render(<FirstBackupStep {...props} workspaceId="" />);
    expect(await screen.findByText(/No workspace to back up to/i)).toBeTruthy();
    expect(runBackup).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// The counter reads a store that DELETES what it is counting. These drive the
// real fold, which is the only way to see it.
describe("FirstBackupStep progress counter, against the real upload store", () => {
  it("counts settled uploads as done instead of losing them when they fold out of `items`", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalled());

    act(() => {
      useBackupRun.setState({ phase: "uploading" });
      useUploadStore.setState({
        items: [bkItem("bk_1", "done"), bkItem("bk_2", "done"), bkItem("bk_3", "queued")],
      });
    });
    expect(await screen.findByTestId("first-backup-progress")).toHaveTextContent("2 of 3");

    // What the engine does after every successful upload: the finished items
    // leave `items` and become a settledBk baseline.
    act(() => { useUploadStore.getState().foldSettledBk(); });

    // Without the settled baseline this reads "0 of 1" - the counter counting
    // DOWN while the backup succeeds.
    expect(await screen.findByTestId("first-backup-progress")).toHaveTextContent("2 of 3");
  });

  it("does not claim the library is empty after a run that just backed everything up", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalled());

    act(() => {
      useBackupRun.setState({ phase: "uploading" });
      useUploadStore.setState({ items: [bkItem("bk_1", "done"), bkItem("bk_2", "done")] });
    });
    act(() => { useUploadStore.getState().foldSettledBk(); });
    act(() => { useBackupRun.getState().idle(); });

    // `items` is now [] - the exact state the old code read as "your library
    // is empty right now", on the screen that had just backed it up.
    expect(useUploadStore.getState().items).toEqual([]);
    expect(screen.queryByText(/Nothing to back up yet/i)).toBeNull();
    expect(screen.getByText(/Backing up now/i)).toBeTruthy();
    expect(screen.getByTestId("first-backup-progress")).toHaveTextContent("2 of 2");
  });

  it("does not announce an empty library on entry, before the run has had a chance to enqueue", async () => {
    let release!: () => void;
    (runBackup as jest.Mock).mockImplementation(() => new Promise((r) => { release = () => r(undefined); }));
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalled());

    // Nothing enqueued yet and the engine has not reported a phase: an empty
    // live array here means "not started", never "nothing to do".
    expect(screen.queryByText(/Nothing to back up yet/i)).toBeNull();
    await act(async () => { release(); });
  });

  it("says the library is empty only once the run has finished and the engine is idle with nothing counted", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalled());
    expect(await screen.findByText(/Nothing to back up yet/i)).toBeTruthy();
  });

  it("ignores non-backup uploads, so a file the user is uploading by hand never inflates this count", async () => {
    render(<FirstBackupStep {...props} />);
    await waitFor(() => expect(runBackup).toHaveBeenCalled());

    act(() => {
      useBackupRun.setState({ phase: "uploading" });
      useUploadStore.setState({ items: [bkItem("up_manual", "queued"), bkItem("bk_1", "done")] });
    });
    expect(await screen.findByTestId("first-backup-progress")).toHaveTextContent("1 of 1");
  });
});

describe("FirstBackupStep auto-backup claim", () => {
  it("does not claim auto-backup is on when the settings write failed", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("keychain unavailable"));
    render(<FirstBackupStep {...props} />);
    expect(await screen.findByText(/could not be turned on/i)).toBeTruthy();
    expect(screen.queryByText("Auto-backup is on")).toBeNull();
  });

  it("still reaches runBackup when the settings write succeeds", async () => {
    render(<FirstBackupStep {...props} />);
    expect(await screen.findByText("Auto-backup is on")).toBeTruthy();
    expect(runBackup).toHaveBeenCalled();
  });
});
