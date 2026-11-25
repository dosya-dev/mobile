jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(() => ({
    data: [
      { id: "w1", name: "Personal" },
      { id: "w2", name: "Team" },
    ],
  })),
}));
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
// The screen declares its native header via Stack.Screen, which needs a navigator; stub it
// as the other screen suites do.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
import BackupSettingsScreen from "./backup-settings";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";
import { finishSheetDismissal } from "@/ui/sheetTesting";

const withFilters = (over: Partial<typeof DEFAULT_BACKUP_FILTERS>) =>
  useBackupSettings.setState({
    settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, ...over } },
  });

beforeEach(() => {
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  mockPush.mockClear();
});
afterEach(() => {
  Platform.OS = "ios";
});

describe("BackupSettingsScreen", () => {
  it("toggles the Wi-Fi-only setting", async () => {
    render(<BackupSettingsScreen />);
    const sw = await screen.findByTestId("backup-wifi-only");
    fireEvent(sw, "valueChange", false);
    await waitFor(() => expect(useBackupSettings.getState().settings.wifiOnly).toBe(false));
  });

  it("toggles automatic backup on", async () => {
    render(<BackupSettingsScreen />);
    const sw = await screen.findByTestId("backup-auto");
    fireEvent(sw, "valueChange", true);
    await waitFor(() => expect(useBackupSettings.getState().settings.autoBackup).toBe(true));
  });

  it("renders all four setting rows", async () => {
    render(<BackupSettingsScreen />);
    expect(await screen.findByTestId("backup-auto")).toBeTruthy();
    expect(screen.getByTestId("backup-wifi-only")).toBeTruthy();
    expect(screen.getByTestId("backup-charging-only")).toBeTruthy();
    expect(screen.getByTestId("backup-delete-after")).toBeTruthy();
  });

  it("offers the background-transport switch on iOS", async () => {
    Platform.OS = "ios";
    render(<BackupSettingsScreen />);
    const sw = await screen.findByTestId("backup-background-transport");
    fireEvent(sw, "valueChange", false);
    await waitFor(() => expect(useBackupSettings.getState().settings.backgroundTransport).toBe(false));
  });

  it("hides the background-transport switch on Android", async () => {
    Platform.OS = "android";
    render(<BackupSettingsScreen />);
    await screen.findByTestId("backup-charging-only");
    expect(screen.queryByTestId("backup-background-transport")).toBeNull();
  });
});

describe("what to back up", () => {
  it("renders a media-type switch per type", async () => {
    render(<BackupSettingsScreen />);
    expect(await screen.findByTestId("filter-photos")).toBeTruthy();
    expect(screen.getByTestId("filter-videos")).toBeTruthy();
  });

  it("turns videos off, leaving photos backed up", async () => {
    render(<BackupSettingsScreen />);
    fireEvent(await screen.findByTestId("filter-videos"), "valueChange", false);
    await waitFor(() =>
      expect(useBackupSettings.getState().settings.filters.mediaTypes).toEqual(["photo"]),
    );
  });

  it("turns videos back on", async () => {
    withFilters({ mediaTypes: ["photo"] });
    render(<BackupSettingsScreen />);
    fireEvent(await screen.findByTestId("filter-videos"), "valueChange", true);
    await waitFor(() =>
      expect(useBackupSettings.getState().settings.filters.mediaTypes).toEqual(["photo", "video"]),
    );
  });

  it("refuses to turn off the last media type", async () => {
    withFilters({ mediaTypes: ["photo"] });
    render(<BackupSettingsScreen />);
    fireEvent(await screen.findByTestId("filter-photos"), "valueChange", false);
    // Turning both off would silently back up nothing at all, with no explanation.
    await waitFor(() =>
      expect(useBackupSettings.getState().settings.filters.mediaTypes).toEqual(["photo"]),
    );
  });

  it("summarises the folder selection and opens the picker", async () => {
    withFilters({ albumMode: "include", albumIds: ["A1", "A2"] });
    render(<BackupSettingsScreen />);
    expect(await screen.findByText("2 folders")).toBeTruthy();
    fireEvent.press(screen.getByTestId("filter-folders"));
    expect(mockPush).toHaveBeenCalledWith("/backup-folders");
  });

  it("says every folder when nothing is narrowed", async () => {
    render(<BackupSettingsScreen />);
    expect(await screen.findByText("Every folder")).toBeTruthy();
  });

  it("sets a size cap from the sheet", async () => {
    render(<BackupSettingsScreen />);
    fireEvent.press(await screen.findByTestId("filter-max-size"));
    fireEvent.press(await screen.findByText("Skip files over 1 GB"));
    finishSheetDismissal();
    await waitFor(() =>
      expect(useBackupSettings.getState().settings.filters.maxBytes).toBe(1024 * 1024 * 1024),
    );
  });

  it("clears the size cap again", async () => {
    withFilters({ maxBytes: 1024 * 1024 * 1024 });
    render(<BackupSettingsScreen />);
    fireEvent.press(await screen.findByTestId("filter-max-size"));
    fireEvent.press(await screen.findByText("No limit"));
    finishSheetDismissal();
    await waitFor(() => expect(useBackupSettings.getState().settings.filters.maxBytes).toBeNull());
  });

  it("sets a date floor of today from the sheet", async () => {
    render(<BackupSettingsScreen />);
    fireEvent.press(await screen.findByTestId("filter-start-from"));
    fireEvent.press(await screen.findByText("Only from today onward"));
    finishSheetDismissal();
    await waitFor(() => {
      const floor = useBackupSettings.getState().settings.filters.dateFloor;
      expect(floor).not.toBeNull();
      expect(floor).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    });
  });
});

describe("backup destinations", () => {
  it("toggles a workspace into the destination set", async () => {
    render(<BackupSettingsScreen />);
    const toggle = await screen.findByTestId("backup-dest-w2");
    fireEvent(toggle, "valueChange", true);
    await waitFor(() => expect(useBackupSettings.getState().settings.destinationIds).toEqual(["w2"]));
    fireEvent(toggle, "valueChange", false);
    await waitFor(() => expect(useBackupSettings.getState().settings.destinationIds).toEqual([]));
  });
});

describe("storage on this device", () => {
  it("opens the free-up-space screen", async () => {
    render(<BackupSettingsScreen />);
    fireEvent.press(await screen.findByTestId("free-up-space"));
    expect(mockPush).toHaveBeenCalledWith("/backup-free-space");
  });
});
