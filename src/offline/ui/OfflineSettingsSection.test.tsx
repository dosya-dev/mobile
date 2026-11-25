import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import { GB } from "@/lib/format";
import { useOfflineStore, OFFLINE_SETTINGS_KEY } from "../offlineStore";
import { OfflineSettingsSection } from "./OfflineSettingsSection";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockKeychain = new Map<string, string>();
jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockKeychain.set(k, v); }),
  deleteItem: jest.fn(async () => {}),
}));
jest.mock("../session", () => ({ currentSession: () => ({ accountId: "acct", generation: 1, root: "file:///docs/offline/acct/" }) }));
jest.mock("../store", () => ({ bytesRetained: jest.fn(async () => 3 * 1_073_741_824) }));
jest.mock("../pins", () => ({ removeAll: jest.fn(async () => {}) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { removeAll } = require("../pins") as { removeAll: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychain.clear();
  useOfflineStore.setState({ allowCellular: false, budgetBytes: null, hydrated: true, pins: [] });
});

describe("Settings > Offline files", () => {
  it("shows the offline size, and opens the Offline screen", async () => {
    render(<OfflineSettingsSection />);
    expect(await screen.findByText("3.0 GB")).toBeTruthy();
    fireEvent.press(screen.getByTestId("settings-offline-size"));
    expect(mockPush).toHaveBeenCalledWith("/offline");
  });

  it("the mobile data toggle is off by default and persists", async () => {
    render(<OfflineSettingsSection />);
    const toggle = screen.getByTestId("settings-offline-cellular");
    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, "valueChange", true);
    expect(useOfflineStore.getState().allowCellular).toBe(true);
    await waitFor(() => expect(JSON.parse(mockKeychain.get(OFFLINE_SETTINGS_KEY)!)).toEqual({ allowCellular: true, budgetBytes: null }));
  });

  it("budget persists: Off by default, then 10 GB", async () => {
    render(<OfflineSettingsSection />);
    expect(screen.getByText("Off")).toBeTruthy();
    fireEvent.press(screen.getByTestId("settings-offline-budget"));
    for (const label of ["5 GB", "10 GB", "25 GB", "50 GB"]) expect(screen.getByText(label)).toBeTruthy();
    fireEvent.press(screen.getByText("10 GB"));
    finishSheetDismissal();
    expect(useOfflineStore.getState().budgetBytes).toBe(10 * GB);
    await waitFor(() => expect(JSON.parse(mockKeychain.get(OFFLINE_SETTINGS_KEY)!)).toEqual({ allowCellular: false, budgetBytes: 10 * GB }));
    expect(screen.getByText("10 GB")).toBeTruthy();
  });

  it("Remove all asks first with the standard confirm, naming what goes", async () => {
    render(<OfflineSettingsSection />);
    await screen.findByText("3.0 GB");
    // The button says to a screen reader what it removes, not just "Remove".
    expect(screen.getByTestId("settings-offline-remove-all").props.accessibilityLabel).toBe("Remove all offline files");
    fireEvent.press(screen.getByTestId("settings-offline-remove-all"));
    expect(screen.getByText("Are you sure?")).toBeTruthy();
    expect(screen.getByText("All offline files (3.0 GB) will be removed from this phone. They stay on dosya.")).toBeTruthy();
    expect(removeAll).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId("confirm")); });
    expect(removeAll).toHaveBeenCalledTimes(1);
  });

  it("cancelling Remove all keeps everything", () => {
    render(<OfflineSettingsSection />);
    fireEvent.press(screen.getByTestId("settings-offline-remove-all"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(removeAll).not.toHaveBeenCalled();
  });
});
