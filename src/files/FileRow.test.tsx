import { render, screen, fireEvent } from "@testing-library/react-native";
import { FileRow } from "./FileRow";
import { useDownloadStore } from "./downloadStore";
import type { FileItem } from "./types";

// Icons are lucide SVGs and carry `aria-hidden` unless given a label, which is
// correct for a decorative glyph. RNTL skips hidden elements by default, so
// these queries opt in explicitly - including the negative ones, which would
// otherwise pass because the element is hidden rather than because it is absent.
const HIDDEN = { includeHiddenElements: true } as const;

const file = {
  id: "f1", name: "report.pdf", size_bytes: 5 * 1024 * 1024, mime_type: "application/pdf",
  extension: "pdf", created_at: 1700000000, updated_at: 1700000000, current_version: 1,
  lock_mode: "none", share_count: 0, comment_count: 0,
};

describe("FileRow", () => {
  it("shows the name and human size", () => {
    render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
  });
  it("calls onPress", () => {
    const onPress = jest.fn();
    render(<FileRow file={file} onPress={onPress} />);
    fireEvent.press(screen.getByText("report.pdf"));
    expect(onPress).toHaveBeenCalled();
  });

  // "Hidden" is never binary from the viewer's own perspective - if they can
  // see the row at all, they're someone it's NOT hidden from. The row only
  // needs to say THAT it's hidden from someone else, hence no per-mode copy
  // here (unlike web/desktop's tooltip) - just the badge.
  it("shows a hidden badge for a hidden file, and not for a visible one", () => {
    render(<FileRow file={{ ...file, is_hidden: 1, hidden_mode: "everyone" }} onPress={() => {}} />);
    expect(screen.getByTestId("hidden-f1", HIDDEN)).toBeTruthy();
  });

  it("shows no hidden badge for a visible file", () => {
    render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.queryByTestId("hidden-f1", HIDDEN)).toBeNull();
  });
});

// List view is the one place a Live Photo is two rows rather than one tile, so
// it is the one place that has to say which two rows they are. Without this the
// pair reads as an unrelated photo and video that happen to sort together.
describe("a Live Photo in list view", () => {
  const still = { ...file, id: "s1", name: "IMG_1.HEIC", live_video_id: "v1" };
  const twin = { ...file, id: "v1", name: "IMG_1.MOV", live_photo_id: "s1" };

  it("marks the still with a Live pill", () => {
    render(<FileRow file={still} onPress={() => {}} />);
    expect(screen.getByTestId("live-pill-s1")).toHaveTextContent("Live");
  });

  it("leaves an ordinary file unmarked and unindented", () => {
    render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.queryByTestId("live-pill-f1")).toBeNull();
    expect(screen.queryByTestId("live-twin-row-f1")).toBeNull();
  });

  // The video keeps its own row, its own actions and its own name - it is not
  // hidden (spec 2) - but it is indented under the still and says what it is
  // instead of showing a size and date that read like a clip somebody filmed.
  it("indents the twin and names it for what it is", () => {
    render(<FileRow file={twin} onPress={() => {}} />);
    expect(screen.getByTestId("live-twin-row-v1")).toBeTruthy();
    expect(screen.getByText("Live Photo video")).toBeTruthy();
    expect(screen.queryByTestId("live-pill-v1")).toBeNull();
  });

  it("keeps the twin's own More button", () => {
    const onMore = jest.fn();
    render(<FileRow file={twin} onPress={() => {}} onMore={onMore} />);
    fireEvent.press(screen.getByTestId("more-v1"));
    expect(onMore).toHaveBeenCalled();
  });
});

describe("a file that is downloading", () => {
  const running = {
    fileId: "f1",
    name: "match.mp4",
    phase: "downloading" as const,
    written: 42,
    total: 100,
    startedAt: 0,
  };

  const makeFile = (over: Partial<FileItem>): FileItem => ({ ...file, ...over }) as FileItem;

  beforeEach(() => useDownloadStore.getState().clearAll());
  afterEach(() => useDownloadStore.getState().clearAll());

  // The whole reason the store is keyed by file id: leaving the viewer must not
  // lose sight of the transfer.
  it("shows the ring in the row, so backing out of the viewer does not lose it", () => {
    useDownloadStore.setState({ entries: { f1: running } });
    render(<FileRow file={makeFile({ id: "f1" })} onPress={jest.fn()} />);
    expect(screen.getByTestId("download-ring-percent")).toHaveTextContent("42");
  });

  it("takes the thumbnail's place rather than widening the row", () => {
    useDownloadStore.setState({ entries: { f1: running } });
    render(<FileRow file={makeFile({ id: "f1" })} onPress={jest.fn()} />);
    expect(screen.queryByTestId("file-thumb")).toBeNull();
  });

  it("says how far along it is next to the size, not instead of it", () => {
    useDownloadStore.setState({ entries: { f1: running } });
    render(<FileRow file={makeFile({ id: "f1" })} onPress={jest.fn()} />);
    expect(screen.getByText(/Downloading/)).toBeTruthy();
  });

  it("leaves every other row alone", () => {
    useDownloadStore.setState({ entries: { f1: running } });
    render(<FileRow file={makeFile({ id: "f2" })} onPress={jest.fn()} />);
    expect(screen.queryByTestId("download-ring-percent")).toBeNull();
  });
});
