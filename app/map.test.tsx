import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MapScreen from "./map";
import { getMapPins, hasBasemap } from "@/map/api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/map/api", () => ({ getMapPins: jest.fn(), hasBasemap: jest.fn() }));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));
// The generated bundle is ~1MB of maplibre; the screen only needs a string.
jest.mock("@/map/mapHtml.generated", () => ({ MAP_HTML: "<html></html>" }));

// Same shape as src/reader/BookReader.test.tsx: capture the props and render
// nothing. A mock that returns a real RN element gets rewritten by NativeWind's
// babel plugin, which jest then rejects as an out-of-scope reference.
let mockWebviewProps: Record<string, any> = {};
const mockInjected: string[] = [];
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

const mockPins = getMapPins as jest.MockedFunction<typeof getMapPins>;
const mockBasemap = hasBasemap as jest.MockedFunction<typeof hasBasemap>;

const pin = (id: string, lat = 1, lon = 2) => ({
  kind: "file" as const, id, name: `${id}.jpg`, latitude: lat, longitude: lon, source: "exif" as const,
});
const folderPin = (id: string) => ({
  kind: "folder" as const, id, name: id, latitude: 5, longitude: 6, source: "ip" as const,
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MapScreen />
    </QueryClientProvider>,
  );
}

const send = (payload: unknown) =>
  mockWebviewProps.onMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });

const injected = (needle: string) => mockInjected.find((js) => js.includes(needle));

beforeEach(() => {
  jest.clearAllMocks();
  mockInjected.length = 0;
  mockWebviewProps = {};
  mockPins.mockResolvedValue({ pins: [pin("f1"), pin("f2", 3, 4)], counts: { gps: 2, approximate: 0, pending: 0 } });
  mockBasemap.mockResolvedValue(true);
});

describe("map screen", () => {
  it("hands the page a self-contained document", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
  });

  it("counts what it located", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("map-count")).toBeTruthy());
    expect(screen.getByText("2 located")).toBeTruthy();
  });

  it("says there is nothing geotagged rather than showing a blank world", async () => {
    mockPins.mockResolvedValue({ pins: [], counts: { gps: 0, approximate: 0, pending: 0 } });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("map-empty")).toBeTruthy());
  });

  it("distinguishes a failed load from having no photos", async () => {
    mockPins.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("map-error")).toBeTruthy());
    expect(screen.queryByTestId("map-empty")).toBeNull();
    expect(screen.getByTestId("map-retry")).toBeTruthy();
  });

  it("tells the page which basemap to use once it loads", async () => {
    renderScreen();
    await waitFor(() => expect(mockBasemap).toHaveBeenCalled());
    mockWebviewProps.onLoadEnd?.();
    await waitFor(() => {
      expect(injected("initMap")).toContain('"hasBasemap":true');
    });
  });

  it("still draws when the basemap is missing, rather than refusing to load", async () => {
    // A workspace whose basemap was never provisioned still has photos to place.
    mockBasemap.mockResolvedValue(false);
    renderScreen();
    await waitFor(() => expect(mockBasemap).toHaveBeenCalled());
    mockWebviewProps.onLoadEnd?.();
    await waitFor(() => {
      expect(injected("initMap")).toContain('"hasBasemap":false');
    });
  });

  it("hands the pins over only after the page says it is ready", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    mockWebviewProps.onLoadEnd?.();
    // Nothing may be drawn before the handshake: injecting into a page that has
    // not defined setPins yet is a silent no-op that loses the pins.
    expect(injected("setPins")).toBeUndefined();

    send({ type: "ready" });
    await waitFor(() => {
      const call = injected("setPins");
      expect(call).toContain("f1");
      expect(call).toContain("f2");
    });
  });

  it("hands over coordinates, not file rows", async () => {
    // What crosses into the WebView is source text the page has to compile, so
    // it carries the four fields a dot is drawn from and nothing else. A pin
    // list that starts smuggling file metadata across again is the regression
    // that made this screen slow.
    mockPins.mockResolvedValue({
      pins: [{ ...pin("f1"), name: "holiday-beach-photo.jpg" } as never],
      counts: { gps: 1, approximate: 0, pending: 0 },
    });
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "ready" });

    await waitFor(() => expect(injected("setPins")).toBeTruthy());
    const call = injected("setPins")!;
    expect(call).toContain("f1");
    expect(call).not.toContain("holiday-beach-photo");
    // JSON.parse, not a JavaScript object literal: at library scale the
    // difference is the whole cost of handing the pins over.
    expect(call).toContain("JSON.parse");
  });

  it("opens the file the page reports a tap on", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "ready" });
    send({ type: "open", id: "f1" });
    expect(mockPush).toHaveBeenCalledWith("/file/f1");
  });

  it("opens a folder pin as a folder, not as a file with no bytes", async () => {
    mockPins.mockResolvedValue({ pins: [folderPin("d1")], counts: { gps: 0, approximate: 1, pending: 0 } });
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "ready" });
    send({ type: "open", id: "d1", kind: "folder" });
    expect(mockPush).toHaveBeenCalledWith("/folder/d1");
  });

  it("ignores a message that is not JSON instead of crashing", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    mockWebviewProps.onMessage?.({ nativeEvent: { data: "not json" } });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("ignores an open message with no id", async () => {
    renderScreen();
    await waitFor(() => expect(mockWebviewProps.source?.html).toBeTruthy());
    send({ type: "open" });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("retries a failed load", async () => {
    mockPins.mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("map-retry")).toBeTruthy());
    mockPins.mockResolvedValue({ pins: [pin("f9")], counts: { gps: 1, approximate: 0, pending: 0 } });
    fireEvent.press(screen.getByTestId("map-retry"));
    await waitFor(() => expect(screen.getByTestId("map-count")).toBeTruthy());
  });
});
