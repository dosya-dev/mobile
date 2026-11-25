import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { PdfReader } from "./PdfReader";
const Pdf = require("react-native-pdf");

jest.mock("react-native-pdf"); // uses __mocks__/react-native-pdf.js
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/files/download", () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock("./readingState", () => {
  const actual = jest.requireActual("./readingState");
  const mockLoadReadingState = jest.fn(async (_fileId?: string) => ({ version: 1, location: "page:7", percent: 0.1, bookmarks: [] }));
  const mockSaveReadingState = jest.fn(async (_fileId: string, _state: unknown) => {});
  return {
    ...actual,
    loadReadingState: mockLoadReadingState,
    saveReadingState: mockSaveReadingState,
    createPositionSaver: jest.fn(() => ({ update: jest.fn(), flush: jest.fn(async () => {}) })),
    // Mirrors BookReader.test.tsx: updateReadingState closes over the real
    // module's own load/save bindings, not these mocked exports, so it must
    // be reimplemented here against the same mocked load/save for callers
    // and assertions to stay in sync (see readingState.ts for why the real
    // one exists - it serializes concurrent writes per file).
    updateReadingState: jest.fn(async (fileId: string, mutate: (s: unknown) => unknown) => {
      const current = await mockLoadReadingState(fileId);
      const next = mutate(current);
      await mockSaveReadingState(fileId, next);
      return next;
    }),
  };
});
import { createPositionSaver, loadReadingState, saveReadingState } from "./readingState";
import { shareFile } from "@/files/download";

const file = { id: "f1", name: "scan.pdf" };

beforeEach(() => jest.clearAllMocks());

it("resumes at the saved page", async () => {
  render(<PdfReader file={file} localUri="file:///b.pdf" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  expect(Pdf.getLastProps()?.source).toEqual({ uri: "file:///b.pdf" });
});

it("reflects page progress on the menu's contents row and saves position on page change", async () => {
  const { getByTestId, getByText } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  // Wait for the resumed state to resolve before simulating a real page
  // change - a page-change event that arrives before resolution is a
  // separate case (see "ignores a native page-settle event..." below).
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  await act(async () => {
    Pdf.getLastProps().onLoadComplete(300, "u", { width: 1, height: 1 }, [{ title: "Ch 1", pageIdx: 0 }]);
    Pdf.getLastProps().onPageChanged(12, 300);
  });
  // Turning a page hides the controls; a tap brings them back before the
  // menu can be opened, as it would on device.
  act(() => { Pdf.getLastProps().onPageSingleTap(); });
  fireEvent.press(getByTestId("reader-menu"));
  getByText("4%");
  const saver = (createPositionSaver as jest.Mock).mock.results[0].value;
  expect(saver.update).toHaveBeenCalledWith("page:12", 12 / 300);
});

it("bookmarks the current page with a page label via the menu", async () => {
  const { getByTestId } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  await act(async () => {
    Pdf.getLastProps().onLoadComplete(300, "u", { width: 1, height: 1 }, []);
    Pdf.getLastProps().onPageChanged(12, 300);
  });
  act(() => { Pdf.getLastProps().onPageSingleTap(); });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-bookmark"));
  await waitFor(() => expect(saveReadingState).toHaveBeenCalled());
  expect((saveReadingState as jest.Mock).mock.calls[0][1].bookmarks[0]).toMatchObject({ location: "page:12", label: "Page 12" });
});

it("ignores a native page-settle event that arrives before the resume state resolves", async () => {
  // Simulates Android/iOS firing their own initial-settle onPageChanged
  // (see PdfReader.tsx's onPageChanged comment) before loadReadingState's
  // promise has resolved, by controlling exactly when it resolves.
  let resolveLoad!: (state: { version: 1; location: string; percent: number; bookmarks: never[] }) => void;
  (loadReadingState as jest.Mock).mockImplementationOnce(
    () => new Promise((resolve) => { resolveLoad = resolve; }),
  );

  render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await act(async () => {
    Pdf.getLastProps().onPageChanged(1, 300); // native's pre-resume echo
  });
  await act(async () => {
    resolveLoad({ version: 1, location: "page:7", percent: 0.1, bookmarks: [] });
  });

  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  const saver = (createPositionSaver as jest.Mock).mock.results[0].value;
  expect(saver.update).not.toHaveBeenCalledWith("page:1", expect.anything());
});

it("shows an 'Open file details' button on error only when onOpenDetails is provided, and fires it", async () => {
  const onOpenDetails = jest.fn();
  const { getByText, getByTestId, queryByTestId } = render(
    <PdfReader file={file} localUri="u" onClose={jest.fn()} onOpenDetails={onOpenDetails} />,
  );
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  act(() => { Pdf.getLastProps().onError(new Error("bad pdf")); });
  getByText("Couldn't open this book");
  fireEvent.press(getByTestId("reader-error-details"));
  expect(onOpenDetails).toHaveBeenCalledTimes(1);

  // Without the prop, no details button should render at all.
  const { queryByTestId: queryByTestIdNoProp } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  act(() => { Pdf.getLastProps().onError(new Error("bad pdf")); });
  expect(queryByTestIdNoProp("reader-error-details")).toBeNull();
  expect(queryByTestId("reader-error-details")).toBeTruthy();
});

// --- New chrome/menu/sheet wiring (Task 11) ---

it("has no legacy control strip left over from earlier tasks", async () => {
  const { queryByTestId } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  expect(queryByTestId("reader-bookmark")).toBeNull();
  expect(queryByTestId("reader-toc")).toBeNull();
});

it("shows only Contents and the circle row in the menu - no search or themes", async () => {
  const { getByTestId, queryByTestId } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  fireEvent.press(getByTestId("reader-menu"));
  expect(getByTestId("menu-contents")).toBeTruthy();
  expect(getByTestId("menu-share")).toBeTruthy();
  expect(getByTestId("menu-bookmark")).toBeTruthy();
  expect(queryByTestId("menu-search")).toBeNull();
  expect(queryByTestId("menu-themes")).toBeNull();
});

it("opens the contents sheet listing the PDF outline from the menu", async () => {
  const { getByTestId, getByText } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  await act(async () => {
    Pdf.getLastProps().onLoadComplete(300, "u", { width: 1, height: 1 }, [{ title: "Ch 1", pageIdx: 0 }]);
  });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-contents"));
  fireEvent.press(getByText("Ch 1"));
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(1));
});

it("returns to the menu when the contents sheet's back control is pressed", async () => {
  const { getByTestId, queryByTestId } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-contents"));
  fireEvent.press(getByTestId("sheet-back"));
  expect(queryByTestId("toc-tab-contents")).toBeNull();
  expect(getByTestId("menu-contents")).toBeTruthy();
});

it("shares the cached local file when Share is pressed", async () => {
  const { getByTestId } = render(<PdfReader file={file} localUri="file:///cache/scan.pdf" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-share"));
  expect(shareFile).toHaveBeenCalledWith("file:///cache/scan.pdf");
});

// --- Controls hide when you read, not on a timer ---

// Hidden chrome leaves the accessibility tree, and RNTL's queries skip such
// elements by default - ask for it explicitly (see ReaderChrome.test.tsx).
const controlsShown = (
  getByTestId: (id: string, opts?: { includeHiddenElements: boolean }) => { props: { pointerEvents?: string } },
) => getByTestId("reader-close", { includeHiddenElements: true }).props.pointerEvents === "auto";

it("never hides the controls on a timer, even before the resume state resolves", async () => {
  let resolveLoad!: (state: { version: 1; location: string; percent: number; bookmarks: never[] }) => void;
  (loadReadingState as jest.Mock).mockImplementationOnce(
    () => new Promise((resolve) => { resolveLoad = resolve; }),
  );
  jest.useFakeTimers();
  const { getByTestId } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(controlsShown(getByTestId)).toBe(true);
  jest.useRealTimers();
  await act(async () => { resolveLoad({ version: 1, location: "page:7", percent: 0.1, bookmarks: [] }); });
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));
  jest.useFakeTimers();
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(controlsShown(getByTestId)).toBe(true);
  jest.useRealTimers();
});

it("hides the controls when the person turns a page, but not on the native echo of a jump it commanded", async () => {
  const { getByTestId, getByText } = render(<PdfReader file={file} localUri="u" onClose={jest.fn()} />);
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(7));

  // The native view echoing the resumed page back is not a page turn.
  await act(async () => { Pdf.getLastProps().onPageChanged(7, 300); });
  expect(controlsShown(getByTestId)).toBe(true);

  // A different page arriving from the native view is a swipe or scroll:
  // that is reading, so the controls get out of the way.
  await act(async () => { Pdf.getLastProps().onPageChanged(8, 300); });
  expect(controlsShown(getByTestId)).toBe(false);

  // A single tap brings them back.
  act(() => { Pdf.getLastProps().onPageSingleTap(); });
  expect(controlsShown(getByTestId)).toBe(true);

  // A jump from the contents sheet is ours, and its echo must not hide the
  // controls the person just used.
  await act(async () => {
    Pdf.getLastProps().onLoadComplete(300, "u", { width: 1, height: 1 }, [{ title: "Ch 1", pageIdx: 0 }]);
  });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-contents"));
  fireEvent.press(getByText("Ch 1"));
  await waitFor(() => expect(Pdf.getLastProps()?.page).toBe(1));
  await act(async () => { Pdf.getLastProps().onPageChanged(1, 300); });
  expect(controlsShown(getByTestId)).toBe(true);
});
