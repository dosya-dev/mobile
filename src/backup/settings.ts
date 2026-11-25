import { create } from "zustand";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import { DEFAULT_BACKUP_FILTERS, type BackupFilters } from "./filters";
import { distinctWorkspaceIds, deletePending } from "./ledger";
import { clearWatermarks } from "./watermark";

export interface BackupSettings {
  autoBackup: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
  deleteAfterBackup: boolean;
  minBatteryPercent: number;
  /** Workspaces every backup run copies to. Empty = just the active workspace
   * (the original single-destination behavior). */
  destinationIds: string[];
  /** What gets backed up, as opposed to when. See ./filters. */
  filters: BackupFilters;
  /** False on an install that predates filters - drives the one-time "choose
   * what to back up" card on the Backup tab. An upgrade must never silently
   * narrow what it covers, so upgrades land on the everything shape and are
   * asked rather than migrated. */
  filtersMigrated: boolean;
  /** Whether platform album defaults have been resolved for this install.
   * Camera bucket ids need media permission and an album query, so they cannot
   * be known at hydrate time. See ./albumDefaults. */
  albumDefaultsApplied: boolean;
  /** iOS only: hand uploads to a background URLSession so backup continues
   * after the phone locks. Off = the in-process runner (the Android path). A
   * kill switch for a bad TestFlight round, not a user-facing feature. */
  backgroundTransport: boolean;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackup: false,
  wifiOnly: true,
  chargingOnly: false,
  deleteAfterBackup: false,
  minBatteryPercent: 20,
  destinationIds: [],
  filters: { ...DEFAULT_BACKUP_FILTERS },
  filtersMigrated: false,
  albumDefaultsApplied: false,
  backgroundTransport: true,
};

/**
 * The workspaces a backup run writes to: the configured destination set, or
 * just the active workspace when none are configured. Each destination keeps
 * its own ledger + server fingerprint dedup, so photos already present in a
 * workspace link instead of re-uploading.
 */
export function resolveBackupDestinations(activeId: string | null, settings: BackupSettings): string[] {
  const ids = settings.destinationIds.filter((id, i, a) => a.indexOf(id) === i);
  if (ids.length > 0) return ids;
  return activeId ? [activeId] : [];
}

const SETTINGS_KEY = "dosya.backup.settings";
const LAST_RUN_KEY = "dosya.backup.lastRun";

/** In-flight hydrate, shared by concurrent callers. See `hydrate` below. */
let hydrateP: Promise<void> | null = null;

interface BackupSettingsState {
  settings: BackupSettings;
  /** False until the persisted settings have been read into this process. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<BackupSettings>) => Promise<void>;
  updateFilters: (patch: Partial<BackupFilters>) => Promise<void>;
}

export const useBackupSettings = create<BackupSettingsState>((set, get) => ({
  settings: { ...DEFAULT_BACKUP_SETTINGS },
  hydrated: false,
  /**
   * Load persisted settings. Callers must not assume a React tree has already
   * done this: the background task can run headless from a cold start, and
   * reading the in-memory defaults there reports `autoBackup: false` and skips
   * the run forever.
   *
   * Guarded by `hydrated` rather than re-reading every time. `update()` writes
   * through to SecureStore, so once loaded the in-memory copy is authoritative -
   * and a re-read racing an in-flight `update()` would clobber a just-changed
   * value with the stale persisted one.
   */
  hydrate: async () => {
    if (get().hydrated) return;
    // Memoised so concurrent callers (startup effect + a headless run firing at
    // the same moment) share ONE read instead of racing two.
    const attempt = (hydrateP ??= (async () => {
      let raw: string | null;
      try {
        raw = await getItem(SETTINGS_KEY);
      } catch {
        // The store would not open - on iOS, a phone that is locked while a
        // background upload wakes the app. Keep the in-memory defaults and
        // stay unhydrated, but do NOT keep this attempt: a rejected promise
        // memoised here would fail every later hydrate() for the life of the
        // process (the next headless run, the Backup tab coming back to the
        // foreground) and read as "auto-backup off" until the app was killed.
        hydrateP = null;
        return;
      }
      if (!raw) {
        // Nothing persisted - a fresh install. Keep whatever is in memory
        // (defaults at startup) but mark filters migrated: the one-time card is
        // for upgrades, and a brand new install has nothing to be warned about.
        set({ settings: { ...get().settings, filtersMigrated: true }, hydrated: true });
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<BackupSettings>;
        set({
          settings: {
            ...DEFAULT_BACKUP_SETTINGS,
            ...parsed,
            // Merge the nested object explicitly. The spread above would
            // otherwise replace it wholesale with a partial written by an older
            // build, leaving newer fields undefined at runtime.
            filters: { ...DEFAULT_BACKUP_FILTERS, ...(parsed.filters ?? {}) },
          },
        });
      } catch {
        // Corrupt value - fall back to defaults.
      }
      set({ hydrated: true });
    })());
    await attempt;
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await setItem(SETTINGS_KEY, JSON.stringify(next));
  },
  updateFilters: async (patch) => {
    const prev = get().settings.filters;
    const next = { ...get().settings, filters: { ...prev, ...patch } };
    const changed = JSON.stringify(next.filters) !== JSON.stringify(prev);
    set({ settings: next });
    await setItem(SETTINGS_KEY, JSON.stringify(next));
    if (changed) await resetSeededWork();
  },
}));

/**
 * Throws away the work the OLD filters seeded.
 *
 * A scan seeds a ledger row for every asset the filters admit, and the planner
 * works from those rows rather than from the filters - so narrowing the
 * filters changed nothing about what was already queued up. Deselect an album
 * or turn videos off and the next run went on uploading exactly what it was
 * going to upload, which is the opposite of what the user just asked for.
 *
 * Only `pending` rows go: a `queued` row has a job in flight (the transport
 * settles it and drops its staged copy), and uploaded / failed / size-capped
 * rows are history. The watermarks go with them, or the next scan would start
 * from where the last one finished and never re-seed the assets the new
 * filters do admit.
 *
 * Best effort: a backup that cannot tidy up its ledger must not stop the user
 * changing a setting.
 */
async function resetSeededWork(): Promise<void> {
  try {
    for (const workspaceId of await distinctWorkspaceIds()) {
      await deletePending(workspaceId);
    }
    await clearWatermarks();
  } catch {
    // Worst case the next scan re-seeds over rows it did not need to.
  }
}

export async function getLastRunAt(): Promise<number | null> {
  let raw: string | null;
  try {
    raw = await getItem(LAST_RUN_KEY);
  } catch {
    return null; // unreadable store (phone locked) reads as no run; the next focus reads again
  }
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function setLastRunAt(unixSeconds: number): Promise<void> {
  try {
    await setItem(LAST_RUN_KEY, String(unixSeconds));
  } catch {
    // Best-effort: a lost stamp is one stale "last run" line. A throw here
    // turned a run that had just finished into a "Backup failed" toast.
  }
}

/** Account purge (sign-out): back to defaults, nothing persisted. */
export async function resetBackupSettings(): Promise<void> {
  // Stays `hydrated: true` - defaults ARE the correct state for a signed-out
  // process, and re-reading the key we just deleted would only flip
  // filtersMigrated back on.
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: true });
  hydrateP = null;
  await deleteItem(SETTINGS_KEY);
  await deleteItem(LAST_RUN_KEY);
}

// Test hook: lets specs simulate a fresh process (see uploadBlock for the same
// pattern). Not used in app code.
export function __resetBackupSettingsHydration(): void {
  hydrateP = null;
  useBackupSettings.setState({ hydrated: false });
}
