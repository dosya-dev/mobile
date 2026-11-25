jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
const mockListBackupAlbums = jest.fn();
jest.mock("./scanner", () => ({ listBackupAlbums: (...a: unknown[]) => mockListBackupAlbums(...a) }));

import { Platform } from "react-native";
import { ensureAlbumDefaults } from "./albumDefaults";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "./settings";
import { DEFAULT_BACKUP_FILTERS } from "./filters";

const setOS = (os: string) => { (Platform as unknown as { OS: string }).OS = os; };
const originalOS = Platform.OS;

/** A fresh install: filters exist and have been marked migrated by hydrate. */
const freshInstall = () =>
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true } });

beforeEach(() => {
  jest.clearAllMocks();
  mockListBackupAlbums.mockResolvedValue([]);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
});

afterAll(() => setOS(originalOS));

describe("ensureAlbumDefaults", () => {
  it("selects the camera buckets on a fresh Android install", async () => {
    setOS("android");
    freshInstall();
    mockListBackupAlbums.mockResolvedValue([
      { id: "wa", title: "WhatsApp Images", count: 11300 },
      { id: "cam", title: "Camera", count: 6100 },
      { id: "shot", title: "Screenshots", count: 5400 },
    ]);
    await ensureAlbumDefaults();
    const s = useBackupSettings.getState().settings;
    // WhatsApp media and screenshots are the whole reason this exists.
    expect(s.filters.albumMode).toBe("include");
    expect(s.filters.albumIds).toEqual(["cam"]);
    expect(s.albumDefaultsApplied).toBe(true);
  });

  it("matches DCIM as a camera bucket too - OEM naming varies", async () => {
    setOS("android");
    freshInstall();
    mockListBackupAlbums.mockResolvedValue([
      { id: "dcim", title: "DCIM", count: 900 },
      { id: "tg", title: "Telegram", count: 2100 },
    ]);
    await ensureAlbumDefaults();
    expect(useBackupSettings.getState().settings.filters.albumIds).toEqual(["dcim"]);
  });

  it("backs up everything and asks the user when no camera bucket is recognisable", async () => {
    setOS("android");
    freshInstall();
    mockListBackupAlbums.mockResolvedValue([{ id: "x", title: "Weird OEM Name", count: 10 }]);
    await ensureAlbumDefaults();
    const s = useBackupSettings.getState().settings;
    // Failing open, not guessing: a backup app must never silently narrow scope.
    expect(s.filters).toEqual(DEFAULT_BACKUP_FILTERS);
    expect(s.albumDefaultsApplied).toBe(true);
    // ...and the Backup tab prompts them to choose.
    expect(s.filtersMigrated).toBe(false);
  });

  it("is a flag-only no-op on iOS", async () => {
    setOS("ios");
    freshInstall();
    await ensureAlbumDefaults();
    const s = useBackupSettings.getState().settings;
    // iOS albums overlap and an asset can belong to none, so include-mode would
    // silently drop assets that are in no album at all.
    expect(s.filters.albumMode).toBe("all");
    expect(s.albumDefaultsApplied).toBe(true);
    expect(mockListBackupAlbums).not.toHaveBeenCalled();
  });

  it("leaves an upgrading Android install backing up everything", async () => {
    setOS("android");
    // filtersMigrated false = this install predates filters.
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: false } });
    await ensureAlbumDefaults();
    expect(useBackupSettings.getState().settings.filters.albumMode).toBe("all");
    expect(mockListBackupAlbums).not.toHaveBeenCalled();
  });

  it("runs at most once per install", async () => {
    setOS("android");
    useBackupSettings.setState({
      settings: { ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true, albumDefaultsApplied: true },
    });
    await ensureAlbumDefaults();
    expect(mockListBackupAlbums).not.toHaveBeenCalled();
  });
});
