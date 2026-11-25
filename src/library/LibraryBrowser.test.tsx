import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SectionList } from "react-native";
import { makeMutable } from "react-native-reanimated";
import { SelectionMotionScope, type SelectionMotion } from "@/files/selection/SelectionMotion";
import { LibraryBrowser, libraryRowKey } from "./LibraryBrowser";
import { useLibrary } from "./hooks";
import type { LibraryPage, LibraryItem } from "./api";

// Icons are lucide SVGs and carry `aria-hidden` unless given a label, which is
// correct for a decorative glyph. RNTL skips hidden elements by default, so
// these queries opt in explicitly - including the negative ones, which would
// otherwise pass because the element is hidden rather than because it is absent.
const HIDDEN = { includeHiddenElements: true } as const;

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("./hooks", () => ({ useLibrary: jest.fn() }));

// `mock`-prefixed spies returning null, never an inline factory building React
// elements - nativewind's babel transform injects an out-of-scope var when it
// rewrites JSX inside a hoisted jest.mock factory.
const mockFileThumb = jest.fn((_p: unknown) => null);
jest.mock("@/files/FileThumb", () => ({ FileThumb: (p: unknown) => mockFileThumb(p) }));
const mockFileRow = jest.fn((_p: unknown) => null);
jest.mock("@/files/FileRow", () => ({ FileRow: (p: unknown) => mockFileRow(p) }));
const mockFileCard = jest.fn((_p: unknown) => null);
jest.mock("@/files/FileCard", () => ({ FileCard: (p: unknown) => mockFileCard(p) }));

const mockSetViewerList = jest.fn();
jest.mock("@/viewer/viewerStore", () => ({
  useViewerList: (sel: (s: { setViewerList: typeof mockSetViewerList }) => unknown) => sel({ setViewerList: mockSetViewerList }),
}));

function photo(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 1, mime_type: "image/jpeg", extension: "jpg",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none",
    share_count: 0, comment_count: 0, folder_id: null, taken_at: 1718445600, ...over,
  };
}

function video(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.mp4`, size_bytes: 5242880, mime_type: "video/mp4", extension: "mp4",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none",
    share_count: 0, comment_count: 0, folder_id: null, taken_at: 1718445600, ...over,
  };
}

function doc(id: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, name: `${id}.pdf`, size_bytes: 2048, mime_type: "application/pdf", extension: "pdf",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none",
    share_count: 0, comment_count: 0, folder_id: null, taken_at: 1718445600, ...over,
  };
}

const PAGE: LibraryPage = {
  total: 25, counts: { "2024-07": 23, "2024-06": 2 },
  months: [
    { key: "2024-07", label: "July 2024", files: [photo("a"), photo("b")] },
    { key: "2024-06", label: "June 2024", files: [photo("c"), photo("d")] },
  ],
  next_cursor: "cur",
};

const VIDEO_PAGE: LibraryPage = {
  total: 2, counts: { "2024-07": 2 },
  months: [{ key: "2024-07", label: "July 2024", files: [video("v1"), video("v2", { size_bytes: 1048576 })] }],
  next_cursor: null,
};

const DOC_PAGE: LibraryPage = {
  total: 2, counts: { "2024-07": 2 },
  months: [{ key: "2024-07", label: "July 2024", files: [doc("d1"), doc("d2")] }],
  next_cursor: null,
};

const EMPTY_PAGE: LibraryPage = { months: [], next_cursor: null, total: 0, counts: {} };

function mockQuery(over: Partial<ReturnType<typeof useLibrary>> = {}) {
  const q = {
    data: { pages: [PAGE], pageParams: [null] },
    isLoading: false, isError: false, isFetchingNextPage: false, isRefetching: false, hasNextPage: true,
    fetchNextPage: jest.fn(), refetch: jest.fn(),
    ...over,
  };
  (useLibrary as jest.Mock).mockReturnValue(q);
  return q;
}

beforeEach(() => { jest.clearAllMocks(); });

function settledMotion(): SelectionMotion {
  return {
    progress: makeMutable(1), active: makeMutable(1), firstVisibleRow: makeMutable(0), visibleRows: makeMutable(0),
    reportVisibleRows: () => {}, checksMounted: true,
  };
}

describe("LibraryBrowser", () => {
  it("renders month headers with full counts and a partial-load note", () => {
    mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />);
    expect(screen.getByText("July 2024")).toBeTruthy();
    expect(screen.getByText("23 photos")).toBeTruthy();
    expect(screen.getByText("· 2 loaded")).toBeTruthy();
    expect(screen.getByText("June 2024")).toBeTruthy();
    expect(screen.getByText("2 photos")).toBeTruthy();
  });

  it("shows progress and Load more, which fetches the next page", () => {
    const q = mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />);
    expect(screen.getByText("Showing 4 of 25 photos")).toBeTruthy();
    fireEvent.press(screen.getByTestId("load-more"));
    expect(q.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("says that's all when exhausted", () => {
    mockQuery({ data: { pages: [{ ...PAGE, next_cursor: null, total: 4 }], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />);
    expect(screen.getByText("That's all 4 photos.")).toBeTruthy();
    expect(screen.queryByTestId("load-more")).toBeNull();
  });

  it("opens a photo with the loaded list as the viewer context", () => {
    mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />);
    fireEvent.press(screen.getByTestId("photo-c"));
    expect(mockSetViewerList).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "d" })]), "Photos");
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it("long-press hands the photo to onMore", () => {
    mockQuery();
    const onMore = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" onMore={onMore} />);
    fireEvent(screen.getByTestId("photo-a"), "longPress");
    expect(onMore).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("renders the empty state", () => {
    mockQuery({ data: { pages: [{ months: [], next_cursor: null, total: 0, counts: {} }], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />);
    expect(screen.getByText("No photos yet")).toBeTruthy();
  });

  it("waits, rather than claiming the library is empty, while the workspace is unresolved", () => {
    // useLibrary is disabled with no workspace, so it never reports isLoading -
    // the component has to recognise the null workspace itself.
    mockQuery({ data: undefined, isLoading: false, hasNextPage: false });
    render(<LibraryBrowser workspaceId={null} kind="photos" layout="grid" />);
    expect(screen.getByTestId("photos-loading")).toBeTruthy();
    expect(screen.queryByText("No photos yet")).toBeNull();
  });
});

describe("LibraryBrowser videos", () => {
  it("renders 2-up video cards with name, size and a format pill, and never touches FileThumb", () => {
    mockQuery({ data: { pages: [VIDEO_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" />);
    expect(screen.getByTestId("video-v1")).toBeTruthy();
    expect(screen.getByTestId("video-v2")).toBeTruthy();
    expect(screen.getByText("v1.mp4")).toBeTruthy();
    expect(screen.getByText("5.0 MB")).toBeTruthy();
    expect(screen.getAllByText("MP4")).toHaveLength(2);
    expect(screen.getByTestId("video-play-v1", HIDDEN)).toBeTruthy();
    expect(mockFileThumb).not.toHaveBeenCalled();
  });

  it("shows the lock glyph instead of play for a locked video", () => {
    const lockedPage: LibraryPage = {
      total: 1, counts: { "2024-07": 1 },
      months: [{ key: "2024-07", label: "July 2024", files: [video("v3", { lock_mode: "full_lock" })] }],
      next_cursor: null,
    };
    mockQuery({ data: { pages: [lockedPage], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" />);
    expect(screen.getByTestId("video-lock-v3", HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId("video-play-v3", HIDDEN)).toBeNull();
  });

  it("keeps the play mark for a view-only video, which still streams", () => {
    const viewOnlyPage: LibraryPage = {
      total: 1, counts: { "2024-07": 1 },
      months: [{ key: "2024-07", label: "July 2024", files: [video("v4", { lock_mode: "view_only" })] }],
      next_cursor: null,
    };
    mockQuery({ data: { pages: [viewOnlyPage], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" />);
    expect(screen.getByTestId("video-play-v4", HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId("video-lock-v4")).toBeNull();
  });

  it("opens a video with the viewer list titled after the kind", () => {
    mockQuery({ data: { pages: [VIDEO_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" />);
    fireEvent.press(screen.getByTestId("video-v1"));
    expect(mockSetViewerList).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "v1" })]), "Videos");
  });

  it("renders the videos empty state", () => {
    mockQuery({ data: { pages: [EMPTY_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" />);
    expect(screen.getByText("No videos yet")).toBeTruthy();
  });
});

describe("LibraryBrowser documents", () => {
  it("renders one FileRow per document, not chunked into tiles", () => {
    mockQuery({ data: { pages: [DOC_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="documents" layout="list" />);
    expect(mockFileRow).toHaveBeenCalledTimes(2);
    expect(mockFileRow).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "d1" }) }));
    expect(mockFileRow).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "d2" }) }));
  });

  it("renders the documents empty state", () => {
    mockQuery({ data: { pages: [EMPTY_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="documents" layout="list" />);
    expect(screen.getByText("No documents yet")).toBeTruthy();
  });
});

describe("LibraryBrowser layout prop", () => {
  it("list layout renders one FileRow per photo instead of photo tiles", () => {
    mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="list" />);
    expect(mockFileRow).toHaveBeenCalledTimes(4);
    expect(mockFileRow).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "a" }) }));
    expect(mockFileRow).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "d" }) }));
    expect(screen.queryByTestId("photo-a")).toBeNull();
  });

  it("grid layout renders one FileCard per document, 3-up, instead of FileRow", () => {
    mockQuery({ data: { pages: [DOC_PAGE], pageParams: [null] }, hasNextPage: false });
    render(<LibraryBrowser workspaceId="ws_1" kind="documents" layout="grid" />);
    expect(mockFileCard).toHaveBeenCalledTimes(2);
    expect(mockFileCard).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "d1" }) }));
    expect(mockFileCard).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "d2" }) }));
    expect(mockFileRow).not.toHaveBeenCalled();
  });
});

describe("LibraryBrowser selection", () => {
  it("in selection, tapping a photo toggles it and does not open the viewer", () => {
    mockQuery();
    const onToggleSelect = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" selectable selected={new Set(["a"])} onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByTestId("photo-b"));
    expect(onToggleSelect).toHaveBeenCalledWith("b");
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockSetViewerList).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-a", HIDDEN).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId("select-b", HIDDEN).props.accessibilityState).toEqual({ checked: false });
  });

  it("shows no checks and opens on tap outside selection", () => {
    mockQuery();
    const onToggleSelect = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" onToggleSelect={onToggleSelect} />);
    expect(screen.queryByTestId("select-a", HIDDEN)).toBeNull();
    fireEvent.press(screen.getByTestId("photo-a"));
    expect(onToggleSelect).not.toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it("keeps the checks mounted while `checks` is on after selection ends (the exit fade)", () => {
    mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" checks />);
    expect(screen.getByTestId("select-a", HIDDEN)).toBeTruthy();
  });

  it("a long-press in selection does not open the actions sheet", () => {
    mockQuery();
    const onMore = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" selectable onMore={onMore} onToggleSelect={jest.fn()} />);
    fireEvent(screen.getByTestId("photo-a"), "longPress");
    expect(onMore).not.toHaveBeenCalled();
  });

  it("in selection, tapping a video toggles it and shows its check", () => {
    mockQuery({ data: { pages: [VIDEO_PAGE], pageParams: [null] }, hasNextPage: false });
    const onToggleSelect = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="videos" layout="grid" selectable selected={new Set(["v2"])} onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByTestId("video-v1"));
    expect(onToggleSelect).toHaveBeenCalledWith("v1");
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-v2", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });

  it("hands document tiles and list rows their selection props and grid position", () => {
    mockQuery({ data: { pages: [DOC_PAGE], pageParams: [null] }, hasNextPage: false });
    const onToggleSelect = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="documents" layout="grid" selectable checks selected={new Set(["d2"])} onToggleSelect={onToggleSelect} />);
    expect(mockFileCard).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ id: "d2" }), selectable: true, checks: true, selected: true, row: 0, col: 1,
    }));
    const d1 = mockFileCard.mock.calls.map((c) => c[0] as { file: { id: string }; selected: boolean; onToggleSelect: () => void }).find((p) => p.file.id === "d1")!;
    expect(d1.selected).toBe(false);
    d1.onToggleSelect();
    expect(onToggleSelect).toHaveBeenCalledWith("d1");
  });

  it("list rows get the selection props, with a flat row index across months", () => {
    mockQuery();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="list" selectable selected={new Set(["c"])} onToggleSelect={jest.fn()} />);
    expect(mockFileRow).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ id: "c" }), selectable: true, selected: true, row: 2 }));
  });

  it("reports the merged loaded files so the caller can find Live Photo twins", () => {
    mockQuery();
    const onLoadedFiles = jest.fn();
    render(<LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" onLoadedFiles={onLoadedFiles} />);
    expect(onLoadedFiles).toHaveBeenLastCalledWith(["a", "b", "c", "d"].map((id) => expect.objectContaining({ id })));
  });

  it("reports its visible rows, counted across months, to the selection motion", () => {
    mockQuery();
    const motion = { ...settledMotion(), reportVisibleRows: jest.fn() };
    render(
      <SelectionMotionScope value={motion}>
        <LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" />
      </SelectionMotionScope>,
    );
    const list = screen.UNSAFE_getByType(SectionList);
    const sections = list.props.sections as { key: string }[];
    act(() => {
      list.props.onViewableItemsChanged({ viewableItems: [
        { index: null, section: sections[1], item: undefined, key: "h", isViewable: true },
        { index: 0, section: sections[1], item: [], key: "r", isViewable: true },
      ], changed: [] });
    });
    expect(motion.reportVisibleRows).toHaveBeenLastCalledWith(1, 1);
  });
});

// SectionList runs the key extractor on visible section headers too, handing
// it the section object; 1.0.9 (47) crashed on `.map` of a section.
describe("libraryRowKey", () => {
  it("keys a row by its files' ids", () => {
    expect(libraryRowKey([{ id: "a" }, { id: "b" }] as never, 0)).toBe("a|b");
  });

  it("keys a section header without treating it as a row", () => {
    expect(libraryRowKey({ title: "November 2026", data: [] } as never, 0)).toBe("section:November 2026");
  });
});
