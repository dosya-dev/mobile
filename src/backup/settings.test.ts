const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));

jest.mock("./ledger", () => ({
  distinctWorkspaceIds: jest.fn(async () => ["wA", "wB"]),
  deletePending: jest.fn(async () => 0),
}));
jest.mock("./watermark", () => ({ clearWatermarks: jest.fn(async () => {}) }));

import { useBackupSettings, DEFAULT_BACKUP_SETTINGS, getLastRunAt, setLastRunAt, __resetBackupSettingsHydration } from "./settings";
import { distinctWorkspaceIds, deletePending } from "./ledger";
import { clearWatermarks } from "./watermark";
import { DEFAULT_BACKUP_FILTERS } from "./filters";

beforeEach(() => {
  jest.clearAllMocks();
  (distinctWorkspaceIds as jest.Mock).mockResolvedValue(["wA", "wB"]);
  mockMem.clear();
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
  // hydrate() only reads once per process; each spec is a new "process".
  __resetBackupSettingsHydration();
});

describe("backup settings store", () => {
  it("defaults to safe values (auto off, wifi-only on, delete off)", () => {
    expect(useBackupSettings.getState().settings).toEqual({
      autoBackup: false, wifiOnly: true, chargingOnly: false, deleteAfterBackup: false, minBatteryPercent: 20, destinationIds: [],
      // The everything shape: an upgrading install must behave exactly as it did
      // before filters existed, until the user changes something.
      filters: DEFAULT_BACKUP_FILTERS, filtersMigrated: false, albumDefaultsApplied: false,
      backgroundTransport: true,
    });
  });

  it("update() merges + persists a patch", async () => {
    await useBackupSettings.getState().update({ autoBackup: true, wifiOnly: false });
    expect(useBackupSettings.getState().settings.autoBackup).toBe(true);
    expect(useBackupSettings.getState().settings.wifiOnly).toBe(false);
    // Re-hydrate a fresh store from persisted storage.
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
    __resetBackupSettingsHydration();
    await useBackupSettings.getState().hydrate();
    expect(useBackupSettings.getState().settings.autoBackup).toBe(true);
    expect(useBackupSettings.getState().settings.wifiOnly).toBe(false);
  });

  it("hydrate() with nothing stored keeps defaults", async () => {
    await useBackupSettings.getState().hydrate();
    // Fresh install: defaults, except that it is marked migrated so it never
    // sees the one-time "choose what to back up" card meant for upgrades.
    expect(useBackupSettings.getState().settings).toEqual({ ...DEFAULT_BACKUP_SETTINGS, filtersMigrated: true });
  });

  it("hydrates an upgrading install to the everything shape", async () => {
    // A pre-filters install: settings exist, but no `filters` key.
    mockMem.set("dosya.backup.settings", JSON.stringify({ autoBackup: true, wifiOnly: false }));
    await useBackupSettings.getState().hydrate();
    const s = useBackupSettings.getState().settings;
    expect(s.autoBackup).toBe(true);
    expect(s.wifiOnly).toBe(false);
    expect(s.filters).toEqual(DEFAULT_BACKUP_FILTERS);
    // False, so the Backup tab shows the one-time card.
    expect(s.filtersMigrated).toBe(false);
  });

  it("merges a partial stored filters object instead of replacing it wholesale", async () => {
    // Written by an older build that only knew about mediaTypes.
    mockMem.set("dosya.backup.settings", JSON.stringify({ filters: { mediaTypes: ["photo"] } }));
    await useBackupSettings.getState().hydrate();
    const f = useBackupSettings.getState().settings.filters;
    expect(f.mediaTypes).toEqual(["photo"]);
    // Fields the old build never wrote must still be present, not undefined.
    expect(f.albumMode).toBe("all");
    expect(f.albumIds).toEqual([]);
    expect(f.maxBytes).toBeNull();
  });

  it("updateFilters patches one field without dropping the others", async () => {
    await useBackupSettings.getState().updateFilters({ mediaTypes: ["photo"] });
    const f = useBackupSettings.getState().settings.filters;
    expect(f.mediaTypes).toEqual(["photo"]);
    expect(f.albumMode).toBe("all");
    expect(f.maxBytes).toBeNull();
    // ...and it persists, so a relaunch keeps the choice.
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS } });
    await useBackupSettings.getState().hydrate();
    expect(useBackupSettings.getState().settings.filters.mediaTypes).toEqual(["photo"]);
  });

  /**
   * A scan seeds a ledger row per admitted asset and the planner works from
   * those rows, not from the filters - so narrowing the filters changed
   * nothing about what was already queued up: deselect an album and the next
   * run went on uploading it, which is the opposite of what was just asked.
   */
  it("drops the rows the old filters seeded, everywhere, and clears the watermarks", async () => {
    await useBackupSettings.getState().updateFilters({ mediaTypes: ["photo"] });

    expect(distinctWorkspaceIds).toHaveBeenCalled();
    expect((deletePending as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["wA", "wB"]);
    // Without this the next scan starts from where the last one finished and
    // never re-seeds the assets the NEW filters admit.
    expect(clearWatermarks).toHaveBeenCalled();
  });

  it("re-seeds nothing when the patch does not actually change the filters", async () => {
    await useBackupSettings.getState().updateFilters({ albumMode: "all" });
    expect(deletePending).not.toHaveBeenCalled();
    expect(clearWatermarks).not.toHaveBeenCalled();
  });

  it("still saves the filters when the ledger cannot be tidied", async () => {
    (distinctWorkspaceIds as jest.Mock).mockRejectedValueOnce(new Error("database is locked"));
    await expect(useBackupSettings.getState().updateFilters({ maxBytes: 100 })).resolves.toBeUndefined();
    expect(useBackupSettings.getState().settings.filters.maxBytes).toBe(100);
  });

  it("last-run timestamp round-trips", async () => {
    expect(await getLastRunAt()).toBeNull();
    await setLastRunAt(1710000000);
    expect(await getLastRunAt()).toBe(1710000000);
  });
});

describe("resetBackupSettings", () => {
  it("returns to defaults and forgets persisted settings + last-run (account purge)", async () => {
    await useBackupSettings.getState().update({ autoBackup: true });
    await setLastRunAt(1710000000);
    const { resetBackupSettings } = require("./settings");
    await resetBackupSettings();
    expect(useBackupSettings.getState().settings).toEqual(DEFAULT_BACKUP_SETTINGS);
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS, autoBackup: true } });
    await useBackupSettings.getState().hydrate(); // nothing persisted -> keeps current
    expect(await getLastRunAt()).toBeNull();
  });
});

describe("resolveBackupDestinations", () => {
  const { resolveBackupDestinations } = require("./settings");
  it("falls back to the active workspace when none are configured", () => {
    expect(resolveBackupDestinations("w1", { ...DEFAULT_BACKUP_SETTINGS })).toEqual(["w1"]);
    expect(resolveBackupDestinations(null, { ...DEFAULT_BACKUP_SETTINGS })).toEqual([]);
  });
  it("uses the configured set (deduped), ignoring the active workspace", () => {
    expect(
      resolveBackupDestinations("w1", { ...DEFAULT_BACKUP_SETTINGS, destinationIds: ["w2", "w3", "w2"] }),
    ).toEqual(["w2", "w3"]);
  });
});

describe("keychain unreadable (iOS refuses WHEN_UNLOCKED entries while the phone is locked)", () => {
  const SecureStore = jest.requireMock("expo-secure-store") as { getItemAsync: jest.Mock; setItemAsync: jest.Mock };
  const lockedOnce = (m: jest.Mock) => m.mockRejectedValueOnce(new Error("User interaction is not allowed."));

  it("getLastRunAt reads as no run rather than rejecting", async () => {
    lockedOnce(SecureStore.getItemAsync);
    await expect(getLastRunAt()).resolves.toBeNull();
  });

  it("setLastRunAt swallows a failed write: a finished run must not report 'Backup failed'", async () => {
    lockedOnce(SecureStore.setItemAsync);
    await expect(setLastRunAt(1710000000)).resolves.toBeUndefined();
  });

  it("hydrate() resolves on a failed read, stays unhydrated, and reads again next time", async () => {
    await useBackupSettings.getState().update({ autoBackup: true });
    __resetBackupSettingsHydration();
    useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: false });

    lockedOnce(SecureStore.getItemAsync);
    await expect(useBackupSettings.getState().hydrate()).resolves.toBeUndefined();
    expect(useBackupSettings.getState().hydrated).toBe(false);
    expect(useBackupSettings.getState().settings.autoBackup).toBe(false);

    // Unlocked now: the memoised attempt must not be the rejected one.
    await useBackupSettings.getState().hydrate();
    expect(useBackupSettings.getState().hydrated).toBe(true);
    expect(useBackupSettings.getState().settings.autoBackup).toBe(true);
  });
});
