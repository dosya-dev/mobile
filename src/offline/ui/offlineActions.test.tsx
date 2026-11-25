import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { FileActionsSheet } from "@/files/FileActionsSheet";
import { FolderActionsSheet } from "@/files/FolderActionsSheet";
import type { FileItem, FolderItem } from "@/files/types";
import { useOfflineStore } from "../offlineStore";
import { OfflinePinConfirm, useOfflinePinConfirm } from "./offlineActions";
import type { PinRow } from "../types";

jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: "w1" }) }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
jest.mock("../pins", () => {
  const actual = jest.requireActual("../pins");
  return {
    LARGE_FOLDER_BYTES: actual.LARGE_FOLDER_BYTES,
    canPin: actual.canPin,
    estimateFolder: jest.fn(),
    pinFile: jest.fn(async () => {}),
    pinFolder: jest.fn(async () => {}),
    unpin: jest.fn(async () => {}),
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pins = require("../pins") as { estimateFolder: jest.Mock; pinFile: jest.Mock; pinFolder: jest.Mock; unpin: jest.Mock };

const file: FileItem = {
  id: "f1", name: "a.txt", size_bytes: 1, mime_type: "text/plain", extension: "txt", created_at: 1, updated_at: 1,
  current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};
const folder: FolderItem = {
  id: "d1", name: "Holiday", created_at: 1, lock_mode: "none", file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none",
};
const pin = (over: Partial<PinRow>): PinRow => ({
  id: "x", kind: "file", workspace_id: "w1", name: "x", created_at: 1, revision: 1, status: "ready", last_checked_at: null, last_error: null, ...over,
});

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>
);
const noop = () => {};
const fileSheet = (f: FileItem) => (
  <FileActionsSheet file={f} visible onClose={noop} onMove={noop} onCopy={noop} onVersions={noop} onRename={noop} onDelete={noop} onShare={noop} onLock={noop} onToggleHidden={noop} onComments={noop} />
);
const folderSheet = (f: FolderItem) => (
  <FolderActionsSheet folder={f} visible onClose={noop} onOpen={noop} onInfo={noop} onRename={noop} onMove={noop} onAddToGroup={noop} onShare={noop} onLock={noop} onToggleHidden={noop} onDelete={noop} />
);

beforeEach(() => {
  jest.clearAllMocks();
  useOfflineStore.setState({ pins: [], savedFileIds: new Set(), updatePendingIds: new Set() });
  useOfflinePinConfirm.setState({ pending: null });
});

describe("Make available offline", () => {
  it("the file sheet offers it and pins the file", async () => {
    render(wrap(fileSheet(file)));
    fireEvent.press(screen.getByText("Make available offline"));
    finishSheetDismissal();
    await waitFor(() => expect(pins.pinFile).toHaveBeenCalledWith(file, "w1"));
  });

  it("row hidden for view_only and full_lock", () => {
    const { rerender } = render(wrap(fileSheet({ ...file, lock_mode: "view_only" })));
    expect(screen.queryByText("Make available offline")).toBeNull();
    rerender(wrap(fileSheet({ ...file, lock_mode: "full_lock" })));
    expect(screen.queryByText("Make available offline")).toBeNull();
    // The other rows are still there.
    expect(screen.getByText("Comments")).toBeTruthy();
  });

  it("row hidden for a locked folder", () => {
    render(wrap(folderSheet({ ...folder, lock_mode: "full_lock" })));
    expect(screen.queryByText("Make available offline")).toBeNull();
  });

  it("a pinned file offers Remove from offline, which unpins it", async () => {
    useOfflineStore.setState({ pins: [pin({ id: "f1" })] });
    render(wrap(fileSheet(file)));
    expect(screen.queryByText("Make available offline")).toBeNull();
    fireEvent.press(screen.getByText("Remove from offline"));
    finishSheetDismissal();
    await waitFor(() => expect(pins.unpin).toHaveBeenCalledWith("f1"));
  });

  it("a small folder pins without asking", async () => {
    pins.estimateFolder.mockResolvedValueOnce({ files: 3, additionalBytes: 10 * 1024 ** 2 });
    render(wrap(<>{folderSheet(folder)}<OfflinePinConfirm /></>));
    fireEvent.press(screen.getByText("Make available offline"));
    finishSheetDismissal();
    await waitFor(() => expect(pins.pinFolder).toHaveBeenCalledWith(folder, "w1"));
    expect(screen.queryByText("Are you sure?")).toBeNull();
  });

  it("confirm shows count and size for a folder over 1 GiB, and pins only on confirm", async () => {
    pins.estimateFolder.mockResolvedValueOnce({ files: 1234, additionalBytes: 2.5 * 1024 ** 3 });
    render(wrap(<>{folderSheet(folder)}<OfflinePinConfirm /></>));
    fireEvent.press(screen.getByText("Make available offline"));
    finishSheetDismissal();
    await screen.findByText("Are you sure?");
    expect(screen.getByText("We'll download 1,234 files (2.5 GB) from Holiday to this phone.")).toBeTruthy();
    expect(pins.pinFolder).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId("confirm")); });
    expect(pins.pinFolder).toHaveBeenCalledWith(folder, "w1");
  });

  it("two mounted hosts (root and folder screens) show one dialog, and the other takes over on unmount", async () => {
    const pending = { folder, workspaceId: "w1", files: 2, additionalBytes: 2 * 1024 ** 3 };
    const first = render(wrap(<OfflinePinConfirm />));
    const second = render(wrap(<OfflinePinConfirm />));
    act(() => { useOfflinePinConfirm.setState({ pending }); });
    expect(first.queryByText("Are you sure?")).toBeNull();
    expect(second.queryByText("Are you sure?")).toBeTruthy();
    second.unmount();
    expect(first.queryByText("Are you sure?")).toBeTruthy();
    act(() => { useOfflinePinConfirm.setState({ pending: null }); });
    first.unmount();
  });

  it("cancelling the large-folder confirm pins nothing", async () => {
    pins.estimateFolder.mockResolvedValueOnce({ files: 2, additionalBytes: 2 * 1024 ** 3 });
    render(wrap(<>{folderSheet(folder)}<OfflinePinConfirm /></>));
    fireEvent.press(screen.getByText("Make available offline"));
    finishSheetDismissal();
    await screen.findByText("Are you sure?");
    fireEvent.press(screen.getByText("Cancel"));
    expect(useOfflinePinConfirm.getState().pending).toBeNull();
    expect(pins.pinFolder).not.toHaveBeenCalled();
  });
});
