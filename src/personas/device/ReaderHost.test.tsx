// The hidden WebView that reads faces for Personas: mounted only while the
// reader channel wants it, loading the web app's reader page, and wired both ways.
import { act, render } from "@testing-library/react-native";

const mockProps: { current: Record<string, unknown> | null } = { current: null };
const mockPosted: string[] = [];
jest.mock("react-native-webview", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  return {
    WebView: React.forwardRef(function WebViewMock(props: Record<string, unknown>, ref) {
      mockProps.current = props;
      React.useImperativeHandle(ref, () => ({ postMessage: (m: string) => mockPosted.push(m) }));
      return null;
    }),
  };
});

import { createReaderChannel } from "./channel";
import { ReaderHost, READER_PAGE_URL } from "./ReaderHost";

beforeEach(() => { mockProps.current = null; mockPosted.length = 0; });

it("loads the web app's reader page only while there is reading to do", () => {
  const ch = createReaderChannel();
  const r = render(<ReaderHost channel={ch} />);
  expect(mockProps.current).toBeNull();
  expect(r.toJSON()).toBeNull();
  act(() => ch.post("first"));
  expect(mockProps.current).not.toBeNull();
  expect(READER_PAGE_URL).toBe("https://app.dosya.dev/personas-reader.html");
  expect(mockProps.current!.source).toEqual({ uri: READER_PAGE_URL });
  act(() => ch.close());
  expect(r.toJSON()).toBeNull();
});

it("passes the page's messages to the channel and the channel's to the page once it is ready", () => {
  const ch = createReaderChannel();
  const inbound: string[] = [];
  ch.connect({ receive: (d) => inbound.push(d), gone: () => {} });
  render(<ReaderHost channel={ch} />);
  act(() => ch.post("photo-1"));
  const onMessage = mockProps.current!.onMessage as (e: { nativeEvent: { data: string } }) => void;
  act(() => onMessage({ nativeEvent: { data: JSON.stringify({ type: "ready", supported: true }) } }));
  expect(mockPosted).toEqual(["photo-1"]);
  act(() => onMessage({ nativeEvent: { data: '{"id":1,"faces":[]}' } }));
  expect(inbound).toEqual(['{"type":"ready","supported":true}', '{"id":1,"faces":[]}']);
});

it("a dead content process, a crashed renderer or a failed load tells the channel", () => {
  const ch = createReaderChannel();
  const gone = jest.fn();
  ch.connect({ receive: () => {}, gone });
  render(<ReaderHost channel={ch} />);
  act(() => ch.post("x"));
  for (const name of ["onContentProcessDidTerminate", "onRenderProcessGone", "onError", "onHttpError"]) {
    act(() => (mockProps.current![name] as () => void)());
  }
  expect(gone).toHaveBeenCalledTimes(4);
});

it("stays on the reader page: no other page is loaded in it", () => {
  const ch = createReaderChannel();
  render(<ReaderHost channel={ch} />);
  act(() => ch.post("x"));
  const allow = mockProps.current!.onShouldStartLoadWithRequest as (r: { url: string }) => boolean;
  expect(allow({ url: READER_PAGE_URL })).toBe(true);
  expect(allow({ url: "https://example.com/" })).toBe(false);
  expect(allow({ url: "https://app.dosya.dev/files" })).toBe(false);
});

describe("with the native reader", () => {
  it("WebView not mounted with the native reader", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kind = require("./reader-kind") as typeof import("./reader-kind");
    const ch = createReaderChannel();
    kind.__setReaderKindForTests("native");
    try {
      const r = render(<ReaderHost channel={ch} />);
      act(() => ch.post("photo"));
      expect(mockProps.current).toBeNull();
      expect(r.toJSON()).toBeNull();
      act(() => kind.__setReaderKindForTests("webview"));
      expect(mockProps.current).not.toBeNull();
    } finally {
      kind.__setReaderKindForTests(null);
    }
  });
});
