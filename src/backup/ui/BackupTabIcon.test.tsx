import { render, screen } from "@testing-library/react-native";
import { BackupTabIcon } from "./BackupTabIcon";
import { useBackupRun } from "@/backup/runState";
import { useUploadStore } from "@/upload/store";

beforeEach(() => {
  useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null });
  useUploadStore.setState({ items: [], batchStartedAt: null });
});

describe("BackupTabIcon", () => {
  it("is quiet while the engine is idle", () => {
    render(<BackupTabIcon color="#888888" size={24} />);
    expect(screen.getByTestId("backup-tab-icon")).toBeTruthy();
    expect(screen.queryByTestId("backup-tab-active-dot")).toBeNull();
  });

  it("shows the activity dot while scanning", () => {
    useBackupRun.setState({ phase: "scanning", workspaceName: "W", startedAt: 1 });
    render(<BackupTabIcon color="#888888" size={24} />);
    expect(screen.getByTestId("backup-tab-active-dot")).toBeTruthy();
  });

  it("shows the activity dot while backup uploads are in flight, but not for manual uploads", () => {
    useUploadStore.setState({
      items: [
        { id: "manual_1", name: "m.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5 },
      ],
    });
    render(<BackupTabIcon color="#888888" size={24} />);
    expect(screen.queryByTestId("backup-tab-active-dot")).toBeNull();

    useUploadStore.setState({
      items: [
        { id: "bk_a_1", name: "p.jpg", uri: "x", size: 1, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0 },
      ],
    });
    render(<BackupTabIcon color="#888888" size={24} />);
    expect(screen.getByTestId("backup-tab-active-dot")).toBeTruthy();
  });
});
