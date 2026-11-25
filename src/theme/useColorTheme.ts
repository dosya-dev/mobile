import { useColorScheme as useOSScheme } from "react-native";
import { THEME_TOKENS, THEME_VARS, type TokenName, type ThemeMode, type ThemeId } from "./tokens";
import { useAppearance } from "./themeStore";

/** "system" resolves against the OS; light/dark are explicit. */
export function resolveScheme(mode: ThemeMode, osScheme: "light" | "dark" | null | undefined): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return osScheme === "dark" ? "dark" : "light";
}

/**
 * The active theme's tokens as hex - for imperative props (Ionicons colour, tab bar)
 * that can't use a className. ClassName styling goes through nativewind's CSS vars
 * instead (see ThemeProvider), so both paths stay in sync from one source.
 */
export function useColorTheme(): {
  scheme: "light" | "dark";
  theme: ThemeId;
  tokens: Record<TokenName, string>;
} {
  const os = useOSScheme();
  const theme = useAppearance((s) => s.theme);
  const mode = useAppearance((s) => s.mode);
  const scheme = resolveScheme(mode, os);
  return { scheme, theme, tokens: THEME_TOKENS[theme][scheme] };
}

/** The CSS variable set for the active theme, fed to nativewind's vars(). */
export function useThemeVars(): Record<string, string> {
  const os = useOSScheme();
  const theme = useAppearance((s) => s.theme);
  const mode = useAppearance((s) => s.mode);
  return THEME_VARS[theme][resolveScheme(mode, os)];
}
