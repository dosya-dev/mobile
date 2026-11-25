import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RefreshControl, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileBrowser } from "./FileBrowser";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorkspaces, useFileList } from "./hooks";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "./viewPrefs";
import { useFilesView } from "./filesViewStore";
import { useUploadTarget } from "@/orbit/uploadTargetStore";

// A dedicated object (not a fresh `{ push: jest.fn() }` per call) so tests can assert
// on the same push spy the component actually calls.
const mockRouter = { push: jest.fn() };
// useFocusEffect: runs on mount and whenever its callback changes (as while
// focused), and records each screen's latest callback so a case can replay a
// screen regaining focus (popping back to it in the stack).
const mockFocusCallbacks: { current: () => void | (() => void) }[] = [];
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void | (() => void)) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        ref.current = { current: cb };
        mockFocusCallbacks.push(ref.current);
      }
      ref.current.current = cb;
      React.useEffect(cb, [cb]);
    },
  };
});
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock("./hooks", () => ({
  useWorkspaces: jest.fn(),
  useFileList: jest.fn(),
  useFile: jest.fn(),
  useSearch: jest.fn(),
}));

// FileBrowser gates New folder and the upload FAB on the caller's role.
// Mocked like the data hooks above: usePermissions runs a real useQuery, and
// this suite renders without a QueryClientProvider. Permissive by default so
// the existing cases keep asserting layout rather than authorisation; the
// gating itself has its own case at the bottom of this file.
const mockCan = jest.fn((_perm: string) => true);
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({
    can: mockCan,
    permissions: undefined,
    userId: "u1",
    roleId: "role_owner",
    roleName: "owner",
    rootFolderId: null,
  }),
}));

jest.mock("@/player/controller", () => ({ playFolder: jest.fn(async () => true), playSingleFile: jest.fn(async () => true) }));

// The Personas chip shows for every signed-in user (src/personas/hooks).
// Hidden by default, so the layout cases below see the five filter chips they
// always had; the chip's own cases set it visible.
const mockPersonasEntry = jest.fn((_wsId: string | null) => ({ visible: false }));
jest.mock("@/personas/hooks", () => ({ usePersonasEntry: (wsId: string | null) => mockPersonasEntry(wsId) }));

// A `mock`-prefixed spy returning null, never an inline factory building React
// elements (nativewind's babel transform injects an out-of-scope var when it
// rewrites JSX inside a hoisted jest.mock factory). LibraryBrowser's own
// behaviour is covered by its own
// test file; here FileBrowser only needs to prove it mounts the component
// with the right props and stops rendering the folder listing.
const mockLibraryBrowser = jest.fn((_props: unknown) => null);
jest.mock("@/library/LibraryBrowser", () => ({ LibraryBrowser: (props: unknown) => mockLibraryBrowser(props) }));

const mockUseWorkspaces = useWorkspaces as jest.Mock;
const mockUseFileList = useFileList as jest.Mock;

// FileBrowser calls useQueryClient() itself (to invalidate the library cache from its
// hide/lock handlers), so every render needs a real QueryClient in context now, not just
// the ones that happen to reach OperationDialogs. gcTime: 0 keeps jest from holding the
// cache timer open between tests.
let qc: QueryClient;
function renderFileBrowser(folderId: string | null = null) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <FileBrowser folderId={folderId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: null });
  useFilesView.setState({ view: "all" });
  useViewPrefs.setState({ viewMode: "list", libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: false });
  mockUseWorkspaces.mockReset();
  mockUseFileList.mockReset();
  mockRouter.push.mockClear();
  mockLibraryBrowser.mockClear();
  mockPersonasEntry.mockReset();
  mockPersonasEntry.mockReturnValue({ visible: false });
  jest.requireMock("@/player/controller").playFolder.mockClear();
  jest.requireMock("@/player/controller").playSingleFile.mockClear();
});

afterEach(() => qc?.clear());

const AUDIO_FILE = {
  id: "aud1", name: "song.mp3", size_bytes: 1000, mime_type: "audio/mpeg", extension: "mp3",
  created_at: 1700000000, updated_at: 1700000000, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 0,
};
const PDF_FILE = {
  id: "pdf1", name: "doc.pdf", size_bytes: 2000, mime_type: "application/pdf", extension: "pdf",
  created_at: 1700000001, updated_at: 1700000001, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 0,
};

/** Default render for the entry-point tests: a resolved workspace with one audio
 * file and one pdf file in the listing. */
function renderBrowser() {
  useWorkspaceStore.setState({ activeId: "w1" });
  mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
  mockUseFileList.mockReturnValue({
    data: { pages: [{ folders: [], files: [AUDIO_FILE, PDF_FILE], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
    isLoading: false, isPending: false, isError: false, isRefetching: false,
    isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
  });
  return renderFileBrowser();
}

describe("FileBrowser", () => {
  it("shows a spinner (not the empty state) while the workspace is still resolving", () => {
    mockUseWorkspaces.mockReturnValue({ data: undefined, isLoading: true, isPending: true });
    // Disabled useFileList query shape in TanStack Query v5: never fetched,
    // so isLoading/isError are both false even though there's nothing to show.
    mockUseFileList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      isRefetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
    });

    renderFileBrowser();

    expect(screen.getByTestId("browser-loading")).toBeTruthy();
    expect(screen.queryByText("This folder is empty")).toBeNull();
  });

  it("shows the empty state once the workspace and file list have resolved with no rows", () => {
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: "w1", name: "Workspace 1" }],
      isLoading: false,
      isPending: false,
    });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false,
      isPending: false,
      isError: false,
      isRefetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
    });

    renderFileBrowser();

    expect(screen.getByText("This folder is empty")).toBeTruthy();
    expect(screen.queryByTestId("browser-loading")).toBeNull();
    expect(screen.getByTestId("view-toggle")).toBeTruthy();
  });

  it("keeps pull-to-refresh available on an empty folder", () => {
    // The empty state used to render instead of the list, so there was no FlatList and
    // therefore no refresh control to pull - an empty folder couldn't be refreshed at all.
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    const refetch = jest.fn();
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch, fetchNextPage: jest.fn(),
    });

    renderFileBrowser();

    expect(screen.getByText("This folder is empty")).toBeTruthy();
    const refresh = screen.UNSAFE_getByType(RefreshControl);
    act(() => refresh.props.onRefresh());
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the list/grid view toggle", () => {
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });

    renderFileBrowser();

    expect(screen.getByTestId("view-toggle")).toBeTruthy();
    expect(screen.queryByTestId("view-list")).toBeNull();
    expect(screen.queryByTestId("view-grid")).toBeNull();
    expect(screen.queryByTestId("new-folder")).toBeNull();
    expect(screen.queryByTestId("select-mode")).toBeNull();
  });

  // The progress surface left this screen entirely: the orbit button in the tab
  // bar carries transfers now, so it is on screen from every tab rather than
  // only while files are being browsed. What this screen still owns is telling
  // that button WHERE an upload would land, and it is the only thing that
  // knows. A browser that stops publishing is a `+` that uploads into the
  // wrong folder, which is worse than one that does nothing.
  it("publishes the workspace and folder an upload would land in", () => {
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <FileBrowser folderId="f1" folderName="Invoices" />
      </QueryClientProvider>,
    );

    const t = useUploadTarget.getState();
    expect(t.workspaceId).toBe("w1");
    expect(t.folderId).toBe("f1");
    expect(t.folderName).toBe("Invoices");
    expect(t.workspaceName).toBe("Workspace 1");
  });

  // The root stays mounted under a pushed folder, so an effect keyed on its
  // own deps never re-ran on the way back: the folder's target stuck and New
  // folder from the + sheet created inside X while the user was on the root.
  it("publishes the root again when it regains focus after a folder published", () => {
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });
    useWorkspaceStore.setState({ activeId: "w1" });
    mockFocusCallbacks.length = 0;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <FileBrowser folderId={null} />
      </QueryClientProvider>,
    );
    const rootFocus = mockFocusCallbacks[0];
    render(
      <QueryClientProvider client={qc}>
        <FileBrowser folderId="X" folderName="Invoices" />
      </QueryClientProvider>,
    );
    expect(useUploadTarget.getState().folderId).toBe("X");

    // Back to the root: only its focus fires, its deps are unchanged.
    expect(rootFocus).toBeDefined();
    act(() => { rootFocus.current(); });
    expect(useUploadTarget.getState().folderId).toBeNull();
    expect(useUploadTarget.getState().folderName ?? null).toBeNull();
  });

  // Tapping a track used to start playback immediately, which meant the
  // viewer's audio stage - artwork, tags, duration - could not be reached by
  // tapping anything. Playback is now one tap further on, behind the viewer's
  // Play button, and "Play all" below still queues the folder in one go.
  it("opens the viewer when an audio file is tapped, rather than playing it", async () => {
    const { playFolder } = jest.requireMock("@/player/controller");
    const { getByText } = renderBrowser();
    fireEvent.press(getByText("song.mp3"));
    expect(mockRouter.push).toHaveBeenCalledWith("/file/aud1");
    expect(playFolder).not.toHaveBeenCalled();
  });

  it("shows Play all only when the listing contains playable audio, and plays without a start file", async () => {
    const { playFolder } = jest.requireMock("@/player/controller");
    const { getByTestId } = renderBrowser();
    fireEvent.press(getByTestId("play-all"));
    await waitFor(() => expect(playFolder).toHaveBeenCalledWith(expect.not.objectContaining({ startFileId: expect.anything() })));
  });

  it("routes non-audio and locked files to the viewer too", () => {
    const { getByText } = renderBrowser();
    fireEvent.press(getByText("doc.pdf"));
    expect(mockRouter.push).toHaveBeenCalledWith("/file/pdf1");
  });

  // The viewer pages through the folder, and the only screen that knows what
  // is in it is this one.
  it("hands the viewer the listing it was opened from", () => {
    const { useViewerList } = jest.requireActual("@/viewer/viewerStore");
    const { getByText } = renderBrowser();
    fireEvent.press(getByText("doc.pdf"));
    expect(useViewerList.getState().files.map((f: { id: string }) => f.id)).toContain("pdf1");
  });

  // Role gating. This screen used to show New folder and the upload FAB to
  // every role, so a viewer could tap both and get a 403 toast for their
  // trouble - the app knew a member's role well enough to print a badge and
  // gated nothing on it.
  //
  // The FAB moved to the tab bar, so the gate moved with it: this screen no
  // longer HIDES the upload control, it reports whether the role may use it.
  // Asserting the old testID is absent would pass against any regression at
  // all now, so these assert the published permission instead - the value the
  // sheet actually gates its upload sources on.
  describe("hides what the role cannot do", () => {
    it("reports upload as allowed when the role allows both", () => {
      mockCan.mockImplementation(() => true);
      renderBrowser();
      expect(useUploadTarget.getState().canAdd).toBe(true);
    });

    it("reports upload as denied without upload_files", () => {
      mockCan.mockImplementation((perm: string) =>
        perm !== "upload_files" && perm !== "create_folders");
      renderBrowser();
      expect(useUploadTarget.getState().canAdd).toBe(false);
    });

    it("reports upload as denied when only the access_upload PAGE permission is missing", () => {
      // Both are required: upload_files is the capability, access_upload is
      // the page gate the upload endpoints now enforce. Holding one without
      // the other still means the tap would fail.
      mockCan.mockImplementation((perm: string) => perm !== "access_upload");
      renderBrowser();
      expect(useUploadTarget.getState().canAdd).toBe(false);
    });
  });
});

describe("FileBrowser first-load splash", () => {
  const coldFileList = () => ({
    data: undefined, isLoading: false, isPending: true, isError: false, isRefetching: false,
    isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
  });

  it("mounts the splash on a cold root mount, when there is nothing cached to paint", () => {
    mockUseWorkspaces.mockReturnValue({ data: undefined, isLoading: true, isPending: true });
    mockUseFileList.mockReturnValue(coldFileList());
    renderFileBrowser();
    expect(screen.getByTestId("first-load-splash")).toBeTruthy();
  });

  // On every cold start OnboardingGate has ALREADY resolved workspaces before
  // FileBrowser mounts - the splash keys on the LISTING cache alone, or it
  // would disqualify itself on the exact flow it exists for.
  it("mounts the splash when workspaces are resolved but the listing is cold", () => {
    useWorkspaceStore.setState({ activeId: "w1" });
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue(coldFileList());
    renderFileBrowser();
    expect(screen.getByTestId("first-load-splash")).toBeTruthy();
  });

  it("never mounts the splash when the listing is already cached at mount", () => {
    renderBrowser();
    expect(screen.queryByTestId("first-load-splash")).toBeNull();
  });

  it("never mounts the splash inside a folder - it belongs to the root only", () => {
    mockUseWorkspaces.mockReturnValue({ data: undefined, isLoading: true, isPending: true });
    mockUseFileList.mockReturnValue(coldFileList());
    renderFileBrowser("f1");
    expect(screen.queryByTestId("first-load-splash")).toBeNull();
  });
});

describe("FileBrowser chip row removal", () => {
  it("has no Personas chip (the menu owns that destination)", () => {
    mockPersonasEntry.mockReturnValue({ visible: true });
    renderBrowser();
    expect(screen.queryByTestId("personas-chip")).toBeNull();
  });

  it("renders the header slot above the toolbar", () => {
    useWorkspaceStore.setState({ activeId: "w1" });
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [AUDIO_FILE], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });
    render(<QueryClientProvider client={new QueryClient()}><FileBrowser folderId={null} header={<View testID="slot-header" />} /></QueryClientProvider>);
    expect(screen.getByTestId("slot-header")).toBeTruthy();
  });

  it("hands the view tools to a header function instead of the toolbar", () => {
    useWorkspaceStore.setState({ activeId: "w1" });
    mockUseWorkspaces.mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [AUDIO_FILE], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });
    render(<QueryClientProvider client={new QueryClient()}><FileBrowser folderId={null} header={(tools) => <View testID="slot-header">{tools}</View>} /></QueryClientProvider>);
    const slot = screen.getByTestId("slot-header");
    expect(slot).toContainElement(screen.getByTestId("open-sort"));
    expect(slot).toContainElement(screen.getByTestId("view-toggle"));
    expect(slot).toContainElement(screen.getByTestId("play-all"));
  });

  it("a folder ignores the root view and lists the folder, not the library", () => {
    useFilesView.setState({ view: "images" });
    renderBrowser();
    screen.unmount();
    mockLibraryBrowser.mockClear();
    renderFileBrowser("f1");
    expect(mockLibraryBrowser).not.toHaveBeenCalled();
    expect(mockUseFileList.mock.calls.at(-1)?.[4]).toEqual({ enabled: true });
  });
});

describe("FileBrowser Images chip", () => {
  it("the Images chip swaps the listing for the photo library and stops fetching the folder", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "images" }));

    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", kind: "photos" }));
    expect(mockUseFileList.mock.calls.at(-1)?.[4]).toEqual({ enabled: false });
    expect(screen.getByTestId("open-sort")).toBeTruthy();
  });

  it("passes photos' default grid layout to LibraryBrowser", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "images" }));

    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ layout: "grid" }));
  });

  it("hides Play all in photos mode but keeps sort and the view toggle", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "images" }));

    expect(screen.queryByTestId("play-all")).toBeNull();
    expect(screen.getByTestId("open-sort")).toBeTruthy();
    // The view toggle works in library mode too -
    // each library kind remembers its own grid/list choice.
    expect(screen.getByTestId("view-toggle")).toBeTruthy();
  });

  // LibraryBrowser has no actions UI of its own - it hands a long-pressed photo
  // back to FileBrowser via onMore, which must open the same FileActionsSheet
  // the regular folder listing uses (setSheetFile), not a separate sheet.
  it("wires LibraryBrowser's onMore to the existing file actions sheet", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "images" }));
    const onMore = (mockLibraryBrowser.mock.calls.at(-1)?.[0] as { onMore?: (f: typeof PDF_FILE) => void }).onMore;
    act(() => onMore?.(PDF_FILE));

    expect(screen.getByText("Rename")).toBeTruthy();
  });
});

describe("FileBrowser Videos chip", () => {
  it("the Videos chip swaps the listing for the video library and stops fetching the folder", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "videos" }));

    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", kind: "videos" }));
    expect(mockUseFileList.mock.calls.at(-1)?.[4]).toEqual({ enabled: false });
    expect(screen.getByTestId("open-sort")).toBeTruthy();
  });

  it("points an empty folder at the + button and the folder icon", () => {
    renderBrowser();
    mockUseFileList.mockReturnValue({
      data: { pages: [{ folders: [], files: [], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
      isLoading: false, isPending: false, isError: false, isRefetching: false,
      isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
    });
    screen.unmount();
    renderFileBrowser();
    expect(screen.getByTestId("browser-empty-hint")).toHaveTextContent("Tap + to add files, or the folder icon to create one.");
  });

  it("sorts the library views by their own dates and hands the order to LibraryBrowser", async () => {
    renderBrowser();
    act(() => useFilesView.setState({ view: "images" }));
    expect(mockLibraryBrowser).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "photos", sort: "taken_desc" }));

    fireEvent.press(screen.getByTestId("open-sort"));
    expect(screen.getByText("Date taken · newest")).toBeTruthy();
    expect(screen.getByText("Date uploaded · newest")).toBeTruthy();
    expect(screen.queryByText("Largest")).toBeNull();
    fireEvent.press(screen.getByText("Date taken · oldest"));
    // The pick runs once the sheet is gone; Jest never reports the dismiss, so it lands on the 1 s backstop.
    await waitFor(() => expect(mockLibraryBrowser).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "photos", sort: "taken_asc" })), { timeout: 2500 });

    act(() => useFilesView.setState({ view: "videos" }));
    fireEvent.press(screen.getByTestId("open-sort"));
    expect(screen.getByText("Date created · oldest")).toBeTruthy();
  });
});

describe("FileBrowser Docs chip", () => {
  it("the Docs chip swaps the listing for the document library and stops fetching the folder", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "documents" }));

    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", kind: "documents" }));
    expect(mockUseFileList.mock.calls.at(-1)?.[4]).toEqual({ enabled: false });
    expect(screen.getByTestId("open-sort")).toBeTruthy();
  });

  it("shows the view toggle and passes documents' default list layout to LibraryBrowser", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "documents" }));

    expect(screen.getByTestId("view-toggle")).toBeTruthy();
    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ layout: "list" }));
    // List layout: the single button offers the grid icon.
    expect(screen.getByTestId("view-toggle-icon-grid")).toBeTruthy();
  });

  // Pressing the toggle in library mode drives the real useViewPrefs store
  // (only expo-secure-store is mocked in this file), same as the rest of the
  // suite - so the assertion reads the store's resulting state rather than a
  // spy, and confirms the next render hands LibraryBrowser the new layout.
  it("pressing the view toggle on the Docs view sets documents' library layout to grid", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "documents" }));
    fireEvent.press(screen.getByTestId("view-toggle"));

    expect(useViewPrefs.getState().libraryLayout.documents).toBe("grid");
    expect(mockLibraryBrowser).toHaveBeenCalledWith(expect.objectContaining({ layout: "grid" }));
  });

  it("pressing the view toggle on the Docs view does not disturb photos' or videos' layout", () => {
    renderBrowser();

    act(() => useFilesView.setState({ view: "documents" }));
    fireEvent.press(screen.getByTestId("view-toggle"));

    expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "grid", videos: "grid", documents: "grid" });
  });

  it("shows the library's total as a count in the toolbar, and no count outside library views", async () => {
    renderBrowser();
    expect(screen.queryByTestId("files-count")).toBeNull();

    act(() => useFilesView.setState({ view: "images" }));
    // After the switch, so an observer holds the entry (gcTime is 0 in this suite).
    act(() => qc.setQueryData(["library", "w1", "photos", "taken_desc", ""], {
      pages: [{ months: [], next_cursor: null, total: 1000 }], pageParams: [null],
    }));

    // react-query notifies its observers on a timer, so the count arrives async.
    expect(await screen.findByTestId("files-count")).toHaveTextContent(/1,000/);
  });
});
