import { t } from "@/lib/i18n";
import { THEME_META, THEME_TOKENS } from "@/theme/tokens";
import { THEME_LABEL_KEYS } from "@/theme/themeLabels";

/** A paintable reader theme: either a fixed reading theme or an app theme's light palette. */
export interface ReaderTheme {
  id: string;
  label: string;
  group: "reading" | "app";
  bg: string;
  fg: string;
}

/** The three fixed reading themes - independent of the app's color theme. */
export const READING_THEMES: ReaderTheme[] = [
  { id: "light", get label() { return t("common.option.light"); }, group: "reading", bg: "#ffffff", fg: "#1a1a1a" },
  { id: "sepia", get label() { return t("reader.label.sepia"); }, group: "reading", bg: "#f4ecd8", fg: "#5b4636" },
  { id: "dark", get label() { return t("common.option.dark"); }, group: "reading", bg: "#121212", fg: "#c8c8c8" },
];

/**
 * One reader theme per app theme, derived from THEME_META + THEME_TOKENS's light-mode
 * background/foreground. Adding a theme to the app's theme system adds it here too -
 * nothing to hand-maintain.
 */
export const APP_READER_THEMES: ReaderTheme[] = THEME_META.map((meta) => ({
  id: meta.id,
  // Produced at use, so a language switch shows up.
  get label() { return t(THEME_LABEL_KEYS[meta.id]); },
  group: "app",
  bg: THEME_TOKENS[meta.id].light.background,
  fg: THEME_TOKENS[meta.id].light.foreground,
}));

/** Reading themes first, then app themes - the order ThemesSheet renders swatches in. */
export const ALL_READER_THEMES: ReaderTheme[] = [...READING_THEMES, ...APP_READER_THEMES];

const BY_ID: Record<string, ReaderTheme> = Object.fromEntries(ALL_READER_THEMES.map((t) => [t.id, t]));

/** Resolves a stored theme id to its colors, falling back to the light reading theme. */
export function themeById(id: string): ReaderTheme {
  return BY_ID[id] ?? READING_THEMES[0];
}

export function isKnownThemeId(id: string): boolean {
  return id in BY_ID;
}
