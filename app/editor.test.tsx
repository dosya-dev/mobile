import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditorScreen from "./editor";
import { getEditorConfig } from "@/editor/api";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ fileId: "f1", name: "Budget.docx" }),
}));
jest.mock("@/editor/api", () => ({
  getEditorConfig: jest.fn(),
  editorHtml: jest.fn(() => "<html>editor</html>"),
}));

// Same shape as src/reader/BookReader.test.tsx: capture props, render nothing.
// A mock returning a real RN element gets rewritten by NativeWind's babel plugin
// and jest then rejects it as an out-of-scope reference.
let mockWebviewProps: Record<string, any> = {};
jest.mock("react-native-webview", () => {
  const React = require("react");
  const WebView = React.forwardRef((props: Record<string, unknown>) => {
    mockWebviewProps = props;
    return null;
  });
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});

const mockConfig = getEditorConfig as jest.MockedFunction<typeof getEditorConfig>;

const CONFIG = {
  documentServerUrl: "https://docs.dosya.dev",
  config: {
    document: { title: "Budget.docx", url: "u", fileType: "docx", key: "k" },
    documentType: "word",
    editorConfig: { mode: "edit" as const, callbackUrl: "cb" },
    token: "signed.jwt",
  },
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditorScreen />
    </QueryClientProvider>,
  );
}

// Wrapped in act: the page posts these from outside React's knowledge, so
// without it the state update is scheduled but never flushed for the assertion.
const send = (payload: unknown) =>
  act(() => {
    mockWebviewProps.onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockWebviewProps = {};
  mockConfig.mockResolvedValue(CONFIG as never);
});

describe("editor screen", () => {
  it("hands the page the document server as its base", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    expect(mockWebviewProps.source.baseUrl).toBe("https://docs.dosya.dev");
  });

  it("shows a loading state until the editor says it is ready", async () => {
    renderScreen();
    // Loading covers two waits, not one: the config fetch, and then the editor
    // booting inside the WebView. The page only exists after the first, so the
    // ready message cannot be delivered until then.
    expect(screen.getByTestId("editor-loading")).toBeTruthy();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    expect(screen.getByTestId("editor-loading")).toBeTruthy();

    send({ type: "ready" });
    await waitFor(() => expect(screen.queryByTestId("editor-loading")).toBeNull());
  });

  it("surfaces an editor-side failure instead of a blank screen", async () => {
    // The page posts this when api.js cannot be reached at all - the case where
    // the document server is down and nothing would otherwise ever render.
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "error", message: "Document server unreachable" });
    await waitFor(() => expect(screen.getByTestId("editor-error")).toBeTruthy());
    expect(screen.getByText("Document server unreachable")).toBeTruthy();
  });

  it("surfaces a config failure with a way to retry", async () => {
    mockConfig.mockRejectedValue(new Error("This file type cannot be opened in the editor"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("editor-error")).toBeTruthy());
    expect(screen.getByTestId("editor-retry")).toBeTruthy();
  });

  it("recovers on retry", async () => {
    mockConfig.mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("editor-retry")).toBeTruthy());
    fireEvent.press(screen.getByTestId("editor-retry"));
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
  });

  it("ignores a message that is not JSON", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    mockWebviewProps.onMessage?.({ nativeEvent: { data: "not json" } });
    expect(screen.queryByTestId("editor-error")).toBeNull();
  });
});
