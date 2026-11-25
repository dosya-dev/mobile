jest.mock("@/lib/keychain", () => ({ getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} }));
jest.mock("@/vault/engine", () => ({ createVaultEngine: () => ({}) }));
jest.mock("@/vault/cache", () => ({
  cachePathFor: (_ws: string, _id: string, _v: number, name: string) => ({ dir: "/cache", fileName: name }),
  cachedFile: async () => null,
  createCacheSink: (t: { dir: string; fileName: string }) => ({ sink: async () => {}, finish: async () => `${t.dir}/${t.fileName}`, abort: async () => {} }),
  wipeVaultCache: async () => {},
}));
jest.mock("@/vault/fileSource", () => ({ fileSourceFromUri: async () => ({ totalSize: 4, boundaries: [{ offset: 0, size: 4 }], read: async () => new Uint8Array(4), close: () => {} }) }));

const mockParams: { id: string; folderId: string; name?: string } = { id: "ws-1", folderId: "root", name: "Holiday" };
const mockPush = jest.fn();
const mockHeader: { options: { title?: string; headerRight?: () => ReactElement | null } | null } = { options: null };
// useFocusEffect runs the callback on mount the way a focused screen does, and
// keeps the latest one so a test can fire it again to simulate coming back.
const mockFocus: { callback: (() => void | (() => void)) | null } = { callback: null };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    mockFocus.callback = cb;
    React.useEffect(cb, [cb]);
  },
  Stack: {
    // Renders the header's right slot into the tree, so the + button and the
    // sheet it opens are exercised the way they are on screen.
    Screen: (props: { options?: { title?: string; headerRight?: () => ReactElement | null } }) => {
      mockHeader.options = props.options ?? null;
      return props.options?.headerRight?.() ?? null;
    },
  },
}));

const mockPickPhotos = jest.fn();
const mockPickDocuments = jest.fn();
jest.mock("@/upload/pickers", () => ({ pickPhotos: () => mockPickPhotos(), pickDocuments: () => mockPickDocuments() }));

const mockDeleted: string[] = [];
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    delete() { mockDeleted.push(this.uri); }
  },
}));

jest.mock("@/files/saveToDevice", () => ({
  saveToDevice: jest.fn(async () => ({ kind: "gallery" })),
  saveOutcomeMessage: () => "Saved to your gallery",
  SaveCancelled: class SaveCancelled extends Error {},
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

import type { ReactElement } from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SpaceFolderScreen from "./[folderId]";
import { useVault } from "@/vault/store";
import type { VaultEngine, VaultEntry } from "@/vault/engine";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { saveToDevice } from "@/files/saveToDevice";
import { toast } from "@/ui/toast";
import { finishSheetDismissal } from "@/ui/sheetTesting";

const FOLDER: VaultEntry = { id: "d1", name: "Trip", kind: "folder", size: null, timestamp: 1 };
const FILE: VaultEntry = { id: "f1", name: "photo.jpg", kind: "file", size: 2048, timestamp: 2 };

type Calls = string[];
function fakeEngine(over: Partial<VaultEngine> = {}): VaultEngine & { calls: Calls } {
  const calls: Calls = [];
  return {
    calls,
    hasIdentity: async () => true,
    setup: async () => ({ recoveryKeyHex: "k" }),
    unlock: async () => {},
    unlockWithRecoveryKey: async () => {},
    lock: () => {},
    isUnlocked: () => true,
    createWorkspace: async () => {},
    setWorkspaceScope: async () => {},
    openWorkspace: async (id: string) => { calls.push(`open:${id}`); },
    listMyWorkspaces: async () => [],
    listFolder: async (folderId: string) => { calls.push(`list:${folderId}`); return [FOLDER, FILE]; },
    createFolder: async (parent: string, name: string) => { calls.push(`mkdir:${parent}:${name}`); return { folderId: "d2" }; },
    uploadFile: async (_folderId: string, name: string) => {
      calls.push(`upload-start:${name}`);
      await Promise.resolve();
      calls.push(`upload-end:${name}`);
      return { fileId: "f-new" };
    },
    downloadFileTo: async (_f: string, id: string) => { calls.push(`download:${id}`); return { totalSize: 2048 }; },
    deleteEntry: async (_f: string, id: string) => { calls.push(`delete:${id}`); },
    ...over,
  } as unknown as VaultEngine & { calls: Calls };
}

let engine: ReturnType<typeof fakeEngine>;

function resetVault(over: Partial<ReturnType<typeof useVault.getState>> = {}): void {
  useVault.setState({ status: "unlocked", hasIdentity: true, error: null, busy: false, spaces: [{ id: "ws-1", name: "Holiday", selfFounded: true, globalWorkspaceId: "gw-1", shared: false }], activeSpaceId: "ws-1", entries: [], recoveryKeyOnce: null, transfers: {}, ...over });
  useVault.getState().__setEngine(engine);
}

beforeEach(() => {
  mockFocus.callback = null;
  mockPush.mockClear();
  mockPickPhotos.mockReset();
  mockPickDocuments.mockReset();
  mockDeleted.length = 0;
  (saveToDevice as jest.Mock).mockClear();
  (toast as jest.Mock).mockClear();
  mockParams.id = "ws-1";
  mockParams.folderId = "root";
  mockParams.name = "Holiday";
  engine = fakeEngine();
  resetVault();
  useWorkspaceStore.setState({ activeId: "gw-1", hydrated: true });
});

const openAddSheet = () => fireEvent.press(screen.getByTestId("vault-add"));

describe("Vault folder browser", () => {
  it("lists the folder it was pointed at", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(engine.calls).toContain("list:root");
    expect(screen.getByTestId("vault-entry-d1")).toBeTruthy();
    expect(mockHeader.options?.title).toBe("Holiday");
  });

  it("titles a Space root from the Space itself, so a name that lands after the screen does still shows", async () => {
    // No name in the route, which is what happens on a deep link and on the
    // frame before `openSpace` has reconciled this phone's label with the
    // name the Space carries.
    delete mockParams.name;
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(mockHeader.options?.title).toBe("Holiday");
  });

  it("falls back to a plain title when neither the route nor this phone knows the Space", async () => {
    delete mockParams.name;
    resetVault({ spaces: [] });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(mockHeader.options?.title).toBe("Space");
  });

  it("opens the Space first when another one is open", async () => {
    resetVault({ activeSpaceId: "ws-other" });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(engine.calls).toContain("open:ws-1"));
    await waitFor(() => expect(engine.calls).toContain("list:root"));
  });

  it("re-lists the folder every time the screen comes back into focus", async () => {
    // The store keeps ONE `entries` array for the whole Vault, so a child
    // folder's listing is still in it when the user comes back to the parent.
    // Listing on mount alone left the parent showing the child's contents.
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(engine.calls.filter((c) => c === "list:root")).toHaveLength(1));

    await act(async () => { mockFocus.callback?.(); });

    await waitFor(() => expect(engine.calls.filter((c) => c === "list:root")).toHaveLength(2));
  });

  it("does not reopen the Space it is already in", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(engine.calls).toContain("list:root"));
    expect(engine.calls).not.toContain("open:ws-1");
  });

  it("says the Space is empty and how to fill it", async () => {
    engine = fakeEngine({ listFolder: async () => [] });
    resetVault();
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByText("This Space is empty. Add photos or files with the + button.")).toBeTruthy());
  });

  it("walks into a subfolder with the same route", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-d1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-entry-d1"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/vault/space/[id]/[folderId]",
      params: { id: "ws-1", folderId: "d1", name: "Trip" },
    });
  });

  it("opens a file on the Vault's own file screen", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-entry-f1"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/vault/file",
      params: { spaceId: "ws-1", folderId: "root", entryId: "f1", name: "photo.jpg", size: "2048" },
    });
  });

  it("passes an unknown size along as nothing rather than as zero", async () => {
    engine = fakeEngine({ listFolder: async () => [{ id: "f2", name: "mystery.bin", kind: "file", size: null, timestamp: 3 }] });
    resetVault();
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f2")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-entry-f2"));

    // "0" would make the file screen print "0 B" for a file whose size simply
    // was not listed.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/vault/file",
      params: { spaceId: "ws-1", folderId: "root", entryId: "f2", name: "mystery.bin", size: "" },
    });
  });

  it("uploads picked photos one after another and deletes the picker's copies", async () => {
    mockPickPhotos.mockResolvedValue([
      { uri: "file:///tmp/a.jpg", name: "a.jpg" },
      { uri: "file:///tmp/b.jpg", name: "b.jpg" },
    ]);
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-add")).toBeTruthy());

    openAddSheet();
    fireEvent.press(screen.getByText("Upload photos or videos"));
    finishSheetDismissal();

    await waitFor(() => expect(engine.calls).toContain("upload-end:b.jpg"));
    // One at a time: a phone has neither the memory nor the sockets for two
    // encrypted streams at once.
    expect(engine.calls.filter((c) => c.startsWith("upload-"))).toEqual([
      "upload-start:a.jpg", "upload-end:a.jpg", "upload-start:b.jpg", "upload-end:b.jpg",
    ]);
    // The picker's copies are plaintext in the app's cache; they go as soon as
    // the ciphertext is up.
    await waitFor(() => expect(mockDeleted).toEqual(["file:///tmp/a.jpg", "file:///tmp/b.jpg"]));
  });

  it("keeps the picker's copy when the upload failed, so Retry still has a file", async () => {
    engine = fakeEngine({ uploadFile: async () => { throw new Error("no"); } });
    resetVault();
    mockPickPhotos.mockResolvedValue([{ uri: "file:///tmp/a.jpg", name: "a.jpg" }]);
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-add")).toBeTruthy());

    openAddSheet();
    fireEvent.press(screen.getByText("Upload photos or videos"));
    finishSheetDismissal();

    // The store arms Retry with this very uri; deleting it would arm a button
    // that cannot work.
    // The sentence is on the transfer row and again under the header, so this
    // asks only that the failure has landed.
    await waitFor(() => expect(screen.getAllByText("Couldn't upload a.jpg.").length).toBeGreaterThan(0));
    expect(mockDeleted).toEqual([]);
  });

  it("retries a failed upload from the same copy and only then deletes it", async () => {
    let fail = true;
    engine = fakeEngine({
      uploadFile: async (_folderId: string, name: string) => {
        if (fail) throw new Error("no");
        engine.calls.push(`upload-end:${name}`);
        return { fileId: "f-new" };
      },
    });
    resetVault({
      transfers: {
        "up-1": { id: "up-1", name: "a.jpg", kind: "upload", done: 0, total: 0, error: "Couldn't upload a.jpg.", retry: { folderId: "root", fileUri: "file:///tmp/a.jpg" } },
      },
    });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-transfer-up-1")).toBeTruthy());

    fail = false;
    fireEvent.press(screen.getByTestId("vault-transfer-retry-up-1"));

    await waitFor(() => expect(engine.calls).toContain("upload-end:a.jpg"));
    await waitFor(() => expect(mockDeleted).toEqual(["file:///tmp/a.jpg"]));
  });

  it("says so rather than doing nothing when the picker itself fails", async () => {
    mockPickPhotos.mockRejectedValue(new Error("no permission module"));
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-add")).toBeTruthy());

    openAddSheet();
    fireEvent.press(screen.getByText("Upload photos or videos"));
    finishSheetDismissal();

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't open the picker.", "error"));
  });

  it("uploads picked documents the same way", async () => {
    mockPickDocuments.mockResolvedValue([{ uri: "file:///tmp/notes.pdf", name: "notes.pdf" }]);
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-add")).toBeTruthy());

    openAddSheet();
    fireEvent.press(screen.getByText("Upload a file"));
    finishSheetDismissal();

    await waitFor(() => expect(engine.calls).toContain("upload-end:notes.pdf"));
  });

  it("creates a folder from the + menu", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-add")).toBeTruthy());

    openAddSheet();
    fireEvent.press(screen.getByText("New folder"));
    finishSheetDismissal();
    fireEvent.changeText(screen.getByTestId("prompt-input"), "Receipts");
    fireEvent.press(screen.getByTestId("submit"));

    await waitFor(() => expect(engine.calls).toContain("mkdir:root:Receipts"));
  });

  it("downloads a file into the cache and hands it to the phone's save flow", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-entry-more-f1"));
    fireEvent.press(screen.getByText("Save to device"));
    finishSheetDismissal();

    await waitFor(() => expect(saveToDevice).toHaveBeenCalledWith({
      localUri: "/cache/photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      extension: "jpg",
      sizeBytes: 2048,
    }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Saved to your gallery"));
  });

  it("offers no Save to device for a folder", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-d1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-entry-more-d1"));
    expect(screen.queryByText("Save to device")).toBeNull();
    expect(screen.getByText("Delete")).toBeTruthy();
  });

  it("deletes an entry only after the confirmation names it", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-entry-more-f1"));
    fireEvent.press(screen.getByText("Delete"));
    finishSheetDismissal();

    expect(screen.getByText('Delete "photo.jpg"?')).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
    fireEvent.press(screen.getByTestId("confirm"));

    await waitFor(() => expect(engine.calls).toContain("delete:f1"));
  });

  it("retries into the very row it was pressed on, and leaves none behind once it succeeds", async () => {
    // A second row would leave the failed one on screen with a live Retry
    // button - pressing that again uploads a second copy of the same file.
    resetVault({
      transfers: {
        "up-1": { id: "up-1", name: "a.jpg", kind: "upload", done: 0, total: 0, error: "Couldn't upload a.jpg.", retry: { folderId: "root", fileUri: "file:///tmp/a.jpg" } },
      },
    });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-transfer-up-1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-transfer-retry-up-1"));

    await waitFor(() => expect(engine.calls).toContain("upload-end:a.jpg"));
    await waitFor(() => expect(Object.keys(useVault.getState().transfers)).toEqual([]));
  });

  it("keeps the single row, still armed, when the retry fails too", async () => {
    engine = fakeEngine({ uploadFile: async () => { throw new Error("no"); } });
    resetVault({
      transfers: {
        "up-1": { id: "up-1", name: "a.jpg", kind: "upload", done: 0, total: 0, error: "Couldn't upload a.jpg.", retry: { folderId: "root", fileUri: "file:///tmp/a.jpg" } },
      },
    });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-transfer-up-1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-transfer-retry-up-1"));

    await waitFor(() => expect(useVault.getState().transfers["up-1"]?.error).toBe("Couldn't upload a.jpg."));
    expect(Object.keys(useVault.getState().transfers)).toEqual(["up-1"]);
    expect(useVault.getState().transfers["up-1"].retry).toEqual({ folderId: "root", fileUri: "file:///tmp/a.jpg" });
    expect(mockDeleted).toEqual([]);
  });

  it("deletes the picker's plaintext copy when a failed upload row is dismissed", async () => {
    // Nothing points at that copy once the row is gone; it would otherwise sit
    // in the app cache until a purge or a manual cache clear.
    resetVault({
      transfers: {
        "up-1": { id: "up-1", name: "a.jpg", kind: "upload", done: 0, total: 0, error: "Couldn't upload a.jpg.", retry: { folderId: "root", fileUri: "file:///tmp/a.jpg" } },
      },
    });
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-transfer-up-1")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-transfer-dismiss-up-1"));

    await waitFor(() => expect(useVault.getState().transfers["up-1"]).toBeUndefined());
    expect(mockDeleted).toEqual(["file:///tmp/a.jpg"]);
  });

  it("shows the unlock card in place while the Vault is locked, then re-opens and re-lists once it is unlocked", async () => {
    // The background lock can fire while the user stands in a folder. Showing
    // the listing's empty state for a Space that is not empty - and failing
    // every action with "Couldn't ..." - is what this replaces.
    resetVault({ status: "locked", activeSpaceId: null, entries: [] });
    render(<SpaceFolderScreen />);

    expect(screen.getByTestId("vault-unlock-pass")).toBeTruthy();
    expect(screen.queryByText("This Space is empty. Add photos or files with the + button.")).toBeNull();
    expect(engine.calls).toEqual([]);

    await act(async () => { await useVault.getState().unlock("p"); });

    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
    expect(engine.calls).toContain("open:ws-1");
    expect(engine.calls).toContain("list:root");
  });

  it("clears the listing before the focus re-list, so the child's rows never show under the parent", async () => {
    render(<SpaceFolderScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    engine.listFolder = async (folderId: string) => { engine.calls.push(`list:${folderId}`); await gate; return [FOLDER, FILE]; };

    act(() => { mockFocus.callback?.(); });

    // Empty for as long as the new listing takes, never the old rows.
    expect(useVault.getState().entries).toEqual([]);

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId("vault-entry-f1")).toBeTruthy());
  });
});
