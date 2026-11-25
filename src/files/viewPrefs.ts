import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import type { LibraryKind } from "@/library/api";

export type FileViewMode = "list" | "grid";
const KEY = "dosya.files.viewMode";
const LIBRARY_LAYOUT_KEY = "dosya.files.libraryLayout";

/** Per-kind default: photos and videos open as a grid, documents as a list. */
export const DEFAULT_LIBRARY_LAYOUT: Record<LibraryKind, FileViewMode> = {
  photos: "grid",
  videos: "grid",
  documents: "list",
};

function isFileViewMode(v: unknown): v is FileViewMode {
  return v === "list" || v === "grid";
}

/** Parses the persisted `dosya.files.libraryLayout` JSON blob, keeping only known
 * kinds and valid modes and merging the rest over the defaults. Anything else
 * (missing key, invalid JSON, non-object, unknown shape) falls back to the
 * defaults entirely. */
function parseLibraryLayout(raw: string | null): Record<LibraryKind, FileViewMode> {
  if (!raw) return { ...DEFAULT_LIBRARY_LAYOUT };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_LIBRARY_LAYOUT };
    const merged = { ...DEFAULT_LIBRARY_LAYOUT };
    for (const kind of Object.keys(DEFAULT_LIBRARY_LAYOUT) as LibraryKind[]) {
      const v = (parsed as Record<string, unknown>)[kind];
      if (isFileViewMode(v)) merged[kind] = v;
    }
    return merged;
  } catch {
    return { ...DEFAULT_LIBRARY_LAYOUT };
  }
}

interface ViewPrefsState {
  viewMode: FileViewMode;
  /** Grid-or-list choice per library kind (Photos/Videos/Docs), independent of `viewMode`. */
  libraryLayout: Record<LibraryKind, FileViewMode>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setViewMode: (m: FileViewMode) => Promise<void>;
  setLibraryLayout: (kind: LibraryKind, m: FileViewMode) => Promise<void>;
}

/** Persisted list⇄grid choice for the file browser. Defaults to list. */
export const useViewPrefs = create<ViewPrefsState>((set, get) => ({
  viewMode: "list",
  libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT },
  hydrated: false,
  hydrate: async () => {
    try {
      const [v, layoutRaw] = await Promise.all([
        SecureStore.getItemAsync(KEY),
        SecureStore.getItemAsync(LIBRARY_LAYOUT_KEY),
      ]);
      set({
        viewMode: v === "grid" ? "grid" : "list",
        libraryLayout: parseLibraryLayout(layoutRaw),
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  setViewMode: async (m) => {
    set({ viewMode: m });
    try {
      await SecureStore.setItemAsync(KEY, m);
    } catch {
      /* best-effort persistence */
    }
  },
  setLibraryLayout: async (kind, m) => {
    const next = { ...get().libraryLayout, [kind]: m };
    set({ libraryLayout: next });
    try {
      await SecureStore.setItemAsync(LIBRARY_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* best-effort persistence */
    }
  },
}));
