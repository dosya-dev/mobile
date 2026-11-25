// This member's Personas settings on this phone: on/off for the workspace
// (off asks "Are you sure?" and deletes from all their devices), read on this
// device, when Personas reads (open / charging / any time) and mobile data,
// what stops background reading, skipped folders, the privacy link.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { toast } from "@/ui/toast";
import { dragSheetHandle } from "@/ui/sheetTesting";
import { fakeHost, READY } from "./device/__fixtures__/fake-host";
import { readSettings, resetReadSettings, setReadMode } from "./device/settings";
import { lastBackgroundSummary } from "./device/health";
import * as bgNative from "../../modules/dosya-personas-background";
import { PersonasSettings } from "./PersonasSettings";

jest.mock("../../modules/dosya-personas-background");
jest.mock("./device/health", () => ({ lastBackgroundSummary: jest.fn(async () => null) }));
const native = bgNative as jest.Mocked<typeof bgNative>;
const summary = lastBackgroundSummary as jest.Mock;
const os = Platform.OS;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockClearKey = jest.fn(async (_u: string | null) => {});
jest.mock("./device/wipe", () => ({ clearKeyIfLastWorkspace: (u: string | null) => mockClearKey(u) }));
jest.mock("./device/engine-host", () => require("./device/__fixtures__/fake-host"));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), deleteItem: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("@/ai-search/api", () => ({
  ...jest.requireActual("@/ai-search/api"),
  fetchFolderTree: jest.fn(async () => [
    { id: "f1", name: "Receipts", parent_id: null },
    { id: "f2", name: "Kids", parent_id: null },
  ]),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><PersonasSettings wsId="w1" /></QueryClientProvider>);
}

beforeEach(async () => {
  fakeHost.reset({ ...READY, read: 3, total: 10 });
  mockPush.mockClear();
  mockClearKey.mockClear();
  (toast as jest.Mock).mockClear();
  (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
  await resetReadSettings();
  native.backgroundBlocks.mockReset().mockResolvedValue([]);
  native.supportsContinued.mockReset().mockReturnValue(false);
  native.openAppSettings.mockClear();
  native.requestNotificationPermission.mockReset().mockResolvedValue(true);
  summary.mockReset().mockResolvedValue(null);
});
afterEach(async () => {
  await act(async () => {});
  Platform.OS = os;
});

it("describes Personas and links how it protects privacy; no region, owner, plan or consent", async () => {
  mount();
  expect(screen.getByText("Groups the photos in this workspace by the people in them, so you can name them and search by name.")).toBeTruthy();
  fireEvent.press(screen.getByText("How Personas protects your privacy"));
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://dosya.dev/biometric-data-policy");
  for (const gone of [/region/i, /owner/i, /plan/i, /agree/i]) expect(screen.queryByText(gone)).toBeNull();
});

it("shows the switches, the read choice and the skipped folders while on", async () => {
  mount();
  await act(async () => {});
  expect(screen.getByTestId("personas-switch").props.value).toBe(true);
  expect(screen.getByText("Personas in this workspace")).toBeTruthy();
  expect(screen.getByTestId("personas-read-here").props.value).toBe(true);
  expect(screen.getByText("When Personas reads")).toBeTruthy();
  expect(screen.getByText("Only while dosya is open")).toBeTruthy();
  expect(screen.getByText("While charging")).toBeTruthy();
  expect(screen.getByText("Any time")).toBeTruthy();
  expect(screen.getByTestId("personas-read-mode-charging").props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId("personas-read-mode-anytime").props.accessibilityState).toEqual({ checked: false });
  expect(screen.getByTestId("personas-read-mode-open").props.accessibilityRole).toBe("radio");
  expect(screen.getByTestId("personas-read-modes").props.accessibilityRole).toBe("radiogroup");
  expect(screen.getByText("Use mobile data")).toBeTruthy();
  expect(screen.getByText("Off: photos are read only on Wi-Fi.")).toBeTruthy();
  expect(screen.getByTestId("personas-mobile-data").props.value).toBe(false);
  expect(screen.queryByText("Read on mobile data or battery")).toBeNull();
  expect(screen.getByText("Skipped folders")).toBeTruthy();
  expect(screen.getByText("Delete my people in this workspace")).toBeTruthy();
});

it("Read on this device pauses and resumes reading here", () => {
  mount();
  fireEvent(screen.getByTestId("personas-read-here"), "valueChange", false);
  expect(fakeHost.engine.setPaused).toHaveBeenCalledWith(true);
  expect(screen.getByTestId("personas-read-here").props.value).toBe(false);
  fireEvent(screen.getByTestId("personas-read-here"), "valueChange", true);
  expect(fakeHost.engine.setPaused).toHaveBeenLastCalledWith(false);
});

it("choosing a row sets the read mode on this phone and moves the check", async () => {
  mount();
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  expect(readSettings().mode).toBe("anytime");
  expect(screen.getByTestId("personas-read-mode-anytime").props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId("personas-read-mode-charging").props.accessibilityState).toEqual({ checked: false });
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  expect(readSettings().mode).toBe("open");
  await act(async () => {});
});

it("the Use mobile data switch sets mobile data on this phone", async () => {
  mount();
  fireEvent(screen.getByTestId("personas-mobile-data"), "valueChange", true);
  expect(readSettings()).toEqual({ mode: "charging", mobileData: true });
  expect(screen.getByTestId("personas-mobile-data").props.value).toBe(true);
  await act(async () => {});
});

it("the iPhone helper shows only on iOS, and only for a background mode", async () => {
  Platform.OS = "ios";
  const { unmount } = mount();
  await act(async () => {});
  expect(screen.getByText("iPhone decides when dosya can read in the background, usually overnight on the charger.")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  await act(async () => {});
  expect(screen.queryByText("iPhone decides when dosya can read in the background, usually overnight on the charger.")).toBeNull();
  unmount();
  Platform.OS = "android";
  setReadMode("charging");
  mount();
  await act(async () => {});
  expect(screen.queryByText("iPhone decides when dosya can read in the background, usually overnight on the charger.")).toBeNull();
});

it("the Keep reading helper shows under Any time only where the continued task is supported", async () => {
  Platform.OS = "ios";
  const line = "To keep reading after you leave dosya, tap Keep reading in background on the People screen.";
  native.supportsContinued.mockReturnValue(true);
  mount();
  await act(async () => {});
  expect(screen.queryByText(line)).toBeNull();
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  await act(async () => {});
  expect(screen.getByText(line)).toBeTruthy();
  native.supportsContinued.mockReturnValue(false);
  fireEvent.press(screen.getByTestId("personas-read-mode-charging"));
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  await act(async () => {});
  expect(screen.queryByText(line)).toBeNull();
});

it("refreshOff warning shows with Open Settings", async () => {
  Platform.OS = "ios";
  native.backgroundBlocks.mockResolvedValue(["refreshOff"]);
  mount();
  expect(await screen.findByText("Background App Refresh is off for dosya, so iPhone will not let it read in the background.")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-open-settings-refreshOff"));
  expect(native.openAppSettings).toHaveBeenCalledWith("refreshOff");
  // Only while a background mode is chosen.
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  await act(async () => {});
  expect(screen.queryByText("Background App Refresh is off for dosya, so iPhone will not let it read in the background.")).toBeNull();
});

it("Android blocks: notifications off and battery optimisation, each with Open Settings", async () => {
  Platform.OS = "android";
  native.backgroundBlocks.mockResolvedValue(["notificationsOff", "batteryOptimized"]);
  mount();
  expect(await screen.findByText("Notifications are off for dosya. Android needs one to read in the background.")).toBeTruthy();
  expect(screen.getByText("Some phones stop apps in the background to save battery. If reading stops, allow dosya to run in the background.")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-open-settings-batteryOptimized"));
  expect(native.openAppSettings).toHaveBeenCalledWith("batteryOptimized");
  fireEvent.press(screen.getByTestId("personas-open-settings-notificationsOff"));
  expect(native.openAppSettings).toHaveBeenCalledWith("notificationsOff");
});

it("choosing Any time on Android asks for notifications once", async () => {
  Platform.OS = "android";
  mount();
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  await waitFor(() => expect(native.requestNotificationPermission).toHaveBeenCalledTimes(1));
  // The answer is reflected: the blocks are read again.
  await waitFor(() => expect(native.backgroundBlocks.mock.calls.length).toBeGreaterThanOrEqual(2));
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  fireEvent.press(screen.getByTestId("personas-read-mode-charging"));
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  await act(async () => {});
  expect(native.requestNotificationPermission).toHaveBeenCalledTimes(1);
});

it("choosing a mode on iOS, or Only while open on Android, never asks for notifications", async () => {
  Platform.OS = "ios";
  const { unmount } = mount();
  fireEvent.press(screen.getByTestId("personas-read-mode-anytime"));
  await act(async () => {});
  unmount();
  Platform.OS = "android";
  mount();
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  await act(async () => {});
  expect(native.requestNotificationPermission).not.toHaveBeenCalled();
});

it("summary line shows the last background window", async () => {
  summary.mockResolvedValue({ at: Date.now() - 2 * 3600_000 - 60_000, photos: 312 });
  mount();
  expect(await screen.findByText("Last background read: 2 hours ago, 312 photos")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-read-mode-open"));
  await act(async () => {});
  expect(screen.queryByText(/Last background read/)).toBeNull();
});

it("no summary line before any background window", async () => {
  mount();
  await act(async () => {});
  expect(summary).toHaveBeenCalled();
  expect(screen.queryByText(/Last background read/)).toBeNull();
});

it("switching off asks Are you sure? and then turns it off; the delete button asks the same", async () => {
  mount();
  fireEvent(screen.getByTestId("personas-switch"), "valueChange", false);
  expect(screen.getByText("Are you sure?")).toBeTruthy();
  expect(screen.getAllByText("Your people, names and corrections for this workspace are deleted from all your devices.").length).toBeGreaterThan(0);
  fireEvent.press(screen.getByTestId("personas-off-cancel"));
  expect(fakeHost.engine.turnOff).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("personas-delete"));
  fireEvent.press(screen.getByTestId("personas-off-confirm"));
  await waitFor(() => expect(fakeHost.engine.turnOff).toHaveBeenCalledTimes(1));
  // The device's cached key goes too when this was its last workspace (the helper decides).
  await waitFor(() => expect(mockClearKey).toHaveBeenCalledTimes(1));
  expect(await screen.findByTestId("personas-switch")).toBeTruthy();
  expect(screen.getByTestId("personas-switch").props.value).toBe(false);
  expect(screen.queryByTestId("personas-read-here")).toBeNull();
});

it("a failed turn-off keeps the dialog open and says try again", async () => {
  fakeHost.engine.turnOff.mockRejectedValueOnce(new Error("offline"));
  mount();
  fireEvent.press(screen.getByTestId("personas-delete"));
  fireEvent.press(screen.getByTestId("personas-off-confirm"));
  expect(await screen.findByTestId("personas-off-error")).toHaveTextContent("Something went wrong. Try again.");
  expect(screen.getByTestId("personas-off-dialog")).toBeTruthy();
  expect(mockClearKey).not.toHaveBeenCalled();
});

it("switching on while off turns it on", async () => {
  fakeHost.set({ status: { state: "off" } });
  mount();
  expect(screen.getByTestId("personas-switch").props.value).toBe(false);
  fireEvent(screen.getByTestId("personas-switch"), "valueChange", true);
  await waitFor(() => expect(fakeHost.engine.turnOn).toHaveBeenCalledTimes(1));
});

it("names skipped folders, adds one from the picker and stops skipping one", async () => {
  fakeHost.engine.skipped = ["f1"];
  mount();
  expect(await screen.findByText("Receipts")).toBeTruthy();
  fireEvent.press(screen.getByTestId("personas-add-folder"));
  fireEvent.press(await screen.findByTestId("personas-pick-f2"));
  await waitFor(() => expect(fakeHost.engine.skipFolder).toHaveBeenCalledWith("f2", true));
  expect(await screen.findByText("Kids")).toBeTruthy();
  expect(screen.getByTestId("personas-remove-f1").props.accessibilityLabel).toBe("Stop skipping Receipts");
  fireEvent.press(screen.getByTestId("personas-remove-f1"));
  await waitFor(() => expect(fakeHost.engine.skipFolder).toHaveBeenCalledWith("f1", false));
});

it("the folder picker closes on a swipe down and picks nothing", async () => {
  mount();
  fireEvent.press(screen.getByTestId("personas-add-folder"));
  const handle = await screen.findByTestId("personas-folder-picker-handle");
  expect(dragSheetHandle(handle, 0, 80)).toBe(true);
  await waitFor(() => expect(screen.queryByTestId("personas-folder-picker")).toBeNull());
  expect(fakeHost.engine.skipFolder).not.toHaveBeenCalled();
});

it("locked or without a Vault: the Vault line and Open Personas", () => {
  fakeHost.set({ status: { state: "needs_unlock" } });
  const { unmount } = mount();
  expect(screen.getByText("Unlock with your Vault passphrase to open your people on this device.")).toBeTruthy();
  fireEvent.press(screen.getByText("Open Personas"));
  expect(mockPush).toHaveBeenCalledWith("/personas");
  expect(screen.queryByTestId("personas-switch")).toBeNull();
  unmount();
  fakeHost.set({ status: { state: "needs_identity" } });
  mount();
  expect(screen.getByText("Personas uses your Vault passphrase to protect your people. Set it up to continue.")).toBeTruthy();
});

it("says when Personas could not be loaded and tries again", () => {
  fakeHost.set({ status: null, error: new Error("offline") });
  mount();
  expect(screen.getByText("Personas could not be loaded.")).toBeTruthy();
  fireEvent.press(screen.getByText("Try again"));
  expect(fakeHost.refresh).toHaveBeenCalled();
});
