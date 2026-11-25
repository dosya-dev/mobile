jest.mock("@/lib/keychain", () => ({ getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} }));
jest.mock("@/vault/engine", () => ({ createVaultEngine: () => ({}) }));
jest.mock("@/vault/cache", () => ({
  cachePathFor: (_ws: string, _id: string, _v: number, name: string) => ({ dir: "/cache", fileName: name }),
  cachedFile: async () => null,
  createCacheSink: (t: { dir: string; fileName: string }) => ({ sink: async () => {}, finish: async () => `${t.dir}/${t.fileName}`, abort: async () => {} }),
  wipeVaultCache: async () => {},
}));
jest.mock("@/vault/fileSource", () => ({ fileSourceFromUri: async () => ({ totalSize: 0, boundaries: [], read: async () => new Uint8Array(0), close: () => {} }) }));

const mockParams: Record<string, string> = { spaceId: "ws-1", folderId: "root", entryId: "f1", name: "photo.jpg", size: "2048" };
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: mockReplace }),
}));

const mockVideoStage = jest.fn((_props: unknown) => null);
jest.mock("@/viewer/stages/VideoStage", () => ({ VideoStage: (props: unknown) => mockVideoStage(props) }));

jest.mock("@/files/saveToDevice", () => ({
  saveToDevice: jest.fn(async () => ({ kind: "gallery" })),
  saveOutcomeMessage: () => "Saved to your gallery",
  SaveCancelled: class SaveCancelled extends Error {},
}));
jest.mock("@/files/download", () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

import { StrictMode } from "react";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";
import VaultFileScreen from "./file";
import { useVault } from "@/vault/store";
import type { VaultEngine } from "@/vault/engine";
import { saveToDevice, SaveCancelled } from "@/files/saveToDevice";
import { shareFile } from "@/files/download";
import { toast } from "@/ui/toast";

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
    openWorkspace: async () => {},
    listMyWorkspaces: async () => [],
    listFolder: async () => [],
    createFolder: async () => ({ folderId: "d1" }),
    uploadFile: async () => ({ fileId: "f1" }),
    downloadFileTo: async (folderId: string, id: string) => { calls.push(`download:${folderId}:${id}`); return { totalSize: 2048 }; },
    deleteEntry: async (_f: string, id: string) => { calls.push(`delete:${id}`); },
    ...over,
  } as unknown as VaultEngine & { calls: Calls };
}

let engine: ReturnType<typeof fakeEngine>;

function resetVault(): void {
  useVault.setState({ status: "unlocked", hasIdentity: true, error: null, busy: false, spaces: [], activeSpaceId: "ws-1", entries: [], recoveryKeyOnce: null, transfers: {} });
  useVault.getState().__setEngine(engine);
}

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockVideoStage.mockClear();
  (saveToDevice as jest.Mock).mockClear();
  (saveToDevice as jest.Mock).mockResolvedValue({ kind: "gallery" });
  (shareFile as jest.Mock).mockClear();
  (toast as jest.Mock).mockClear();
  mockParams.spaceId = "ws-1";
  mockParams.folderId = "root";
  mockParams.entryId = "f1";
  mockParams.name = "photo.jpg";
  mockParams.size = "2048";
  engine = fakeEngine();
  resetVault();
});

describe("Vault file screen", () => {
  it("downloads the file it was handed and shows it on the stage", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(engine.calls).toContain("download:root:f1"));
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());
  });

  it("reports the transfer while the bytes are still coming", async () => {
    let settle: () => void = () => {};
    engine = fakeEngine({ downloadFileTo: () => new Promise((r) => { settle = () => r({ totalSize: 2048 }); }) });
    resetVault();

    render(<VaultFileScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-transfer-dl-f1")).toBeTruthy());
    settle();
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());
  });

  it("reports only its own transfer, not an upload running behind it", async () => {
    let settle: () => void = () => {};
    engine = fakeEngine({ downloadFileTo: () => new Promise((r) => { settle = () => r({ totalSize: 2048 }); }) });
    resetVault();
    // Same NAME as this file on purpose: the row is matched by the store's own
    // transfer id (dl-<entryId>), not by what it is called.
    useVault.setState({
      transfers: { "up-9": { id: "up-9", name: "photo.jpg", kind: "upload", done: 0, total: 0, error: "Couldn't upload photo.jpg.", retry: { folderId: "root", fileUri: "file:///tmp/photo.jpg" } } },
    });

    render(<VaultFileScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-transfer-dl-f1")).toBeTruthy());
    // Its Retry would have belonged to the browser that started it, and would
    // have done nothing here.
    expect(screen.queryByTestId("vault-transfer-up-9")).toBeNull();
    settle();
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());
  });

  it("says why rather than spinning when the Space will not open", async () => {
    engine = fakeEngine({ openWorkspace: async () => { throw new Error("no"); } });
    resetVault();
    useVault.setState({ activeSpaceId: "ws-other" });

    render(<VaultFileScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-file-error")).toBeTruthy());
    expect(screen.getByText("Couldn't open the Space.")).toBeTruthy();
    expect(screen.queryByTestId("image-stage")).toBeNull();
  });

  it("says so when the download resolves with nothing at all", async () => {
    // No open Space means downloadToCache returns null without ever arming a
    // transfer row, which used to leave the stage spinning for ever.
    resetVault();
    useVault.setState({ activeSpaceId: null });
    mockParams.spaceId = "";

    render(<VaultFileScreen />);

    await waitFor(() => expect(screen.getByTestId("vault-file-error")).toBeTruthy());
    expect(screen.getByText("Couldn't open this file.")).toBeTruthy();
  });

  it("downloads once even when the effect is invoked twice", async () => {
    render(
      <StrictMode>
        <VaultFileScreen />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());
    // Two sinks on one cache path is a corrupted file, not a slow one.
    expect(engine.calls.filter((c) => c === "download:root:f1")).toHaveLength(1);
  });

  it("prints no size for a file whose size was never listed", async () => {
    mockParams.name = "mystery.bin";
    mockParams.size = "";
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-file-stage-message")).toBeTruthy());
    expect(screen.queryByText("0 B")).toBeNull();
  });

  it("plays a video on the video stage", async () => {
    mockParams.name = "clip.mov";
    render(<VaultFileScreen />);
    await waitFor(() => expect(mockVideoStage).toHaveBeenCalled());
    expect(mockVideoStage).toHaveBeenCalledWith(expect.objectContaining({
      uri: "/cache/clip.mov", mimeType: "video/quicktime", extension: "mov",
    }));
    expect(screen.queryByTestId("image-stage")).toBeNull();
  });

  // Without this proof the stage's stall timer swaps a video that is playing
  // perfectly well for "still loading" fifteen seconds in.
  it("tells the video stage once the player has really opened the file", async () => {
    mockParams.name = "clip.mov";
    render(<VaultFileScreen />);
    await waitFor(() => expect(mockVideoStage).toHaveBeenCalledWith(expect.objectContaining({ uri: "/cache/clip.mov" })));
    const props = () => mockVideoStage.mock.calls[mockVideoStage.mock.calls.length - 1][0] as { playing: boolean; onDuration: (s: number) => void };
    expect(props().playing).toBe(false);
    act(() => props().onDuration(42));
    expect(props().playing).toBe(true);
  });

  it("gives the video stage a way to save the decrypted copy", async () => {
    mockParams.name = "clip.mov";
    render(<VaultFileScreen />);
    await waitFor(() => expect(mockVideoStage).toHaveBeenCalledWith(expect.objectContaining({ uri: "/cache/clip.mov" })));
    const { onSave } = mockVideoStage.mock.calls[mockVideoStage.mock.calls.length - 1][0] as { onSave: () => void };
    await act(async () => { onSave(); });
    expect(saveToDevice).toHaveBeenCalledWith(expect.objectContaining({ localUri: "/cache/clip.mov", fileName: "clip.mov" }));
  });

  it("says what it is holding when nothing can show it", async () => {
    mockParams.name = "archive.zip";
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("vault-file-stage-message")).toBeTruthy());
    // Scoped to the card: the name is also in the chrome above the stage.
    const card = within(screen.getByTestId("vault-file-stage-message"));
    expect(card.getByText("archive.zip")).toBeTruthy();
    expect(card.getByText("2.0 KB")).toBeTruthy();
  });

  it("saves the decrypted copy through the phone's own save flow", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-file-save"));

    await waitFor(() => expect(saveToDevice).toHaveBeenCalledWith({
      localUri: "/cache/photo.jpg", fileName: "photo.jpg", mimeType: "image/jpeg", extension: "jpg", sizeBytes: 2048,
    }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Saved to your gallery"));
  });

  it("says nothing when the user backs out of the save sheet", async () => {
    (saveToDevice as jest.Mock).mockRejectedValue(new SaveCancelled("No folder chosen."));
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-file-save"));

    await waitFor(() => expect(saveToDevice).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it("shares the decrypted copy", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-file-share"));
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith("/cache/photo.jpg"));
  });

  it("deletes after a confirmation and then leaves the screen", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());

    fireEvent.press(screen.getByTestId("vault-file-delete"));
    expect(screen.getByText('Delete "photo.jpg"?')).toBeTruthy();
    fireEvent.press(screen.getByTestId("confirm"));

    await waitFor(() => expect(engine.calls).toContain("delete:f1"));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("goes back from the stage's own back button", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(screen.getByTestId("image-stage")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vault-file-back"));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("Vault file screen - the Vault locking under it", () => {
  it("leaves for the Vault index rather than failing in place", async () => {
    render(<VaultFileScreen />);
    await waitFor(() => expect(engine.calls).toContain("download:root:f1"));

    await act(async () => { await useVault.getState().lock(); });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/vault"));
  });

  it("asks for no bytes at all when it opens while the Vault is locked", async () => {
    useVault.setState({ status: "locked", activeSpaceId: null, entries: [] });
    render(<VaultFileScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/vault"));
    expect(engine.calls).toEqual([]);
  });
});
