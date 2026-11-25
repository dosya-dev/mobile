import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScrollView, Text } from "react-native";
import type { ReactNode } from "react";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FileBrowser } from "./FileBrowser";
import { FilesRootHeader } from "./FilesRootHeader";
import { DeletionBanner } from "@/account/DeletionBanner";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorkspaces, useFileList } from "./hooks";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "./viewPrefs";
import { useFilesInteraction } from "./menu/interactionStore";
import { useFilesView } from "./filesViewStore";
import { useSelectionMoves } from "./selection/selectionMoveStore";

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void | (() => void)) => { require("react").useEffect(cb, [cb]); },
}));
jest.mock("@/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
// A pending deletion: the banner is on screen.
const mockDeletionBanner = jest.fn(() => null as unknown);
jest.mock("@/account/DeletionBanner", () => ({ DeletionBanner: () => mockDeletionBanner() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("./hooks", () => ({ useWorkspaces: jest.fn(), useFileList: jest.fn(), useFile: jest.fn(), useSearch: jest.fn() }));

const mockCan = jest.fn((_perm: string) => true);
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: mockCan, permissions: undefined, userId: "u1", roleId: "role_owner", roleName: "owner", rootFolderId: null }),
}));
jest.mock("@/player/controller", () => ({ playFolder: jest.fn(async () => true), playSingleFile: jest.fn(async () => true) }));
const mockLibraryBrowser = jest.fn((_props: unknown) => null);
jest.mock("@/library/LibraryBrowser", () => ({ LibraryBrowser: (props: unknown) => mockLibraryBrowser(props) }));

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const mockMoveFile = jest.fn(async () => ({ ok: true }));
const mockMoveFolder = jest.fn(async () => ({ ok: true }));
jest.mock("./mutations", () => ({
  ...jest.requireActual("./mutations"),
  moveFile: (...a: unknown[]) => mockMoveFile(...(a as [])),
  moveFolder: (...a: unknown[]) => mockMoveFolder(...(a as [])),
}));

// Window rectangles for the drop hit-test, keyed by the measured view's
// testID. The list area starts at y=100; the folder rows sit under it.
const RECTS: Record<string, [number, number, number, number]> = {
  "file-list-area": [0, 100, 400, 600],
  "drop-target-d1": [0, 100, 400, 60],
  "drop-target-d2": [0, 160, 400, 60],
};
jest.mock("./dragMeasure", () => ({
  measureInWindow: (view: { props: { testID?: string } }, cb: (x: number, y: number, w: number, h: number) => void) => {
    const r = RECTS[view.props.testID ?? ""];
    if (r) cb(...r);
  },
}));

const mockUseWorkspaces = useWorkspaces as jest.Mock;
const mockUseFileList = useFileList as jest.Mock;

// Gesture events reach the handlers outside React's own event path, so the
// state they set is flushed explicitly.
const fire: typeof fireGestureHandler = (gesture, events) => { act(() => { fireGestureHandler(gesture, events); }); };

const FOLDER = (id: string, name: string) => ({ id, name, created_at: 1, lock_mode: "none", file_count: 0, is_synced: 0, is_hidden: 0, hidden_mode: "none" });
const FILE = (id: string, name: string, uploaded_by = "u1") => ({
  id, name, size_bytes: 10, mime_type: "application/pdf", extension: "pdf", uploaded_by,
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
});
const refetch = jest.fn();
const listing = (folders: unknown[], files: unknown[]) => ({
  data: { pages: [{ folders, files, breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
  isLoading: false, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch, fetchNextPage: jest.fn(),
});

let qc: QueryClient;
function renderBrowser(folderId: string | null = null, header?: ReactNode) {
  useWorkspaceStore.setState({ activeId: "w1" });
  mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
  mockUseFileList.mockReturnValue(listing([FOLDER("d1", "Archive"), FOLDER("d2", "Shared")], [FILE("f1", "doc.pdf"), FILE("f2", "notes.pdf", "u2")]));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <FileBrowser folderId={folderId} header={header} />
    </QueryClientProvider>,
  );
}
const rerenderBrowser = (view: ReturnType<typeof render>, folderId: string | null = null) =>
  view.rerender(<QueryClientProvider client={qc}><FileBrowser folderId={folderId} /></QueryClientProvider>);

/**
 * Selection mode has no toolbar button any more: it starts from an item's
 * actions sheet. Open it on f2 and choose Select, which leaves f2 ticked
 * (unticking the last item would end selection mode again).
 */
const enterSelect = () => {
  fireEvent.press(screen.getByTestId("more-f2"));
  fireEvent.press(screen.getByText("Select"));
};

/** The list's own ScrollView (the chip row is one too). */
const listScroll = () => screen.UNSAFE_getAllByType(ScrollView).find((v) => v.props.testID === "file-list")!;

/** The hold that arms a drag: the LongPress activates, then (success) ends or (false) fails. */
const hold = (key: string, success = true) =>
  fire(getByGestureTestId(`hold-${key}`), [
    { state: State.BEGAN }, { state: State.ACTIVE }, { state: success ? State.END : State.FAILED },
  ]);
/** The pan after a hold: activates where the finger is, moves through the points, ends at the last. */
const dragThrough = (key: string, points: [number, number][], end: "END" | "CANCELLED" = "END") => {
  const [sx, sy] = points[0];
  fire(getByGestureTestId(`drag-${key}`), [
    { state: State.BEGAN, absoluteX: sx, absoluteY: sy },
    { state: State.ACTIVE, absoluteX: sx, absoluteY: sy },
    ...points.slice(1).map(([x, y]) => ({ absoluteX: x, absoluteY: y })),
    { state: State[end], absoluteX: points[points.length - 1][0], absoluteY: points[points.length - 1][1] },
  ]);
};
const swipe = (id: string, dx: number) =>
  fire(getByGestureTestId(`swipe-${id}`), [
    { state: State.BEGAN, translationX: 0 },
    { state: State.ACTIVE, translationX: dx / 2 },
    { translationX: dx },
    { state: State.END, translationX: dx, velocityX: 0 },
  ]);

beforeEach(() => {
  useViewPrefs.setState({ viewMode: "list", libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: false });
  mockUseWorkspaces.mockReset();
  mockUseFileList.mockReset();
  mockRouter.push.mockClear();
  mockToast.mockClear();
  mockMoveFile.mockClear();
  mockMoveFolder.mockClear();
  refetch.mockClear();
  mockCan.mockImplementation(() => true);
});
afterEach(() => qc?.clear());

describe("FileBrowser selection mode", () => {
  it("Select turns on selection mode, taps toggle rows and the header counts them", () => {
    renderBrowser();
    expect(screen.queryByTestId("select-f1", { includeHiddenElements: true })).toBeNull();
    enterSelect();
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("Archive"));
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.getByTestId("select-f1", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId("select-folder-d1", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByText("doc.pdf"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("Move to… opens the destination picker for the whole selection", () => {
    renderBrowser("src");
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("Shared"));
    fireEvent.press(screen.getByTestId("selection-move"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/pick-destination", params: { fileIds: "f2,f1", folderIds: "d2", mode: "move", moveToken: expect.any(String) } });
  });

  it("the close button leaves selection mode and forgets the selection", () => {
    renderBrowser();
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByTestId("selection-close"));
    expect(screen.queryByTestId("select-f1", { includeHiddenElements: true })).toBeNull();
    enterSelect();
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByTestId("select-f1", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: false });
  });

  it("unticking the last item leaves selection mode", () => {
    renderBrowser();
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("doc.pdf"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.press(screen.getByText("notes.pdf"));
    expect(screen.queryByTestId("selection-header")).toBeNull();
    expect(screen.queryByTestId("select-f1", { includeHiddenElements: true })).toBeNull();
    // A tap opens again rather than ticking.
    fireEvent.press(screen.getByText("doc.pdf"));
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it("the actions sheet offers Select, which ticks that item", () => {
    renderBrowser();
    fireEvent.press(screen.getByTestId("more-f2"));
    fireEvent.press(screen.getByText("Select"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByTestId("select-f2", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
  });

  it("keeps the selection while the destination picker is open", () => {
    renderBrowser("src");
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("Shared"));
    fireEvent.press(screen.getByTestId("selection-move"));
    expect(screen.getByText("3 selected")).toBeTruthy();
  });

  it("drops ticks for items that have left the listing, and leaves selection mode when none remain", () => {
    const view = renderBrowser();
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("Archive"));
    expect(screen.getByText("3 selected")).toBeTruthy();
    mockUseFileList.mockReturnValue(listing([FOLDER("d1", "Archive"), FOLDER("d2", "Shared")], [FILE("f2", "notes.pdf")]));
    rerenderBrowser(view);
    expect(screen.getByText("2 selected")).toBeTruthy();
    mockUseFileList.mockReturnValue(listing([FOLDER("d2", "Shared")], [FILE("f3", "other.pdf")]));
    rerenderBrowser(view);
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByTestId("selection-close")).toBeNull();
  });

  it("offers no selection mode to a role that can move neither files nor folders", () => {
    mockCan.mockImplementation((perm) => perm !== "upload_files" && perm !== "rename_folders");
    renderBrowser();
    expect(screen.queryByTestId("select-mode")).toBeNull();
    fireEvent.press(screen.getByTestId("more-f2"));
    expect(screen.queryByText("Select")).toBeNull();
  });
});

describe("FileBrowser selection header", () => {
  const rootHeader = <Text testID="files-view-title">All</Text>;

  it("on the root, selection swaps the Files header for the selection header and back", () => {
    renderBrowser(null, rootHeader);
    expect(screen.getByTestId("files-view-title")).toBeTruthy();
    expect(screen.queryByTestId("selection-header")).toBeNull();
    fireEvent.press(screen.getByTestId("more-f2"));
    fireEvent.press(screen.getByText("Select"));
    expect(screen.getByTestId("selection-header")).toBeTruthy();
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    // Both stay mounted for the cross-fade; the hidden one is out of the accessibility tree.
    expect(screen.queryByTestId("files-view-title")).toBeNull();
    expect(screen.getByTestId("files-view-title", { includeHiddenElements: true })).toBeTruthy();
    // The toolbar stays under the root header's slot.
    expect(screen.getByTestId("open-sort")).toBeTruthy();
    fireEvent.press(screen.getByTestId("selection-close"));
    expect(screen.getByTestId("files-view-title")).toBeTruthy();
    expect(screen.queryByTestId("selection-header")).toBeNull();
  });

  // The selection row used to cover the whole root header fragment, banner
  // included: it centred over header + banner and hid a pending-deletion
  // notice for as long as the selection lasted.
  it("keeps the deletion banner on screen and accessible while selecting", () => {
    mockDeletionBanner.mockImplementation(() => <Text testID="deletion-banner">Deletion scheduled</Text>);
    useWorkspaceStore.setState({ activeId: "w1" });
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue(listing([FOLDER("d1", "Archive")], [FILE("f1", "doc.pdf"), FILE("f2", "notes.pdf", "u2")]));
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <FileBrowser folderId={null} header={(tools) => <FilesRootHeader tools={tools} />} banner={<DeletionBanner />} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId("deletion-banner")).toHaveLength(1);
    enterSelect();
    expect(screen.getByTestId("selection-header")).toBeTruthy();
    expect(screen.queryByTestId("files-view-title")).toBeNull();
    expect(screen.getByTestId("deletion-banner")).toHaveTextContent("Deletion scheduled");
    mockDeletionBanner.mockImplementation(() => null);
  });

  it("in a folder the toolbar row is what the selection header replaces", () => {
    renderBrowser("src");
    expect(screen.getByTestId("open-sort")).toBeTruthy();
    enterSelect();
    expect(screen.getByTestId("selection-header")).toBeTruthy();
    expect(screen.queryByTestId("open-sort")).toBeNull();
  });

  it("starting selection gives one light haptic, and ticking more gives none", () => {
    const haptics = jest.requireMock("expo-haptics") as { impactAsync: jest.Mock };
    renderBrowser();
    haptics.impactAsync.mockClear();
    fireEvent.press(screen.getByTestId("more-f2"));
    fireEvent.press(screen.getByText("Select"));
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(haptics.impactAsync).toHaveBeenCalledWith("light");
    fireEvent.press(screen.getByText("doc.pdf"));
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});

describe("FileBrowser row swipes", () => {
  it("a long swipe to the right starts selection mode with that row ticked", () => {
    renderBrowser();
    swipe("f1", 260);
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByTestId("select-f1", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
  });

  it("a short swipe to the right parks a Select button, which ticks the row when tapped", () => {
    renderBrowser();
    swipe("d2", 90);
    expect(screen.queryByText(/selected/)).toBeNull();
    fireEvent.press(screen.getByTestId("swipe-select-d2"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByTestId("select-folder-d2", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
  });

  it("a long swipe to the left asks before deleting, and nothing is deleted until confirmed", () => {
    renderBrowser();
    swipe("f1", -260);
    expect(screen.getByText("Delete file?")).toBeTruthy();
    expect(screen.getByText(`"doc.pdf" will be moved to Trash.`)).toBeTruthy();
    fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByText("Delete file?")).toBeNull();
  });

  it("a swipe to the left on a folder asks with the folder wording", () => {
    renderBrowser();
    swipe("d1", -260);
    expect(screen.getByText("Delete folder?")).toBeTruthy();
  });

  it("offers no delete swipe for a file the role may not delete", () => {
    // delete_own_files only: notes.pdf belongs to u2.
    mockCan.mockImplementation((perm) => perm !== "delete_any_file");
    renderBrowser();
    swipe("f2", -260);
    expect(screen.queryByText("Delete file?")).toBeNull();
    swipe("f1", -260);
    expect(screen.getByText("Delete file?")).toBeTruthy();
  });

  it("rows do not swipe in selection mode", () => {
    renderBrowser();
    expect(() => getByGestureTestId("swipe-f1")).not.toThrow();
    enterSelect();
    expect(() => getByGestureTestId("swipe-f1")).toThrow();
  });

  it("grid cards have no swipe", () => {
    useViewPrefs.setState({ viewMode: "grid" });
    renderBrowser();
    expect(() => getByGestureTestId("swipe-f1")).toThrow();
  });
});

describe("FileBrowser drag to move", () => {
  it("hold, move over a folder and release asks before moving; Move runs the move and toasts", async () => {
    renderBrowser();
    hold("file-f1", false);
    dragThrough("file-f1", [[100, 400], [100, 130]], "END");
    // Hovering Archive (y 100-160) rang it before the release.
    expect(screen.getByText("You are moving doc.pdf to Archive.")).toBeTruthy();
    expect(mockMoveFile).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText("Move"));
    await waitFor(() => expect(mockMoveFile).toHaveBeenCalledWith("f1", "d1"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("1 item moved.", "success"));
    expect(screen.queryByText("You are moving doc.pdf to Archive.")).toBeNull();
  });

  // The gesture utilities always complete a gesture, so the hover ring cannot
  // be observed mid-drag here (FolderRow's own tests cover it); what can be is
  // that the folder under the finger at release is the one asked about.
  it("the folder under the finger at release is the drop target, after passing over another", () => {
    renderBrowser();
    dragThrough("file-f1", [[100, 400], [100, 130], [100, 190]]);
    expect(screen.getByText("You are moving doc.pdf to Shared.")).toBeTruthy();
  });

  it("a release away from any folder moves nothing and asks nothing", () => {
    renderBrowser();
    dragThrough("file-f1", [[100, 400], [100, 500]]);
    expect(screen.queryByText(/You are moving/)).toBeNull();
    expect(mockMoveFile).not.toHaveBeenCalled();
  });

  it("a cancelled drag moves nothing even over a folder", () => {
    renderBrowser();
    dragThrough("file-f1", [[100, 400], [100, 130]], "CANCELLED");
    expect(screen.queryByText(/You are moving/)).toBeNull();
  });

  it("dragging a selected item carries the whole selection, and a folder is never dropped onto itself", () => {
    renderBrowser();
    enterSelect();
    fireEvent.press(screen.getByText("doc.pdf"));
    fireEvent.press(screen.getByText("Archive"));
    dragThrough("file-f1", [[100, 400], [100, 130]]);
    expect(screen.queryByText(/You are moving/)).toBeNull();
    dragThrough("file-f1", [[100, 400], [100, 190]]);
    expect(screen.getByText("You are moving 2 files and 1 folder to Shared.")).toBeTruthy();
  });

  it("a hold released without moving opens the actions sheet instead", () => {
    renderBrowser();
    hold("file-f1", true);
    expect(screen.getByText("Version history")).toBeTruthy();
    expect(screen.queryByText(/You are moving/)).toBeNull();
  });

  it("a hold that failed (the finger moved on, a scroll) opens nothing", () => {
    renderBrowser();
    hold("file-f1", false);
    expect(screen.queryByText("Version history")).toBeNull();
  });

  it("reports a refused item with the server's reason", async () => {
    mockMoveFile.mockRejectedValueOnce(new Error("The file is locked"));
    renderBrowser();
    dragThrough("file-f1", [[100, 400], [100, 130]]);
    fireEvent.press(screen.getByText("Move"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("The file is locked", "error"));
    expect(refetch).toHaveBeenCalled();
  });

  it("gives no drag handle to a role without upload_files", () => {
    mockCan.mockImplementation((perm) => perm !== "upload_files");
    renderBrowser();
    expect(() => getByGestureTestId("drag-file-f1")).toThrow();
    expect(() => getByGestureTestId("drag-folder-d1")).not.toThrow();
  });

  it("a hold arms with a haptic tick and leaves the list scrollable again once it ends", () => {
    const haptics = jest.requireMock("expo-haptics") as { impactAsync: jest.Mock };
    haptics.impactAsync.mockClear();
    renderBrowser();
    expect(listScroll().props.scrollEnabled).toBe(true);
    hold("file-f1", true);
    expect(haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(listScroll().props.scrollEnabled).toBe(true);
  });

  it("pressing Move twice runs the move once", async () => {
    let release: () => void = () => {};
    mockMoveFile.mockImplementationOnce(() => new Promise((r) => { release = () => r({ ok: true }); }));
    renderBrowser();
    dragThrough("file-f1", [[100, 400], [100, 130]]);
    fireEvent.press(screen.getByText("Move"));
    fireEvent.press(screen.getByText("Move"));
    await act(async () => { release(); });
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockMoveFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileBrowser and the Files menu's edge swipe", () => {
  beforeEach(() => useFilesInteraction.setState({ busy: false }));

  it("the Files root reports busy while selecting, and clears it on leaving and on unmount", () => {
    const view = renderBrowser(null);
    expect(useFilesInteraction.getState().busy).toBe(false);
    enterSelect();
    expect(useFilesInteraction.getState().busy).toBe(true);
    fireEvent.press(screen.getByTestId("selection-close"));
    expect(useFilesInteraction.getState().busy).toBe(false);
    enterSelect();
    expect(useFilesInteraction.getState().busy).toBe(true);
    view.unmount();
    expect(useFilesInteraction.getState().busy).toBe(false);
  });

  it("a folder screen never reports (it has no edge swipe)", () => {
    renderBrowser("d9");
    enterSelect();
    expect(useFilesInteraction.getState().busy).toBe(false);
  });
});

describe("FileBrowser selection in the library views", () => {
  type LibProps = {
    selectable?: boolean; checks?: boolean; selected?: ReadonlySet<string>;
    onToggleSelect?: (id: string) => void; onLoadedFiles?: (files: unknown[]) => void; onMore?: (f: unknown) => void;
  };
  const libProps = () => mockLibraryBrowser.mock.calls[mockLibraryBrowser.mock.calls.length - 1][0] as LibProps;
  const PHOTO = (id: string, live_video_id: string | null = null) => ({
    ...FILE(id, `${id}.jpg`), mime_type: "image/jpeg", extension: "jpg", folder_id: `folder-of-${id}`, taken_at: 1, live_video_id,
  });

  beforeEach(() => { useFilesView.setState({ view: "images" }); mockLibraryBrowser.mockClear(); });
  afterEach(() => useFilesView.setState({ view: "all" }));

  it("long-press, Select, tick another, Move passes both ids and the loaded Live Photo twin", () => {
    renderBrowser(null);
    const a = PHOTO("a");
    const b = PHOTO("b", "b-live");
    act(() => libProps().onLoadedFiles!([a, b, PHOTO("c")]));
    expect(libProps().selectable).toBe(false);
    act(() => libProps().onMore!(a));
    fireEvent.press(screen.getByText("Select"));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(libProps()).toEqual(expect.objectContaining({ selectable: true, checks: true }));
    expect([...libProps().selected!]).toEqual(["a"]);

    act(() => libProps().onToggleSelect!("b"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect([...libProps().selected!]).toEqual(["a", "b"]);

    fireEvent.press(screen.getByTestId("selection-move"));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/pick-destination",
      params: { fileIds: "a,b", folderIds: "", mode: "move", twinIds: "b-live", moveToken: expect.any(String) },
    });
  });

  it("unticking the last library item leaves selection", () => {
    renderBrowser(null);
    const a = PHOTO("a");
    act(() => libProps().onLoadedFiles!([a]));
    act(() => libProps().onMore!(a));
    fireEvent.press(screen.getByText("Select"));
    act(() => libProps().onToggleSelect!("a"));
    expect(screen.queryByTestId("selection-header")).toBeNull();
    expect(libProps().selectable).toBe(false);
  });

  const startLibrarySelection = () => {
    renderBrowser(null);
    const a = PHOTO("a");
    act(() => libProps().onLoadedFiles!([a, PHOTO("b")]));
    act(() => libProps().onMore!(a));
    fireEvent.press(screen.getByText("Select"));
    act(() => libProps().onToggleSelect!("b"));
    fireEvent.press(screen.getByTestId("selection-move"));
    const call = mockRouter.push.mock.calls[mockRouter.push.mock.calls.length - 1][0] as { params: { moveToken: string } };
    return call.params.moveToken;
  };

  it("leaves selection once the picker reports this selection moved", () => {
    const token = startLibrarySelection();
    expect(screen.getByText("2 selected")).toBeTruthy();
    act(() => useSelectionMoves.getState().markMoved(token));
    expect(screen.queryByTestId("selection-header")).toBeNull();
    expect(libProps().selectable).toBe(false);
  });

  it("keeps selection after a cancelled picker, and ignores another browser's move", () => {
    startLibrarySelection();
    act(() => useSelectionMoves.getState().markMoved("someone-else"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(libProps().selectable).toBe(true);
  });

  it("switching the root view while selecting leaves selection", () => {
    startLibrarySelection();
    act(() => useFilesView.setState({ view: "videos" }));
    expect(screen.queryByTestId("selection-header")).toBeNull();
    expect(libProps().selectable).toBe(false);
    expect(libProps().selected!.size).toBe(0);
  });
});
