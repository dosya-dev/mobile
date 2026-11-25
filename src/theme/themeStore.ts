import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { apiRequest } from "@/api";
import { THEME_IDS, type ThemeId, type ThemeMode } from "./tokens";

const KEY = "dosya.appearance";
export const DEFAULT_THEME: ThemeId = "default";
export const DEFAULT_MODE: ThemeMode = "system";

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as string[]).includes(v);
}
function isMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

interface AppearanceState {
  theme: ThemeId;
  mode: ThemeMode;
  hydrated: boolean;
  /** Read the cached choice - fast and offline, so first paint isn't the wrong theme. */
  hydrate: () => Promise<void>;
  /** Adopt the server's values. Server wins, so the theme follows you across devices. */
  applyFromServer: (theme: unknown, mode: unknown) => Promise<void>;
  setTheme: (t: ThemeId) => Promise<void>;
  setMode: (m: ThemeMode) => Promise<void>;
}

async function persist(theme: ThemeId, mode: ThemeMode) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ theme, mode }));
  } catch {
    /* best-effort cache */
  }
}

export const useAppearance = create<AppearanceState>((set, get) => ({
  theme: DEFAULT_THEME,
  mode: DEFAULT_MODE,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        set({
          theme: isThemeId(p?.theme) ? p.theme : DEFAULT_THEME,
          mode: isMode(p?.mode) ? p.mode : DEFAULT_MODE,
        });
      }
    } catch {
      /* corrupt cache -> defaults */
    }
    set({ hydrated: true });
  },

  applyFromServer: async (theme, mode) => {
    const next = { theme: isThemeId(theme) ? theme : DEFAULT_THEME, mode: isMode(mode) ? mode : DEFAULT_MODE };
    const cur = get();
    if (cur.theme === next.theme && cur.mode === next.mode) return;
    set(next);
    await persist(next.theme, next.mode);
  },

  // Optimistic: apply immediately, roll back if the server rejects it. Mirrors web.
  setTheme: async (t) => {
    const prev = get().theme;
    set({ theme: t });
    await persist(t, get().mode);
    try {
      await apiRequest("/api/me/appearance", { method: "PUT", body: { theme: t, mode: get().mode } });
    } catch (e) {
      set({ theme: prev });
      await persist(prev, get().mode);
      throw e;
    }
  },

  setMode: async (m) => {
    const prev = get().mode;
    set({ mode: m });
    await persist(get().theme, m);
    try {
      await apiRequest("/api/me/appearance", { method: "PUT", body: { theme: get().theme, mode: m } });
    } catch (e) {
      set({ mode: prev });
      await persist(get().theme, prev);
      throw e;
    }
  },
}));
