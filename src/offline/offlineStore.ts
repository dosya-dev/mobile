import { create } from "zustand";
import { deleteItem, getItem, setItem } from "@/lib/keychain";
import { currentSession } from "./session";
import { listFiles, listPins } from "./db";
import type { PinRow } from "./types";

/**
 * What the UI shows about offline files, mirrored from the database after each
 * change (refresh), plus the two device settings.
 *
 * The settings are the device's, not the account's: they live in the keychain
 * like the backup settings, and survive Remove all. Everything else is the
 * account's and goes with reset().
 */

export const OFFLINE_SETTINGS_KEY = "dosya.offline.settings";

export interface OfflineProgress { done: number; total: number; bytesDone: number; bytesTotal: number }

interface OfflineState {
  pins: PinRow[];
  savedFileIds: Set<string>;
  /** Saved, but at an older version than the server's. */
  updatePendingIds: Set<string>;
  progress: OfflineProgress | null;
  /** "Download offline files over mobile data". Off by default. */
  allowCellular: boolean;
  /** Retained-storage budget in bytes, or null for none. */
  budgetBytes: number | null;
  hydrated: boolean;
  setAllowCellular(v: boolean): void;
  setBudget(b: number | null): void;
  setProgress(p: OfflineProgress | null): void;
  hydrate(): Promise<void>;
  /** Back to Wi-Fi only and no budget, and forget the stored choice. Sign-out and account switch. */
  resetSettings(): Promise<void>;
  refresh(): Promise<void>;
  reset(): void;
}

/**
 * Settings the user changed since hydrate began. Hydrate must not overwrite
 * them with what it read, and a change made before hydrate finished is only
 * written once it has (or it would replace the stored value of the OTHER
 * setting with a default).
 */
const touched = new Set<"allowCellular" | "budgetBytes">();
let persistAfterHydrate = false;

function persist(s: { allowCellular: boolean; budgetBytes: number | null; hydrated: boolean }): void {
  if (!s.hydrated) {
    persistAfterHydrate = true;
    return;
  }
  void setItem(OFFLINE_SETTINGS_KEY, JSON.stringify({ allowCellular: s.allowCellular, budgetBytes: s.budgetBytes })).catch(() => {});
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  pins: [],
  savedFileIds: new Set(),
  updatePendingIds: new Set(),
  progress: null,
  allowCellular: false,
  budgetBytes: null,
  hydrated: false,

  setAllowCellular: (v) => {
    if (!get().hydrated) touched.add("allowCellular");
    set({ allowCellular: v });
    persist(get());
  },
  setBudget: (b) => {
    if (!get().hydrated) touched.add("budgetBytes");
    set({ budgetBytes: b != null && b > 0 ? b : null });
    persist(get());
  },
  setProgress: (p) => set({ progress: p }),

  hydrate: async () => {
    if (get().hydrated) return;
    let raw: string | null = null;
    try {
      raw = await getItem(OFFLINE_SETTINGS_KEY);
    } catch {
      // A keychain that will not open (a locked phone waking a background run)
      // leaves the safe defaults - Wi-Fi only, no budget - and stays unhydrated
      // so the next call tries again.
      return;
    }
    try {
      const parsed = raw ? (JSON.parse(raw) as { allowCellular?: unknown; budgetBytes?: unknown }) : {};
      const next: Partial<OfflineState> = {};
      if (!touched.has("allowCellular")) next.allowCellular = parsed.allowCellular === true;
      if (!touched.has("budgetBytes")) {
        next.budgetBytes = typeof parsed.budgetBytes === "number" && parsed.budgetBytes > 0 ? parsed.budgetBytes : null;
      }
      set(next);
    } catch {
      // Corrupt value: defaults.
    }
    set({ hydrated: true });
    touched.clear();
    if (persistAfterHydrate) {
      persistAfterHydrate = false;
      persist(get());
    }
  },

  resetSettings: async () => {
    touched.clear();
    persistAfterHydrate = false;
    // Hydrated: the defaults ARE the setting now, so a later hydrate must not
    // bring back the signed-out account's choice from a slow keychain read.
    set({ allowCellular: false, budgetBytes: null, hydrated: true });
    await deleteItem(OFFLINE_SETTINGS_KEY).catch(() => {});
  },

  refresh: async () => {
    const s = currentSession();
    if (!s) {
      set({ pins: [], savedFileIds: new Set(), updatePendingIds: new Set() });
      return;
    }
    try {
      const [pins, files] = await Promise.all([listPins(s), listFiles(s)]);
      set({
        pins,
        savedFileIds: new Set(files.filter((f) => f.saved_version != null).map((f) => f.file_id)),
        updatePendingIds: new Set(
          files.filter((f) => f.saved_version != null && f.saved_version !== f.remote_version).map((f) => f.file_id),
        ),
      });
    } catch {
      // A database that will not open leaves the last good picture on screen.
    }
  },

  reset: () => set({ pins: [], savedFileIds: new Set(), updatePendingIds: new Set(), progress: null }),
}));
