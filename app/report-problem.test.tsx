import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import ReportProblemScreen from "./report-problem";

// jest-expo's test environment (jest-environment-node, see
// node_modules/react-native/jest/react-native-env.js) never runs React
// Native's native-runtime polyfills, so the ambient `FormData` here is
// Node's own WHATWG implementation: appending a non-Blob file part silently
// stringifies it to "[object Object]" instead of keeping the { uri, name,
// type } shape src/support/api.ts relies on, and it has no `_parts`. The
// device always runs RN's own FormData (installed by InitializeCore), so
// installing the real class here - before any test constructs one - matches
// production rather than relying on a Node-only polyfill. (Scoped to this
// file's own jest sandbox; no shared jest config changes. require(), not an
// import, because react-native/Libraries/Network/FormData.js ships no type
// declarations - see app/_layout.test.tsx for the same require()+cast
// pattern elsewhere in this suite.)
const RNFormData = (require("react-native/Libraries/Network/FormData") as { default: typeof FormData }).default;
(global as unknown as { FormData: typeof FormData }).FormData = RNFormData;

// jest-hoist only allows out-of-scope identifiers prefixed "mock" inside a
// jest.mock() factory (see app/backup-failed.test.tsx's mockBack for the
// same pattern), so every captured fn below carries that prefix.
const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
const mockApiRequest = jest.fn();
jest.mock("@/api", () => ({ apiRequest: (...a: unknown[]) => mockApiRequest(...a), ApiError: class extends Error {} }));
jest.mock("@/lib/appVersion", () => ({ getDisplayVersion: () => "1.0.2 (37)" }));
jest.mock("@/backup/ledger", () => ({ countByStatus: jest.fn(async () => ({ pending: 0, queued: 0, uploaded: 10, skipped_large: 1, error: 3 })) }));
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: (sel: (s: { activeId: string | null }) => unknown) => sel({ activeId: "ws_1" }) }));
jest.mock("expo-device", () => ({ osName: "iOS", osVersion: "26.0", modelName: "iPhone 15" }));
jest.mock("expo-application", () => ({ nativeBuildVersion: "37", nativeApplicationVersion: "1.0.2" }));
type PickedAsset = { uri: string; fileName: string | null; mimeType: string | null };
const mockPicker = {
  requestMediaLibraryPermissionsAsync: jest.fn((..._a: unknown[]) => Promise.resolve({ granted: true })),
  launchImageLibraryAsync: jest.fn((..._a: unknown[]) => Promise.resolve({ canceled: true, assets: [] as PickedAsset[] })),
};
// Indirection, not a direct `() => mockPicker`: the screen's import of
// "expo-image-picker" is evaluated while requiring ./report-problem above
// (line 2), which runs before this `const` is assigned, so a factory that
// returns mockPicker itself would freeze in an unset snapshot. Routing calls
// through these wrapper functions defers the mockPicker read to call time,
// after it is assigned - the same indirection useRouter() and toast() below
// already rely on.
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockPicker.requestMediaLibraryPermissionsAsync(...a),
  launchImageLibraryAsync: (...a: unknown[]) => mockPicker.launchImageLibraryAsync(...a),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: "automatic", Compatible: "compatible", Current: "current" },
}));
const mockGetInfoAsync = jest.fn(async (..._a: unknown[]) => ({ exists: true, size: 1000 }));
jest.mock("expo-file-system/legacy", () => ({ getInfoAsync: (...a: unknown[]) => mockGetInfoAsync(...a) }));
const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

beforeEach(() => {
  mockParams = {};
  mockBack.mockClear(); mockToast.mockClear();
  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({ ok: true, ticket: { id: "t_1" } });
  mockPicker.launchImageLibraryAsync.mockReset();
  mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  mockGetInfoAsync.mockReset();
  mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1000 });
});

const sentForm = () => (mockApiRequest.mock.calls[0][1] as { body: FormData }).body;
const formGet = (fd: FormData, key: string) => (fd as unknown as { _parts: [string, unknown][] })._parts.filter(([k]) => k === key).map(([, v]) => v);

it("shows the device rows and the error reference from params, never the vendor", async () => {
  mockParams = { errorRef: "evt_1", errorMessage: "boom", from: "/files" };
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  expect(screen.getByText("1.0.2 (37)")).toBeTruthy();
  expect(screen.getByText("iOS 26.0")).toBeTruthy();
  expect(screen.getByText("Error reference")).toBeTruthy();
  expect(screen.getByText("evt_1")).toBeTruthy();
  expect(screen.queryByText(/sentry/i)).toBeNull();
});

it("sends a bug ticket with the text, workspace and diagnostics, then goes back", async () => {
  mockParams = { from: "/backup-failed" };
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.changeText(screen.getByTestId("report-text"), "Backup says Preparing for an hour");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  const [path, opts] = mockApiRequest.mock.calls[0] as [string, { method: string; body: FormData }];
  expect(path).toBe("/api/support/tickets");
  expect(opts.method).toBe("POST");
  const fd = opts.body;
  expect(formGet(fd, "category")).toEqual(["bug"]);
  expect(formGet(fd, "subject")).toEqual([""]);
  expect(formGet(fd, "body")).toEqual(["Backup says Preparing for an hour"]);
  expect(formGet(fd, "workspace_id")).toEqual(["ws_1"]);
  const d = JSON.parse(formGet(fd, "diagnostics")[0] as string) as { client: string; page: string; extra: Record<string, string> };
  expect(d.client).toBe("mobile");
  expect(d.page).toBe("/backup-failed");
  expect(d.extra.Backup).toBe("3 failed · 1 skipped");
  expect(formGet(fd, "images")).toEqual([]);
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Report sent"));
});

it("sends no diagnostics when Include is unticked", async () => {
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.changeText(screen.getByTestId("report-text"), "x");
  fireEvent.press(screen.getByTestId("include-diagnostics"));
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  expect(formGet(sentForm(), "diagnostics")).toEqual([]);
});

it("names the diagnostics checkbox for screen readers", async () => {
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  expect(screen.getByLabelText("Include diagnostics")).toBeTruthy();
});

it("attaches picked screenshots as RN file parts, naming the one with no file name from its type", async () => {
  mockPicker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///tmp/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg" }, { uri: "file:///tmp/b.png", fileName: null, mimeType: null }],
  });
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.press(screen.getByTestId("report-add-screenshot"));
  await waitFor(() => expect(screen.getByText("screenshot-2.png")).toBeTruthy());
  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({ preferredAssetRepresentationMode: "compatible" }),
  );
  fireEvent.changeText(screen.getByTestId("report-text"), "x");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  const images = formGet(sentForm(), "images") as { uri: string; name: string; type: string }[];
  expect(images).toEqual([
    { uri: "file:///tmp/a.jpg", name: "a.jpg", type: "image/jpeg" },
    { uri: "file:///tmp/b.png", name: "screenshot-2.png", type: "image/png" },
  ]);
});

it("skips an unsupported image type with a toast and still sends the rest", async () => {
  mockPicker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [
      { uri: "file:///tmp/a.heic", fileName: "a.heic", mimeType: "image/heic" },
      { uri: "file:///tmp/b.jpg", fileName: "b.jpg", mimeType: "image/jpeg" },
    ],
  });
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.press(screen.getByTestId("report-add-screenshot"));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("not supported"), "error"));
  fireEvent.changeText(screen.getByTestId("report-text"), "x");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  const images = formGet(sentForm(), "images") as { uri: string; name: string; type: string }[];
  expect(images).toEqual([{ uri: "file:///tmp/b.jpg", name: "b.jpg", type: "image/jpeg" }]);
});

it("skips an image over 5 MB with a toast", async () => {
  mockPicker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///tmp/big.png", fileName: "big.png", mimeType: "image/png" }],
  });
  mockGetInfoAsync.mockResolvedValueOnce({ exists: true, size: 6_000_000 });
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.press(screen.getByTestId("report-add-screenshot"));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("5 MB"), "error"));
  fireEvent.changeText(screen.getByTestId("report-text"), "x");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  expect(formGet(sentForm(), "images")).toEqual([]);
});

it("removes an attached image when its Remove button is pressed", async () => {
  mockPicker.launchImageLibraryAsync.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///tmp/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg" }, { uri: "file:///tmp/b.jpg", fileName: "b.jpg", mimeType: "image/jpeg" }],
  });
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.press(screen.getByTestId("report-add-screenshot"));
  await waitFor(() => expect(screen.getByText("a.jpg")).toBeTruthy());
  fireEvent.press(screen.getByTestId("remove-image-0"));
  expect(screen.queryByText("a.jpg")).toBeNull();
  fireEvent.changeText(screen.getByTestId("report-text"), "x");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(1));
  const images = formGet(sentForm(), "images") as { uri: string; name: string; type: string }[];
  expect(images).toEqual([{ uri: "file:///tmp/b.jpg", name: "b.jpg", type: "image/jpeg" }]);
});

it("keeps the text and the screen when the request fails", async () => {
  mockApiRequest.mockRejectedValueOnce(new Error("Request failed (500)"));
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  fireEvent.changeText(screen.getByTestId("report-text"), "keep me");
  fireEvent.press(screen.getByTestId("report-send"));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Could not send"), "error"));
  expect(screen.getByTestId("report-text").props.value).toBe("keep me");
  expect(mockBack).not.toHaveBeenCalled();
});

it("disables Send while the text is empty", async () => {
  render(<ReportProblemScreen />);
  await waitFor(() => expect(screen.getByText("3 failed · 1 skipped")).toBeTruthy());
  expect(screen.getByTestId("report-send").props.accessibilityState?.disabled ?? screen.getByTestId("report-send").props.disabled).toBeTruthy();
});
