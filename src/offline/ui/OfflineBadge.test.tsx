import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { FileRow } from "@/files/FileRow";
import { FileCard } from "@/files/FileCard";
import { FolderRow } from "@/files/FolderRow";
import { FolderCard } from "@/files/FolderCard";
import type { FileItem, FolderItem } from "@/files/types";
import { useOfflineStore } from "../offlineStore";
import { OfflineBanner } from "./OfflineBanner";
import type { PinRow } from "../types";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
const mockOnline = { value: true as boolean | null };
jest.mock("../network", () => ({ useIsOnline: () => mockOnline.value }));

const file: FileItem = {
  id: "f1", name: "a.txt", size_bytes: 1, mime_type: "text/plain", extension: "txt", created_at: 1, updated_at: 1,
  current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};
const folder: FolderItem = {
  id: "d1", name: "Holiday", created_at: 1, lock_mode: "none", file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none",
};
const pin = (over: Partial<PinRow>): PinRow => ({
  id: "d1", kind: "folder", workspace_id: "w1", name: "Holiday", created_at: 1, revision: 1, status: "ready", last_checked_at: null, last_error: null, ...over,
});

beforeEach(() => {
  mockPush.mockClear();
  mockOnline.value = true;
  useOfflineStore.setState({ pins: [], savedFileIds: new Set(), updatePendingIds: new Set() });
});

describe("offline badges", () => {
  it("rows and tiles show nothing for an item that is not offline", () => {
    render(<><FileRow file={file} onPress={() => {}} /><FileCard file={file} onPress={() => {}} /><FolderRow folder={folder} onPress={() => {}} /><FolderCard folder={folder} onPress={() => {}} /></>);
    expect(screen.queryByTestId("offline-badge-f1")).toBeNull();
    expect(screen.queryByTestId("offline-badge-d1")).toBeNull();
  });

  it("saved: the file row and tile say Available offline", () => {
    useOfflineStore.setState({ savedFileIds: new Set(["f1"]) });
    render(<><FileRow file={file} onPress={() => {}} /><FileCard file={file} onPress={() => {}} /></>);
    expect(screen.getAllByLabelText("Available offline")).toHaveLength(2);
  });

  it("update pending and transferring have their own labels", () => {
    useOfflineStore.setState({ savedFileIds: new Set(["f1"]), updatePendingIds: new Set(["f1"]) });
    const { unmount } = render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.getByLabelText("Offline update pending")).toBeTruthy();
    unmount();
    useOfflineStore.setState({ savedFileIds: new Set(), updatePendingIds: new Set(), pins: [pin({ id: "f1", kind: "file", status: "transferring" })] });
    render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.getByLabelText("Downloading for offline")).toBeTruthy();
  });

  it("a pinned folder's row and tile follow the pin", () => {
    useOfflineStore.setState({ pins: [pin({ status: "ready" })] });
    render(<><FolderRow folder={folder} onPress={() => {}} /><FolderCard folder={folder} onPress={() => {}} /></>);
    expect(screen.getAllByLabelText("Available offline")).toHaveLength(2);
    act(() => { useOfflineStore.setState({ pins: [pin({ status: "transferring" })] }); });
    expect(screen.getAllByLabelText("Downloading for offline")).toHaveLength(2);
  });
});

describe("offline banner", () => {
  it("hidden online and while the connection is unknown", () => {
    const { rerender } = render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    mockOnline.value = null;
    rerender(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("offline: says pinned files still open, and links to them when there are pins", () => {
    mockOnline.value = false;
    const { rerender } = render(<OfflineBanner />);
    expect(screen.getByText("You're offline. Pinned files still open.")).toBeTruthy();
    expect(screen.queryByTestId("offline-banner-open")).toBeNull();
    useOfflineStore.setState({ pins: [pin({})] });
    rerender(<OfflineBanner />);
    fireEvent.press(screen.getByText("See offline files"));
    expect(mockPush).toHaveBeenCalledWith("/offline");
  });
});
