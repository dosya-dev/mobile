const mockListBackupAlbums = jest.fn();
const mockEnsureAlbumDefaults = jest.fn(async (..._a: unknown[]) => {});
jest.mock("@/backup/scanner", () => ({ listBackupAlbums: (...a: unknown[]) => mockListBackupAlbums(...a) }));
jest.mock("@/backup/albumDefaults", () => ({ ensureAlbumDefaults: (...a: unknown[]) => mockEnsureAlbumDefaults(...a) }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import BackupFolders from "./backup-folders";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";

const ALBUMS = [
  { id: "wa", title: "WhatsApp Images", count: 11300 },
  { id: "cam", title: "Camera", count: 6100 },
  { id: "shot", title: "Screenshots", count: 5400 },
];

const withFilters = (over: Partial<typeof DEFAULT_BACKUP_FILTERS>) =>
  useBackupSettings.setState({
    settings: { ...DEFAULT_BACKUP_SETTINGS, filters: { ...DEFAULT_BACKUP_FILTERS, ...over } },
  });

const filters = () => useBackupSettings.getState().settings.filters;

beforeEach(() => {
  jest.clearAllMocks();
  mockListBackupAlbums.mockResolvedValue(ALBUMS);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
});

describe("BackupFolders", () => {
  it("lists every folder with its item count", async () => {
    render(<BackupFolders />);
    expect(await screen.findByText("WhatsApp Images")).toBeTruthy();
    expect(screen.getByText("11,300 items")).toBeTruthy();
    expect(screen.getByText("Camera")).toBeTruthy();
  });

  it("shows every folder as on when nothing is narrowed", async () => {
    render(<BackupFolders />);
    expect((await screen.findByTestId("album-cam")).props.value).toBe(true);
    expect(screen.getByTestId("album-wa").props.value).toBe(true);
  });

  it("reflects an existing include selection", async () => {
    withFilters({ albumMode: "include", albumIds: ["cam"] });
    render(<BackupFolders />);
    expect((await screen.findByTestId("album-cam")).props.value).toBe(true);
    expect(screen.getByTestId("album-wa").props.value).toBe(false);
    expect(screen.getByTestId("album-shot").props.value).toBe(false);
  });

  it("switching one folder off from 'all' keeps the rest selected", async () => {
    render(<BackupFolders />);
    fireEvent((await screen.findByTestId("album-wa")), "valueChange", false);
    await waitFor(() => expect(filters().albumMode).toBe("include"));
    // Turning one off must not turn everything else off with it.
    expect(filters().albumIds.sort()).toEqual(["cam", "shot"]);
  });

  it("selecting every folder collapses back to 'all'", async () => {
    withFilters({ albumMode: "include", albumIds: ["cam", "shot"] });
    render(<BackupFolders />);
    fireEvent((await screen.findByTestId("album-wa")), "valueChange", true);
    // "all" also picks up albums created after this screen was last opened,
    // which an exhaustive id list would silently miss.
    await waitFor(() => expect(filters().albumMode).toBe("all"));
    expect(filters().albumIds).toEqual([]);
  });

  it("shows a running total of selected items", async () => {
    withFilters({ albumMode: "include", albumIds: ["cam"] });
    render(<BackupFolders />);
    expect(await screen.findByText("6,100 of 22,800 items selected")).toBeTruthy();
  });

  it("warns when the user has deselected everything", async () => {
    withFilters({ albumMode: "include", albumIds: [] });
    render(<BackupFolders />);
    expect(await screen.findByTestId("no-folders-warning")).toBeTruthy();
  });

  it("resolves platform defaults before showing the list", async () => {
    render(<BackupFolders />);
    await waitFor(() => expect(mockEnsureAlbumDefaults).toHaveBeenCalled());
  });

  it("marks the install migrated once the user has seen the picker", async () => {
    render(<BackupFolders />);
    await screen.findByText("Camera");
    // The one-time card on the Backup tab has served its purpose now.
    await waitFor(() => expect(useBackupSettings.getState().settings.filtersMigrated).toBe(true));
  });

  it("says so when the library has no folders to show", async () => {
    mockListBackupAlbums.mockResolvedValue([]);
    render(<BackupFolders />);
    expect(await screen.findByTestId("no-albums")).toBeTruthy();
  });
});
