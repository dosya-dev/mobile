import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TrashScreen from "./trash";
import { getTrash } from "@/files/api";
import { deleteFile, deleteFolder, restoreFile, restoreFolder } from "@/files/mutations";
import type { FileItem, FileListPage, FolderItem } from "@/files/types";

// Render options.headerRight rather than stubbing the screen to null: the Empty
// control lives in the nav bar, and a mock that drops it would leave the whole
// empty-trash path untested while still looking green.
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => unknown; title?: string } }) =>
      (options?.headerRight ? options.headerRight() : null) as never,
  },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock("@/files/api", () => ({ getTrash: jest.fn() }));
jest.mock("@/files/mutations", () => ({
  deleteFile: jest.fn(),
  restoreFile: jest.fn(),
  restoreFolder: jest.fn(),
  deleteFolder: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
const mockCan = jest.fn((_perm: string) => true);
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: mockCan, permissions: undefined, userId: "u1", roleId: "role_owner", roleName: "owner", rootFolderId: null }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toast } = require("@/ui/toast") as { toast: jest.Mock };
const mockGetTrash = getTrash as jest.MockedFunction<typeof getTrash>;
const mockDeleteFile = deleteFile as unknown as jest.Mock;
const mockDeleteFolder = deleteFolder as unknown as jest.Mock;
const mockRestoreFile = restoreFile as unknown as jest.Mock;
const mockRestoreFolder = restoreFolder as unknown as jest.Mock;

function file(over: Partial<FileItem> = {}): FileItem {
  return {
    id: "f1", name: "old.pdf", size_bytes: 10, mime_type: "application/pdf", uploaded_by: "u1",
    extension: ".pdf", created_at: 1, updated_at: 1, current_version: 1,
    lock_mode: "none", is_hidden: 0, ...over,
  } as FileItem;
}
function folder(over: Partial<FolderItem> = {}): FolderItem {
  return {
    id: "d1", name: "September", created_at: 1, lock_mode: "none", file_count: 12, is_synced: 0, is_hidden: 0,
    hidden_mode: "none", created_by: "u1", is_trash_root: true, trashed_size_bytes: 3 * 1024 * 1024, ...over,
  };
}
function page(folders: FolderItem[], files: FileItem[], pagination: Partial<FileListPage["pagination"]> = {}): FileListPage {
  return { folders, files, breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: files.length, total_pages: 1, ...pagination } };
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><TrashScreen /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockCan.mockImplementation(() => true);
  mockDeleteFile.mockResolvedValue({ ok: true });
  mockRestoreFile.mockResolvedValue({ ok: true });
  mockRestoreFolder.mockResolvedValue({ ok: true });
  mockDeleteFolder.mockResolvedValue({ ok: true, complete: true, remaining: 0, files_affected: 12 });
  mockGetTrash.mockResolvedValue(page([folder()], [file({ id: "a", name: "a.pdf" }), file({ id: "b", name: "b.pdf" })]));
});

describe("TrashScreen listing, like web", () => {
  it("lists trashed folders above the files, with their item count and size", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    expect(screen.getByText("12 items · 3.0 MB")).toBeTruthy();
    expect(screen.getByText("a.pdf")).toBeTruthy();
    expect(mockGetTrash).toHaveBeenCalledWith("w1", { folderId: null, page: 1 });
  });

  it("explains that trashed items still count against storage", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    expect(screen.getByText("Items in the trash still count against your storage. Delete them permanently to free up space.")).toBeTruthy();
  });

  it("opens a trashed folder in the trash, on its own screen", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    fireEvent.press(screen.getByText("September"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/trash", params: { folderId: "d1", name: "September" } });
  });

  it("inside a trashed folder it lists that folder's contents and offers no restore on descendants", async () => {
    mockParams = { folderId: "d1", name: "September" };
    mockGetTrash.mockResolvedValue(page([folder({ id: "d2", name: "Week 1", is_trash_root: false })], [file({ id: "c", name: "c.jpg" })]));
    renderScreen();
    await waitFor(() => screen.getByText("Week 1"));
    expect(mockGetTrash).toHaveBeenCalledWith("w1", { folderId: "d1", page: 1 });
    expect(screen.queryByTestId("restore-folder-d2")).toBeNull();
    expect(screen.queryByTestId("purge-folder-d2")).toBeNull();
    // Files inside still offer restore (the server answers if the folder must go first).
    expect(screen.getByTestId("restore-c")).toBeTruthy();
    expect(screen.queryByTestId("empty-trash")).toBeNull();
  });

  it("loads the next page when the list reaches its end", async () => {
    mockGetTrash
      .mockResolvedValueOnce(page([], [file({ id: "a", name: "a.pdf" })], { total_pages: 2 }))
      .mockResolvedValueOnce(page([], [file({ id: "z", name: "z.pdf" })], { page: 2, total_pages: 2 }));
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent(screen.getByTestId("trash-list"), "endReached");
    await waitFor(() => screen.getByText("z.pdf"));
    expect(mockGetTrash).toHaveBeenLastCalledWith("w1", { folderId: null, page: 2 });
  });
});

describe("TrashScreen restore", () => {
  it("restores a folder and says so", async () => {
    mockRestoreFolder.mockResolvedValue({ ok: true, name: "September" });
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    fireEvent.press(screen.getByTestId("restore-folder-d1"));
    await waitFor(() => expect(mockRestoreFolder).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('"September" restored.'));
  });

  it("tells the user when a folder came back at the workspace root", async () => {
    mockRestoreFolder.mockResolvedValue({ ok: true, name: "September", restored_to_root: true });
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    fireEvent.press(screen.getByTestId("restore-folder-d1"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('"September" restored to the workspace root - its original folder is also in the trash.'));
  });

  it("shows the server's reason when a restore is refused", async () => {
    mockRestoreFile.mockRejectedValue(new Error("This file's folder is in the trash - restore the folder first"));
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("restore-a"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("This file's folder is in the trash - restore the folder first", "error"));
  });

  it("restores a file", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("restore-a"));
    await waitFor(() => expect(mockRestoreFile).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Restored"));
  });
});

describe("TrashScreen permanent delete", () => {
  it("offers restore and a permanent delete beside every row the role may delete", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    expect(screen.getByTestId("purge-a")).toBeTruthy();
    expect(screen.getByTestId("restore-b")).toBeTruthy();
    expect(screen.getByTestId("purge-folder-d1")).toBeTruthy();
  });

  it("hides both actions on rows the role may not delete", async () => {
    mockCan.mockImplementation((perm) => perm !== "delete_any_file");
    mockGetTrash.mockResolvedValue(page([folder({ created_by: "u2" })], [file({ id: "a", name: "a.pdf", uploaded_by: "u2" }), file({ id: "b", name: "b.pdf" })]));
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    expect(screen.queryByTestId("purge-a")).toBeNull();
    expect(screen.queryByTestId("restore-a")).toBeNull();
    expect(screen.getByTestId("purge-b")).toBeTruthy();
    expect(screen.queryByTestId("restore-folder-d1")).toBeNull();
  });

  it("does not delete until the confirm is accepted", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("purge-a"));
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(screen.getByText('"a.pdf" will be removed from storage. This cannot be undone.')).toBeTruthy();
  });

  it("purges a single file once confirmed", async () => {
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("purge-a"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDeleteFile).toHaveBeenCalledWith("a"));
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
  });

  it("asks with the folder's file count and purges the folder until the server says complete", async () => {
    mockDeleteFolder
      .mockResolvedValueOnce({ complete: false, remaining: 5, files_affected: 7 })
      .mockResolvedValueOnce({ complete: true, remaining: 0, files_affected: 5 });
    renderScreen();
    await waitFor(() => screen.getByText("September"));
    fireEvent.press(screen.getByTestId("purge-folder-d1"));
    expect(screen.getByText("Permanently delete September and its 12 files? This cannot be undone.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalledTimes(2));
    expect(mockDeleteFolder).toHaveBeenCalledWith("d1");
  });

  it("empties the whole trash, folders and files on every page, when Empty is confirmed", async () => {
    // Answered by page, so Empty's own walk over the whole trash sees both pages.
    mockGetTrash.mockImplementation(async (_ws, opts) =>
      (opts?.page ?? 1) === 1
        ? page([folder()], [file({ id: "a", name: "a.pdf" })], { total_pages: 2 })
        : page([], [file({ id: "z", name: "z.pdf" })], { page: 2, total_pages: 2 }));
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("empty-trash"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(mockDeleteFile).toHaveBeenCalledWith("z"));
    expect(mockDeleteFile).toHaveBeenCalledWith("a");
  });

  it("reports partial failure honestly instead of claiming the trash was emptied", async () => {
    mockGetTrash.mockResolvedValue(page([], [file({ id: "a", name: "a.pdf" }), file({ id: "b", name: "b.pdf" })]));
    mockDeleteFile.mockImplementation(async (id: string) => { if (id === "b") throw new Error("locked"); return { ok: true }; });
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("empty-trash"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [message, kind] = toast.mock.calls[0];
    expect(message).toMatch(/1 deleted, 1 could not be deleted/);
    expect(kind).toBe("error");
  });

  it("hides Empty when the trash is already empty", async () => {
    mockGetTrash.mockResolvedValue(page([], []));
    renderScreen();
    await waitFor(() => screen.getByText("Trash is empty"));
    expect(screen.queryByTestId("empty-trash")).toBeNull();
  });

  it("shows a busy state while purging", async () => {
    let release: () => void = () => {};
    mockDeleteFile.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true }); }));
    renderScreen();
    await waitFor(() => screen.getByText("a.pdf"));
    fireEvent.press(screen.getByTestId("purge-a"));
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => screen.getByTestId("purging"));
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByTestId("purging")).toBeNull());
  });
});
