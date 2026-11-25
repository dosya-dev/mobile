import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { isKnownThemeId } from "./readerThemes";

export interface ReaderSettings { fontSizePct: number; themeId: string }

export const FONT_MIN = 70;
export const FONT_MAX = 200;
export const FONT_STEP = 10;
const KEY = "dosya.reader.prefs";
const DEFAULT_THEME_ID = "light";

interface ReaderPrefsState extends ReaderSettings {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setFontSizePct: (v: number) => Promise<void>;
  setThemeId: (id: string) => Promise<void>;
}

const clamp = (v: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(v)));

async function persist(s: ReaderSettings) {
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(s)); } catch { /* best-effort */ }
}

/** Global (not per-book) reading settings, persisted like viewPrefs. */
export const useReaderPrefs = create<ReaderPrefsState>((set, get) => ({
  fontSizePct: 100,
  themeId: DEFAULT_THEME_ID,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const p: unknown = JSON.parse(raw);
        const o = p as Partial<ReaderSettings>;
        set({
          fontSizePct: typeof o.fontSizePct === "number" ? clamp(o.fontSizePct) : 100,
          themeId: typeof o.themeId === "string" && isKnownThemeId(o.themeId) ? o.themeId : DEFAULT_THEME_ID,
        });
      }
    } catch { /* defaults stand */ }
    set({ hydrated: true });
  },
  setFontSizePct: async (v) => {
    const fontSizePct = clamp(v);
    set({ fontSizePct });
    await persist({ fontSizePct, themeId: get().themeId });
  },
  setThemeId: async (themeId) => {
    set({ themeId });
    await persist({ fontSizePct: get().fontSizePct, themeId });
  },
}));
