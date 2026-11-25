import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import OfflineScreen from "./offline";
import { useOfflineStore } from "@/offline/offlineStore";
import type { PinRow } from "@/offline/types";

const mockPush = jest.fn();
const mockParams = { value: {} as Record<string, string> };
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams.value,
}));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
jest.mock("@/offline/sync", () => ({ runOfflineSync: jest.fn(async () => {}) }));
jest.mock("@/offline/pins", () => ({ unpin: jest.fn(async () => {}) }));
jest.mock("@/offline/read", () => ({ offlineListing: jest.fn(async () => null) }));
jest.mock("@/offline/ui/pinStatus", () => {
  const actual = jest.requireActual("@/offline/ui/pinStatus");
  return { ...actual, loadPinSummaries: jest.fn(async () => new Map()) };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runOfflineSync } = require("@/offline/sync") as { runOfflineSync: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { unpin } = require("@/offline/pins") as { unpin: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { offlineListing } = require("@/offline/read") as { offlineListing: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadPinSummaries } = require("@/offline/ui/pinStatus") as { loadPinSummaries: jest.Mock };

const pin = (over: Partial<PinRow>): PinRow => ({
  id: "p", kind: "folder", workspace_id: "w1", name: "P", created_at: 1, revision: 1, status: "ready",
  last_checked_at: Date.now() - 3 * 3600_000, last_error: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.value = {};
  useOfflineStore.setState({ pins: [], savedFileIds: new Set(), updatePendingIds: new Set(), progress: null, refresh: async () => {} });
});

describe("Offline screen", () => {
  it("shows an empty state with how to add something", async () => {
    render(<OfflineScreen />);
    expect(screen.getByText("Nothing is available offline yet")).toBeTruthy();
    expect(screen.getByText("Open the menu on a file or folder and choose Make available offline.")).toBeTruthy();
  });

  it("each pin shows its name, saved size and status line", async () => {
    loadPinSummaries.mockResolvedValueOnce(new Map([["d1", { files: 4, saved: 4, bytes: 3 * 1024 ** 2 }], ["f1", { files: 1, saved: 1, bytes: 1024 }]]));
    useOfflineStore.setState({
      pins: [
        pin({ id: "d1", name: "Holiday" }),
        pin({ id: "f1", kind: "file", name: "a.pdf", status: "waiting_wifi" }),
        pin({ id: "g1", name: "Old team", status: "gone" }),
        pin({ id: "e1", name: "Broken", status: "error" }),
      ],
    });
    render(<OfflineScreen />);
    expect(screen.getByText("Holiday")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("offline-pin-status-d1").props.children).toBe("3.0 MB · Checked 3 hours ago"));
    expect(screen.getByTestId("offline-pin-status-f1").props.children).toBe("1.0 KB · Saved version · update waiting for Wi-Fi");
    expect(screen.getByTestId("offline-pin-status-g1").props.children).toBe("You no longer have access");
    expect(screen.getByTestId("offline-pin-status-e1").props.children).toBe("0 B · Couldn't check · last checked 3 hours ago");
    // Waiting for Wi-Fi (which a VPN also reports) points at the mobile-data setting; nothing else does.
    expect(screen.getByTestId("offline-pin-wifi-hint-f1")).toHaveTextContent("Not on Wi-Fi, or using a VPN? Allow mobile data in Settings > Offline files.");
    expect(screen.queryByTestId("offline-pin-wifi-hint-d1")).toBeNull();
  });

  it("a file opens the saved copy (origin offline); a folder browses from the phone; a gone pin does not open", () => {
    useOfflineStore.setState({
      pins: [pin({ id: "f1", kind: "file", name: "a.pdf" }), pin({ id: "d1", name: "Holiday" }), pin({ id: "g1", status: "gone" })],
    });
    render(<OfflineScreen />);
    fireEvent.press(screen.getByTestId("offline-pin-f1"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/file/[id]", params: { id: "f1", origin: "offline" } });
    fireEvent.press(screen.getByTestId("offline-pin-d1"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/offline", params: { folderId: "d1", workspaceId: "w1", name: "Holiday" } });
    mockPush.mockClear();
    fireEvent.press(screen.getByTestId("offline-pin-g1"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Remove unpins, gone pins included", async () => {
    useOfflineStore.setState({ pins: [pin({ id: "g1", name: "Old team", status: "gone" })] });
    render(<OfflineScreen />);
    expect(screen.getByLabelText("Remove Old team from offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId("offline-pin-remove-g1"));
    expect(unpin).toHaveBeenCalledWith("g1");
  });

  it("Sync now runs a manual sync and shows progress while it runs", async () => {
    let finish!: () => void;
    runOfflineSync.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    useOfflineStore.setState({ pins: [pin({})] });
    render(<OfflineScreen />);
    fireEvent.press(screen.getByTestId("offline-sync-now"));
    expect(runOfflineSync).toHaveBeenCalledWith({ reason: "manual" });
    expect(screen.getByTestId("offline-sync-now").props.accessibilityState.disabled).toBe(true);
    act(() => { useOfflineStore.setState({ progress: { done: 2, total: 5, bytesDone: 1024 ** 2, bytesTotal: 4 * 1024 ** 2 } }); });
    expect(screen.getByText("2 of 5 files · 1.0 MB of 4.0 MB")).toBeTruthy();
    await act(async () => {
      useOfflineStore.setState({ progress: null });
      finish();
    });
    expect(screen.getByTestId("offline-sync-now").props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId("offline-progress")).toBeNull();
  });

  it("browses a pinned folder from the phone and opens its files from the saved copy", async () => {
    mockParams.value = { folderId: "d1", workspaceId: "w1", name: "Holiday" };
    offlineListing.mockResolvedValueOnce({
      folders: [{ id: "s1", name: "Day 1", created_at: 0, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none" }],
      files: [{ id: "f9", name: "beach.jpg", size_bytes: 10, mime_type: "image/jpeg", extension: "jpg", created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0 }],
      breadcrumbs: [], pagination: { page: 1, per_page: 1, total_files: 1, total_pages: 1 },
    });
    render(<OfflineScreen />);
    await screen.findByText("beach.jpg");
    expect(offlineListing).toHaveBeenCalledWith("w1", "d1");
    fireEvent.press(screen.getByText("beach.jpg"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/file/[id]", params: { id: "f9", origin: "offline" } });
    fireEvent.press(screen.getByTestId("offline-subfolder-s1"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/offline", params: { folderId: "s1", workspaceId: "w1", name: "Day 1" } });
  });

  it("a folder no longer kept on the phone says so", async () => {
    mockParams.value = { folderId: "d1", workspaceId: "w1", name: "Holiday" };
    render(<OfflineScreen />);
    expect(await screen.findByText("This folder is no longer on this phone.")).toBeTruthy();
  });
});
