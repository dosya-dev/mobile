import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { toast } from "@/ui/toast";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { OrbitSheet } from "./OrbitSheet";
import { useUploadTarget } from "./uploadTargetStore";
import { useDownloadStore } from "@/files/downloadStore";
import { useUploadStore } from "@/upload/store";
import { usePlayerStore } from "@/player/playerStore";
import { useMetadataStore } from "@/player/metadata/metadataStore";
import { cancelDownload } from "@/files/downloadControl";
import { retryItem } from "@/upload/controller";
import { startFromPicker } from "@/upload/startFromPicker";
import { scanDocument } from "@/upload/pickers";
import { scannerAvailable } from "../../modules/dosya-document-scanner";
import { next, stopAndClear, togglePlay } from "@/player/controller";
import type { DownloadEntry } from "@/files/downloadModel";
import type { UploadItem } from "@/upload/types";
import type { PlayerTrack } from "@/player/types";
import { NO_VAULT_ACTIVITY, setVaultActivity } from "@/vault/status";

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/files/downloadControl", () => ({ cancelDownload: jest.fn(async () => {}) }));
jest.mock("@/upload/controller", () => ({ retryItem: jest.fn(), startUploads: jest.fn() }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
const mockCreateFolder = jest.fn();
jest.mock("@/files/mutationHooks", () => ({
  useFileMutations: () => ({ createFolder: { mutate: mockCreateFolder } }),
}));
jest.mock("@/upload/startFromPicker", () => ({ startFromPicker: jest.fn(async () => {}) }));
jest.mock("../../modules/dosya-document-scanner");
jest.mock("@/player/controller", () => ({
  togglePlay: jest.fn(async () => {}),
  next: jest.fn(async () => {}),
  stopAndClear: jest.fn(async () => {}),
}));

const track: PlayerTrack = {
  fileId: "t1", title: "Ocean Eyes", artist: "Billie Eilish",
  extension: "mp3", sizeBytes: 4_200_000, modifiedAt: 1_700_000_000,
};

function down(over: Partial<DownloadEntry> = {}): DownloadEntry {
  return { fileId: "d1", name: "match.mp4", phase: "downloading", written: 43, total: 100, startedAt: 0, ...over };
}

function up(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "u1", name: "photo.jpg", uri: "file:///photo.jpg", size: 100, mime: "image/jpeg",
    folderId: null, workspaceId: "w1", status: "uploading", progress: 0.5, ...over,
  };
}

function mount(visible = true) {
  return render(<OrbitSheet visible={visible} onClose={jest.fn()} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.getState().clearAll();
  useUploadStore.setState({ items: [] });
  usePlayerStore.setState({ queue: [], index: -1, playing: false });
  useMetadataStore.setState({ entries: {} });
  useUploadTarget.setState({
    workspaceId: "w1", folderId: null, folderName: null, workspaceName: "Workspace 1", canAdd: true, canCreateFolder: true,
  });
  setVaultActivity(NO_VAULT_ACTIVITY);
});
afterEach(() => useDownloadStore.getState().clearAll());

describe("the upload sources", () => {
  it("names the destination, so uploading from another tab is never a guess", () => {
    useUploadTarget.setState({ folderId: "f1", folderName: "Invoices" });
    mount();
    expect(screen.getByText("Add to Invoices")).toBeTruthy();
  });

  it("falls back to the workspace name at a root", () => {
    mount();
    expect(screen.getByText("Add to Workspace 1")).toBeTruthy();
  });

  it("uploads into the published destination, not the workspace root", () => {
    useUploadTarget.setState({ folderId: "f1", folderName: "Invoices" });
    mount();
    fireEvent.press(screen.getByTestId("orbit-source-photos"));
    finishSheetDismissal();
    expect(startFromPicker).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", folderId: "f1" }),
    );
  });

  // iPhone 11 report: "Choose files" did nothing, then nothing ever worked
  // again. The picker was presented on the sheet while it was still sliding
  // away, never reported back, and left expo-document-picker stuck.
  it("opens the picker only after the sheet has gone", () => {
    const onClose = jest.fn();
    render(<OrbitSheet visible onClose={onClose} />);
    fireEvent.press(screen.getByTestId("orbit-source-files"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(startFromPicker).not.toHaveBeenCalled();
    finishSheetDismissal();
    expect(startFromPicker).toHaveBeenCalledTimes(1);
  });

  it("says so when the picker cannot open, instead of doing nothing", async () => {
    (startFromPicker as jest.Mock).mockRejectedValueOnce(new Error("Different document picking in progress"));
    mount();
    fireEvent.press(screen.getByTestId("orbit-source-files"));
    finishSheetDismissal();
    await act(async () => {});
    expect(toast).toHaveBeenCalledWith("Couldn't open the picker.", "error");
  });

  it("scans a document into the published destination", () => {
    useUploadTarget.setState({ folderId: "f1", folderName: "Invoices" });
    mount();
    fireEvent.press(screen.getByTestId("orbit-source-scan"));
    finishSheetDismissal();
    expect(startFromPicker).toHaveBeenCalledWith(
      expect.objectContaining({ picker: scanDocument, workspaceId: "w1", folderId: "f1" }),
    );
  });

  it("hides Scan document on a phone with no scanner", () => {
    (scannerAvailable as jest.Mock).mockReturnValueOnce(false);
    mount();
    expect(screen.queryByTestId("orbit-source-scan")).toBeNull();
    expect(screen.getByTestId("orbit-source-camera")).toBeTruthy();
  });

  // The role gate that used to hide the FAB. The sheet is now the only place
  // upload is offered, so this is where a viewer has to be turned away.
  it("offers no sources to a role that cannot upload", () => {
    useUploadTarget.setState({ canAdd: false, canCreateFolder: false });
    mount();
    expect(screen.queryByTestId("orbit-sheet-sources")).toBeNull();
    expect(screen.getByTestId("orbit-sheet-empty")).toBeTruthy();
  });
});

describe("New folder", () => {
  it("is the first row of the sources block when the role can create folders", () => {
    mount();
    expect(screen.getByTestId("orbit-new-folder")).toBeTruthy();
    expect(screen.getByText("New folder")).toBeTruthy();
  });

  it("is absent without canCreateFolder", () => {
    useUploadTarget.setState({ canCreateFolder: false });
    mount();
    expect(screen.queryByTestId("orbit-new-folder")).toBeNull();
    expect(screen.getByTestId("orbit-source-files")).toBeTruthy();
  });

  it("closes the sheet, then asks for a name and creates the folder where the target points", () => {
    useUploadTarget.setState({ folderId: "f1", folderName: "Invoices" });
    const onClose = jest.fn();
    render(<OrbitSheet visible onClose={onClose} />);
    fireEvent.press(screen.getByTestId("orbit-new-folder"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("prompt-input")).toBeNull();
    finishSheetDismissal();
    fireEvent.changeText(screen.getByTestId("prompt-input"), "Holiday 2026");
    fireEvent.press(screen.getByTestId("submit"));
    expect(mockCreateFolder).toHaveBeenCalledWith(
      { workspaceId: "w1", parentId: "f1", name: "Holiday 2026" },
      expect.any(Object),
    );
    mockCreateFolder.mock.calls[0][1].onSuccess();
    expect(toast).toHaveBeenCalledWith("Folder created");
  });
});

describe("the transfers block", () => {
  // The capsule card was the only route to Cancel. It is gone, so this is it -
  // a half-gigabyte cellular download with no way out is a trap.
  it("cancels a download", () => {
    useDownloadStore.setState({ entries: { d1: down() } });
    mount();
    fireEvent.press(screen.getByTestId("orbit-cancel-d1"));
    expect(cancelDownload).toHaveBeenCalledWith("d1");
  });

  it("retries a failed upload, and offers no cancel for one still running", () => {
    useUploadStore.setState({ items: [up(), up({ id: "u2", status: "error", error: "Network lost" })] });
    mount();
    expect(screen.queryByTestId("orbit-retry-u1")).toBeNull();
    fireEvent.press(screen.getByTestId("orbit-retry-u2"));
    expect(retryItem).toHaveBeenCalledWith("u2");
  });

  it("reports a broken upload rather than quietly dropping it", () => {
    useUploadStore.setState({ items: [up({ status: "error", error: "Network lost" })] });
    mount();
    expect(screen.getByText("Network lost")).toBeTruthy();
  });

  it("stays out of the way when nothing is moving", () => {
    mount();
    expect(screen.queryByTestId("orbit-sheet-transfers")).toBeNull();
  });
});

describe("the now-playing block", () => {
  beforeEach(() => usePlayerStore.setState({ queue: [track], index: 0, playing: true }));

  it("names the track and opens the full player", () => {
    mount();
    expect(screen.getByText("Ocean Eyes")).toBeTruthy();
    fireEvent.press(screen.getByTestId("orbit-open-player"));
    expect(mockRouter.push).toHaveBeenCalledWith("/player");
  });

  it("toggles playback", () => {
    mount();
    fireEvent.press(screen.getByTestId("orbit-toggle-play"));
    expect(togglePlay).toHaveBeenCalled();
  });

  it("skips forward, wrapping at the end of the queue", () => {
    // This button inherited the mini player's contract when that bar was
    // deleted: a deliberate Next press comes back round to the first track
    // rather than doing nothing, whatever the repeat mode says.
    mount();
    fireEvent.press(screen.getByTestId("orbit-next"));
    expect(next).toHaveBeenCalledWith({ wrap: true });
  });

  // The mini player's swipe-sideways-to-stop had nowhere to go once the bar was
  // deleted. A gesture nobody could discover becomes a labelled control.
  it("stops playback and clears the queue", () => {
    mount();
    fireEvent.press(screen.getByTestId("orbit-stop"));
    expect(stopAndClear).toHaveBeenCalled();
  });

  it("is absent with no queue loaded", () => {
    usePlayerStore.setState({ queue: [], index: -1 });
    mount();
    expect(screen.queryByTestId("orbit-sheet-now-playing")).toBeNull();
  });
});

describe("the Vault's line", () => {
  it("stays away while the Vault is quiet, so the sheet never hints one exists", () => {
    mount();
    expect(screen.queryByTestId("orbit-vault-summary")).toBeNull();
  });

  it("opens the transfers section on its own, with no other transfer running", () => {
    setVaultActivity({ count: 1, failed: 0, uploads: 1, downloads: 0, written: 40, total: 100 });
    mount();
    expect(screen.getByTestId("orbit-sheet-transfers")).toBeTruthy();
    expect(screen.getByText("1 file in your Vault")).toBeTruthy();
    expect(screen.getByText("Encrypting and uploading · 40%")).toBeTruthy();
  });

  it("counts itself into the section heading beside the plain transfers", () => {
    setVaultActivity({ count: 2, failed: 0, uploads: 2, downloads: 0, written: 0, total: 100 });
    useDownloadStore.setState({ entries: { d1: down() } });
    mount();
    expect(screen.getByText("Transfers")).toBeTruthy();
  });

  it("carries a broken Vault upload out to where the person is looking", () => {
    setVaultActivity({ count: 1, failed: 1, uploads: 1, downloads: 0, written: 0, total: 100 });
    mount();
    expect(screen.getByText("1 file couldn't upload")).toBeTruthy();
  });

  it("is a door: it closes the sheet and opens the Vault, where the names are", () => {
    setVaultActivity({ count: 1, failed: 0, uploads: 1, downloads: 0, written: 40, total: 100 });
    const onClose = jest.fn();
    render(<OrbitSheet visible onClose={onClose} />);
    fireEvent.press(screen.getByTestId("orbit-vault-summary"));
    expect(onClose).toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith("/vault");
  });
});
