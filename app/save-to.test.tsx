import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import SaveTo from "./save-to";
import { useShareIntentStore } from "@/share-intent/store";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces, useFileList } from "@/files/hooks";
import { useUploadStore } from "@/upload/store";
import { startUploads } from "@/upload/controller";
import { toUploadDrafts } from "@/share-intent/copy";
import { discardSharedFiles } from "@/share-intent/incoming";
import { toast } from "@/ui/toast";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(),
  useFileList: jest.fn(),
}));
jest.mock("@/upload/controller", () => ({ startUploads: jest.fn() }));
jest.mock("@/share-intent/copy", () => ({ toUploadDrafts: jest.fn() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/share-intent/incoming", () => ({ discardSharedFiles: jest.fn(async () => {}) }));

const pdf = { uri: "content://downloads/42", name: "invoice-2026.pdf", size: 1400, mime: "application/pdf" };
const draft = {
  id: "up_1_1000",
  name: "invoice-2026.pdf",
  uri: "file:///cache/upload-share-up_1_1000.pdf",
  size: 1400,
  mime: "application/pdf",
  folderId: null,
  status: "queued" as const,
  progress: 0,
};

const folder = (id: string, name: string) => ({
  id, name, file_count: 0, lock_mode: "none", is_hidden: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  useShareIntentStore.setState({ pending: [pdf] });
  useUploadStore.setState({ items: [] });
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Personal" }] });
  (useFileList as jest.Mock).mockReturnValue({
    data: { pages: [{ folders: [folder("f1", "Documents")], files: [] }] },
  });
  (toUploadDrafts as jest.Mock).mockResolvedValue({ drafts: [draft], failed: [] });
});

describe("SaveTo", () => {
  it("shows the file Android handed over", async () => {
    render(<SaveTo />);
    expect(await screen.findByText("invoice-2026.pdf")).toBeTruthy();
  });

  it("discards the handed-over files when the user leaves without saving", async () => {
    // iOS copies an opened document into Documents/Inbox and leaves cleanup to
    // the app. Backing out of the picker is the one path where nothing else
    // ever touches that file again.
    const { unmount } = render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");
    unmount();
    expect(discardSharedFiles).toHaveBeenCalledWith([pdf]);
  });

  it("does not discard while a save is still copying", async () => {
    // Leaving mid-copy must not delete the source out from under copyAsync.
    // The cache copy's own cleanup (copy.ts) handles the original afterwards.
    (toUploadDrafts as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");
    fireEvent.press(screen.getByTestId("confirm-save-to"));
    unmount();
    expect(discardSharedFiles).not.toHaveBeenCalled();
  });

  it("takes the share from the store so a second screen cannot upload it again", async () => {
    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");
    expect(useShareIntentStore.getState().pending).toBeNull();
  });

  it("keeps showing the file after a re-render", async () => {
    // take() empties the store. Reading it during render instead of capturing it
    // once would blank the screen the moment anything re-rendered - which the
    // folder list does as soon as its query resolves.
    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByText("Documents"));

    expect(screen.getByText("invoice-2026.pdf")).toBeTruthy();
  });

  it("uploads into the workspace and folder the user picked", async () => {
    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByText("Documents")); // navigate into it
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0]).toMatchObject({
      workspaceId: "w1",
      folderId: "f1",
      name: "invoice-2026.pdf",
    });
    // Where the bytes land is the workspace's own location, settled when it was
    // created. The API ignores a region on an upload, so the draft must not
    // pretend to carry one.
    expect(useUploadStore.getState().items[0]).not.toHaveProperty("region");
    expect(startUploads).toHaveBeenCalled();
  });

  it("uploads to the workspace root when the user picks no folder", async () => {
    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0].folderId).toBeNull();
  });

  it("tells the user which files could not be read instead of claiming success", async () => {
    (toUploadDrafts as jest.Mock).mockResolvedValue({ drafts: [draft], failed: ["locked.pdf"] });

    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const messages = (toast as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("locked.pdf"))).toBe(true);
  });

  it("does not enqueue or navigate when every copy failed", async () => {
    (toUploadDrafts as jest.Mock).mockResolvedValue({ drafts: [], failed: ["invoice-2026.pdf"] });

    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(useUploadStore.getState().items).toHaveLength(0);
    expect(startUploads).not.toHaveBeenCalled();
    // Staying put lets the user retry rather than dumping them in a file list
    // with nothing new in it and no explanation.
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("shows an empty state rather than a broken picker when opened with no share", async () => {
    // Reachable: the route survives a JS reload, and take() has already run.
    useShareIntentStore.setState({ pending: null });
    render(<SaveTo />);
    expect(await screen.findByTestId("save-to-empty")).toBeTruthy();
  });

  it("lets the user save into a workspace other than the active one", async () => {
    (useWorkspaces as jest.Mock).mockReturnValue({
      data: [{ id: "w1", name: "Personal" }, { id: "w2", name: "Studio" }],
    });

    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByTestId("pick-workspace-w2"));
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0].workspaceId).toBe("w2");
  });

  it("resets to the root folder when the workspace changes", async () => {
    // A folder id belongs to one workspace. Carrying f1 over to w2 would upload
    // into a folder that workspace does not own - the server rejects it, and the
    // user sees a failed upload they cannot explain.
    (useWorkspaces as jest.Mock).mockReturnValue({
      data: [{ id: "w1", name: "Personal" }, { id: "w2", name: "Studio" }],
    });

    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByText("Documents"));
    fireEvent.press(screen.getByTestId("pick-workspace-w2"));
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0].folderId).toBeNull();
  });

  it("can climb back out of a folder it descended into", async () => {
    // pick-destination.tsx only descends. Here the user arrived from another app
    // with no mental model of where they are, so a wrong turn must be undoable
    // without abandoning the share and starting over in the sending app.
    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByText("Documents"));
    fireEvent.press(screen.getByTestId("crumb-root"));
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0].folderId).toBeNull();
  });

  it("adopts the workspace once it loads, rather than staying stuck on none", async () => {
    // The picker seeds its selection from the active workspace on first render.
    // If the workspaces query has not resolved yet there is nothing to seed
    // from, and a plain useState initial value would never be revisited - the
    // Save button would stay disabled for the rest of the screen's life with no
    // way for the user to fix it.
    useWorkspaceStore.setState({ activeId: null });
    (useWorkspaces as jest.Mock).mockReturnValue({ data: undefined });

    const { rerender } = render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Personal" }] });
    rerender(<SaveTo />);

    fireEvent.press(screen.getByTestId("confirm-save-to"));

    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
    expect(useUploadStore.getState().items[0].workspaceId).toBe("w1");
  });

  it("cannot be confirmed twice while the copy is in flight", async () => {
    // Copying a large file is slow enough to double-tap through, and each tap
    // would enqueue its own set of drafts for the same file.
    let release: (v: unknown) => void = () => {};
    (toUploadDrafts as jest.Mock).mockReturnValue(new Promise((r) => { release = r; }));

    render(<SaveTo />);
    await screen.findByText("invoice-2026.pdf");

    fireEvent.press(screen.getByTestId("confirm-save-to"));
    fireEvent.press(screen.getByTestId("confirm-save-to"));

    release({ drafts: [draft], failed: [] });
    await waitFor(() => expect(useUploadStore.getState().items).toHaveLength(1));
  });
});
