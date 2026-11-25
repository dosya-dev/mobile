import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { BookReader } from "./BookReader";
import { useReaderPrefs } from "./readerPrefs";
import { themeById } from "./readerThemes";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/files/download", () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock("./readingState", () => {
  const actual = jest.requireActual("./readingState");
  const mockLoadReadingState = jest.fn(async (_fileId?: string) => ({ version: 1, location: "cfi(saved)", percent: 0.3, bookmarks: [] }));
  const mockSaveReadingState = jest.fn(async (_fileId: string, _state: unknown) => {});
  return {
    ...actual,
    loadReadingState: mockLoadReadingState,
    saveReadingState: mockSaveReadingState,
    createPositionSaver: jest.fn(() => ({ update: jest.fn(), flush: jest.fn(async () => {}) })),
    // The real updateReadingState is a self-contained queue over the real
    // load/save in this module - it wouldn't observe the jest.fn overrides
    // above, since those live on the mocked exports object, not on the
    // bindings updateReadingState closes over internally. Reimplement it
    // here (unserialized - fine for these UI-level tests) against the same
    // mocked load/save so callers and assertions stay in sync.
    updateReadingState: jest.fn(async (fileId: string, mutate: (s: unknown) => unknown) => {
      const current = await mockLoadReadingState(fileId);
      const next = mutate(current);
      await mockSaveReadingState(fileId, next);
      return next;
    }),
  };
});
jest.mock("./chunkDelivery", () => ({ deliverBook: jest.fn(async () => {}) }));

// Capturing WebView mock: records props, exposes injectJavaScript calls.
// Variable names are prefixed with `mock` because babel-plugin-jest-hoist
// forbids jest.mock() factories from closing over out-of-scope variables
// unless the name starts with `mock`.
const mockInjected: string[] = [];
let mockWebviewProps: Record<string, unknown> = {};
jest.mock("react-native-webview", () => {
  const React = require("react");
  const WebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    mockWebviewProps = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => mockInjected.push(js) }));
    return null;
  });
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});

import { deliverBook } from "./chunkDelivery";
import { createPositionSaver, saveReadingState } from "./readingState";
import { shareFile } from "@/files/download";

const file = { id: "f1", name: "moby.epub", size_bytes: 1000 };
const pageMessage = (msg: object) => ({ nativeEvent: { data: JSON.stringify(msg) } });
// Hidden chrome leaves the accessibility tree, and RNTL's queries skip such
// elements by default - so any query that may run against hidden controls
// asks for them explicitly (see ReaderChrome.test.tsx).
const hidden = { includeHiddenElements: true };

beforeEach(() => {
  mockInjected.length = 0;
  jest.clearAllMocks();
  useReaderPrefs.setState({ fontSizePct: 100, themeId: "light", hydrated: true });
});

it("inits with saved location and delivers the book once the page loads", async () => {
  render(<BookReader file={file} localUri="file:///cache/books/f1-v1.epub" format="book" onClose={jest.fn()} />);
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
  await waitFor(() => expect(mockInjected.some((js) => js.includes("cfi(saved)"))).toBe(true));
  expect(deliverBook).toHaveBeenCalledWith(expect.objectContaining({ uri: "file:///cache/books/f1-v1.epub", size: 1000 }));
});

it("updates the position saver on relocated and reflects progress on the menu's contents row", async () => {
  const { getByTestId, getByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "relocated", location: "cfi(a)", fraction: 0.42, section: "Chapter 3" }));
  });
  const saver = (createPositionSaver as jest.Mock).mock.results[0].value;
  expect(saver.update).toHaveBeenCalledWith("cfi(a)", 0.42);
  fireEvent.press(getByTestId("reader-menu"));
  getByText("42%");
});

it("adds a bookmark at the current location via the menu", async () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "relocated", location: "cfi(a)", fraction: 0.42, section: "Chapter 3" }));
  });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-bookmark"));
  await waitFor(() => expect(saveReadingState).toHaveBeenCalled());
  const saved = (saveReadingState as jest.Mock).mock.calls[0][1];
  expect(saved.bookmarks[0].label).toBe("Chapter 3 · 42%");
});

it("shows the error fallback on page error, in plain language", async () => {
  const { getByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "error", message: "bad zip" })); });
  getByText("This book didn’t open");
  // A page error is not the renderer dying, so it must not claim a memory cause.
  getByText("Something went wrong while opening it.");
});

it("names running out of memory when the renderer dies, not a generic failure", async () => {
  const { getByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => { (mockWebviewProps.onRenderProcessGone as () => void)(); });
  getByText("This book didn’t open");
  getByText("It needed more memory than this phone could spare. Trying again often works.");
});

it("shows a 'File details' link on error only when onOpenDetails is provided, and fires it", async () => {
  const onOpenDetails = jest.fn();
  const { getByText, getByTestId, queryByTestId } = render(
    <BookReader file={file} localUri="u" format="book" onClose={jest.fn()} onOpenDetails={onOpenDetails} />,
  );
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "error", message: "bad zip" })); });
  getByText("This book didn’t open");
  fireEvent.press(getByTestId("reader-error-details"));
  expect(onOpenDetails).toHaveBeenCalledTimes(1);

  // Without the prop, no details button should render at all.
  const { queryByTestId: queryByTestIdNoProp } = render(
    <BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />,
  );
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "error", message: "bad zip" })); });
  expect(queryByTestIdNoProp("reader-error-details")).toBeNull();
  expect(queryByTestId("reader-error-details")).toBeTruthy();
});

it("opens external links via the system browser instead of navigating the webview", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "externalLink", href: "https://example.com/footnote" }),
    );
  });
  expect(openURL).toHaveBeenCalledWith("https://example.com/footnote");
});

it("denies http(s) navigation requests via onShouldStartLoadWithRequest but allows others", async () => {
  render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  const shouldStart = mockWebviewProps.onShouldStartLoadWithRequest as (req: { url: string }) => boolean;
  expect(shouldStart({ url: "https://example.com" })).toBe(false);
  expect(shouldStart({ url: "http://example.com" })).toBe(false);
  expect(shouldStart({ url: "about:blank" })).toBe(true);
});

it("only starts once even if the page reports loaded twice", async () => {
  render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
  await waitFor(() => expect(deliverBook).toHaveBeenCalled());
  expect(deliverBook).toHaveBeenCalledTimes(1);
});

it("flushes the position saver on unmount", async () => {
  const { unmount } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  const saver = (createPositionSaver as jest.Mock).mock.results[0].value;
  expect(saver.flush).not.toHaveBeenCalled();
  unmount();
  expect(saver.flush).toHaveBeenCalledTimes(1);
});

it("injects a goTo when a table-of-contents entry is selected via the menu", async () => {
  const { getByTestId, getByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "toc", items: [{ label: "Chapter 1", href: "c1", depth: 0 }] }),
    );
  });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-contents"));
  fireEvent.press(getByText("Chapter 1"));
  expect(mockInjected.some((js) => js.includes("__dosyaGoTo") && js.includes("c1"))).toBe(true);
});

it("injects updated prefs once the page is ready", async () => {
  render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "relocated", location: "cfi(a)", fraction: 0.1, section: null }),
    );
  });
  mockInjected.length = 0;
  await act(async () => {
    useReaderPrefs.setState({ fontSizePct: 130, themeId: "dark" });
  });
  // The page protocol carries resolved colors, not the theme id (see
  // bridge.ts's PageConfig/jsApply) - assert on the dark theme's actual
  // bg/fg rather than the literal string "dark".
  const dark = themeById("dark");
  expect(
    mockInjected.some(
      (js) => js.includes("__dosyaApply") && js.includes("130") && js.includes(dark.bg) && js.includes(dark.fg),
    ),
  ).toBe(true);
});

// --- New chrome/menu/sheet wiring (Task 10) ---

it("has no legacy control strip left over from earlier tasks", () => {
  const { queryByTestId, queryByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  expect(queryByTestId("reader-bookmark")).toBeNull();
  expect(queryByTestId("reader-toc")).toBeNull();
  expect(queryByText(/^0%/)).toBeNull();
});

it("shows search and themes rows for a book, but hides search for txt", () => {
  const { getByTestId, queryByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  expect(getByTestId("menu-search")).toBeTruthy();
  expect(getByTestId("menu-themes")).toBeTruthy();

  const { getByTestId: getByTestId2, queryByTestId: queryByTestId2 } = render(
    <BookReader file={{ ...file, name: "notes.txt" }} localUri="u" format="txt" onClose={jest.fn()} />,
  );
  fireEvent.press(getByTestId2("reader-menu"));
  expect(queryByTestId2("menu-search")).toBeNull();
  expect(getByTestId2("menu-themes")).toBeTruthy();
});

it("never hides the chrome on a timer, whether a sheet is open or the book is still preparing", () => {
  jest.useFakeTimers();
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  // ui.status starts (and stays, in this test) "preparing" - no relocated
  // message has been sent.
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-themes"));
  act(() => { jest.advanceTimersByTime(60_000); });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  jest.useRealTimers();
});

it("opens the themes sheet from the menu and injects the selected theme's colors", async () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  // The jsApply-on-theme-change effect only fires once the page has
  // reported a location (status "ready") - get there first.
  await act(async () => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "relocated", location: "cfi(a)", fraction: 0.1, section: null }),
    );
  });
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-themes"));
  expect(getByTestId("theme-ocean")).toBeTruthy();
  mockInjected.length = 0;
  await act(async () => { fireEvent.press(getByTestId("theme-ocean")); });
  const ocean = themeById("ocean");
  expect(mockInjected.some((js) => js.includes("__dosyaApply") && js.includes(ocean.bg) && js.includes(ocean.fg))).toBe(true);
});

it("returns to the menu when a sheet's back control is pressed", () => {
  const { getByTestId, queryByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-themes"));
  fireEvent.press(getByTestId("sheet-back"));
  expect(queryByTestId("theme-light")).toBeNull();
  expect(getByTestId("menu-contents")).toBeTruthy();
});

it("shares the cached local file when Share is pressed", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="file:///cache/moby.epub" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-share"));
  expect(shareFile).toHaveBeenCalledWith("file:///cache/moby.epub");
});

it("runs a search, renders hits, stops the indicator on searchDone, and jumps to a selected hit", () => {
  jest.useFakeTimers();
  const { getByTestId, getByText, queryByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-search"));
  fireEvent.changeText(getByTestId("search-input"), "whale");
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockInjected.some((js) => js.includes("__dosyaSearch") && js.includes("whale"))).toBe(true);
  expect(getByTestId("search-indicator")).toBeTruthy();

  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 1, items: [{ cfi: "cfi(x)", excerpt: "a whale breaches" }] }),
    );
  });
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "searchDone", gen: 1 }));
  });
  getByText("a whale breaches");
  expect(queryByTestId("search-indicator")).toBeNull();

  mockInjected.length = 0;
  fireEvent.press(getByTestId("search-hit-0"));
  expect(mockInjected.some((js) => js.includes("__dosyaGoTo") && js.includes("cfi(x)"))).toBe(true);
  jest.useRealTimers();
});

it("clears hits on a new query and clears search state when the sheet closes", () => {
  jest.useFakeTimers();
  const { getByTestId, getByText, queryByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-search"));
  fireEvent.changeText(getByTestId("search-input"), "whale");
  act(() => { jest.advanceTimersByTime(300); });
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 1, items: [{ cfi: "cfi(x)", excerpt: "a whale breaches" }] }),
    );
  });
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "searchDone", gen: 1 }));
  });
  getByText("a whale breaches");

  mockInjected.length = 0;
  fireEvent.changeText(getByTestId("search-input"), "harpoon");
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockInjected.some((js) => js.includes("__dosyaSearch") && js.includes("harpoon"))).toBe(true);
  expect(queryByText("a whale breaches")).toBeNull();

  mockInjected.length = 0;
  fireEvent.press(getByTestId("sheet-done"));
  expect(mockInjected.some((js) => js.includes("__dosyaSearchClear"))).toBe(true);
  jest.useRealTimers();
});

it("shows a search error inline in the sheet without tearing down the reader, and clears it on the next query", () => {
  jest.useFakeTimers();
  const { getByTestId, getByText, queryByText, queryByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-search"));
  fireEvent.changeText(getByTestId("search-input"), "whale");
  act(() => { jest.advanceTimersByTime(300); });

  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "searchError", gen: 1, message: "Search failed." }));
  });
  getByText("Search failed.");
  // The reader must stay on the reading surface - a search failure is never
  // allowed to swap the whole screen to the terminal error fallback.
  expect(queryByText("This book didn’t open")).toBeNull();
  expect(getByTestId("reader-close")).toBeTruthy();
  expect(queryByTestId("search-indicator")).toBeNull();

  mockInjected.length = 0;
  fireEvent.changeText(getByTestId("search-input"), "whale song");
  act(() => { jest.advanceTimersByTime(300); });
  expect(queryByText("Search failed.")).toBeNull();
  jest.useRealTimers();
});

it("ignores search results/done messages that arrive when no search is active", () => {
  const { getByTestId, queryByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-search"));
  // No query has been typed, so no search is in flight - a batch that
  // arrives anyway (e.g. left over from a since-cancelled search) must not
  // be appended to the hit list.
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 1, items: [{ cfi: "cfi(stale)", excerpt: "a stale hit" }] }),
    );
  });
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "searchDone", gen: 1 }));
  });
  expect(queryByText("a stale hit")).toBeNull();
});

it("drops a stale batch left over from a superseded query but keeps a batch tagged for the new query (query-generation guard)", () => {
  jest.useFakeTimers();
  const { getByTestId, getByText, queryByText } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  fireEvent.press(getByTestId("reader-menu"));
  fireEvent.press(getByTestId("menu-search"));

  // Query A ("cat") is dispatched and its first batch (gen 1) arrives normally.
  // (The sheet shows a spinner instead of the hit list while `searching` is
  // true, so hits aren't asserted visible until the search actually ends
  // below - the point of this test is what ends up in the list, not what's
  // on screen mid-flight.)
  fireEvent.changeText(getByTestId("search-input"), "cat");
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockInjected.some((js) => js.includes("__dosyaSearch") && js.includes("cat") && !js.includes("cathedral"))).toBe(true);
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 1, items: [{ cfi: "cfi(cat)", excerpt: "a cat nap" }] }),
    );
  });

  // Query B ("cathedral") is dispatched before A finishes - this clears the
  // host's hit list, but `searching` never dips to false in between (A's own
  // searchDone/searchError never arrived).
  fireEvent.changeText(getByTestId("search-input"), "cathedral");
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockInjected.some((js) => js.includes("__dosyaSearch") && js.includes("cathedral"))).toBe(true);

  // A batch A had already posted (still tagged gen 1) arrives after B's
  // dispatch - it must be dropped, not appended into B's results.
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 1, items: [{ cfi: "cfi(stale)", excerpt: "a stale cat hit" }] }),
    );
  });

  // B's own (higher-gen) batch must still come through, and B's searchDone
  // ends the search so the sheet swaps from the spinner to the hit list.
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(
      pageMessage({ type: "searchResults", gen: 2, items: [{ cfi: "cfi(cathedral)", excerpt: "a cathedral spire" }] }),
    );
  });
  act(() => {
    (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "searchDone", gen: 2 }));
  });
  getByText("a cathedral spire");
  expect(queryByText("a stale cat hit")).toBeNull();
  expect(queryByText("a cat nap")).toBeNull();
  jest.useRealTimers();
});

// --- Tap model (see bridge.ts's decideTap) ---
//
// The page reports where a tap landed as page fractions; this side decides
// what it meant. Under the safe-area mock (zero insets) and with no layout
// event fired, the bands are chromeLayout's FALLBACK_BAND (15% top and
// bottom), so y=0.05 is "in the top band" and y=0.5 is "the middle band".

const send = (msg: object) => {
  act(() => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage(msg)); });
};
const turns = () => mockInjected.filter((js) => js.includes("__dosyaTurn"));

it("hides the chrome on a swipe", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  send({ type: "swipe" });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("none");
});

it("a tap while the chrome is shown only hides it - even at the page edge, it never turns a page", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  mockInjected.length = 0;
  send({ type: "tap", x: 0.95, y: 0.5 });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("none");
  expect(turns()).toEqual([]);
});

it("a tap in the top band while hidden shows the chrome instead of turning the page - the corner is where the X lives", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  send({ type: "swipe" });
  mockInjected.length = 0;
  send({ type: "tap", x: 0.95, y: 0.05 });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  expect(turns()).toEqual([]);
});

it("a tap in the bottom band while hidden shows the chrome - that is where the menu button lives", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  send({ type: "swipe" });
  mockInjected.length = 0;
  send({ type: "tap", x: 0.95, y: 0.95 });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  expect(turns()).toEqual([]);
});

it("a right-edge tap in the middle band while hidden turns to the next page and keeps the chrome hidden", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  send({ type: "swipe" });
  mockInjected.length = 0;
  send({ type: "tap", x: 0.95, y: 0.5 });
  expect(turns()).toEqual(["window.__dosyaTurn(1);true;"]);
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("none");
});

it("a left-edge tap in the middle band while hidden turns to the previous page", () => {
  render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  send({ type: "swipe" });
  mockInjected.length = 0;
  send({ type: "tap", x: 0.05, y: 0.5 });
  expect(turns()).toEqual(["window.__dosyaTurn(-1);true;"]);
});

it("a centre tap while hidden shows the chrome", () => {
  const { getByTestId } = render(<BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />);
  send({ type: "swipe" });
  mockInjected.length = 0;
  send({ type: "tap", x: 0.5, y: 0.5 });
  expect(getByTestId("reader-close", hidden).props.pointerEvents).toBe("auto");
  expect(turns()).toEqual([]);
});

// ---------------------------------------------------------------------------
// Renderer death, opening progress
// ---------------------------------------------------------------------------

it("turns a dead WebView renderer into an error with a retry, not an endless spinner", async () => {
  const { queryByTestId, getByTestId } = render(
    <BookReader file={file} localUri="file:///cache/books/f1-v1.epub" format="book" onClose={jest.fn()} />,
  );
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });

  // Still opening: the overlay is up and there is no error screen.
  expect(queryByTestId("reader-prepare-progress")).not.toBeNull();
  expect(queryByTestId("reader-error-retry")).toBeNull();

  // The renderer process dies. Nothing else will ever arrive over the bridge -
  // in particular no `relocated`, which is the only thing that clears
  // "preparing". Before onRenderProcessGone was wired up this left the reader
  // showing "Preparing book…" forever on top of a dead WebView.
  await act(async () => { (mockWebviewProps.onRenderProcessGone as () => void)(); });

  expect(queryByTestId("reader-prepare-progress")).toBeNull();
  expect(getByTestId("reader-error-retry")).toBeTruthy();
});

it("remounts the WebView and re-delivers the book on retry", async () => {
  const { getByTestId } = render(
    <BookReader file={file} localUri="file:///cache/books/f1-v1.epub" format="book" onClose={jest.fn()} />,
  );
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
  expect(deliverBook).toHaveBeenCalledTimes(1);

  await act(async () => { (mockWebviewProps.onRenderProcessGone as () => void)(); });
  await act(async () => { fireEvent.press(getByTestId("reader-error-retry")); });

  // A fresh WebView (new key) reloads the page, which posts `loaded` again;
  // the delivery guard must have been released so the book is sent anew.
  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "loaded" })); });
  expect(deliverBook).toHaveBeenCalledTimes(2);
});

it("names the step it is on while the book opens", async () => {
  const { getByTestId } = render(
    <BookReader file={file} localUri="file:///cache/books/f1-v1.epub" format="book" onClose={jest.fn()} />,
  );
  expect(getByTestId("reader-stage-label")).toHaveTextContent("Preparing book…");

  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "stage", stage: "parsing" })); });
  expect(getByTestId("reader-stage-label")).toHaveTextContent("Reading book…");

  await act(async () => { (mockWebviewProps.onMessage as (e: unknown) => void)(pageMessage({ type: "stage", stage: "rendering" })); });
  expect(getByTestId("reader-stage-label")).toHaveTextContent("Laying out pages…");
});

it("keeps the book's own surface behind the failure instead of swapping screens", () => {
  // Option A: the card sits over the dimmed page, so the WebView stays
  // mounted and the reader never flashes the app background over a book
  // that was being read in a dark reading theme.
  const { getByTestId, queryByTestId } = render(
    <BookReader file={file} localUri="u" format="book" onClose={jest.fn()} />,
  );
  act(() => { (mockWebviewProps.onRenderProcessGone as () => void)(); });
  expect(getByTestId("reader-overlay")).toBeTruthy();
  expect(mockWebviewProps.source).toBeTruthy(); // the WebView is still rendered
  // The floating chrome steps aside: the card owns the way out now.
  expect(queryByTestId("reader-close")).toBeNull();
});
