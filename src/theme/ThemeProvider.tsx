import { useEffect, type ReactNode } from "react";
import { View, useColorScheme as useOSScheme } from "react-native";
import { colorScheme, vars } from "nativewind";
import { useAppearance } from "./themeStore";
import { useThemeVars, resolveScheme } from "./useColorTheme";
import { ThemeSweepOverlay } from "./ThemeSweep";

/**
 * Applies the user's chosen theme + mode.
 *
 * Two things have to move together:
 *  - `colorScheme.set` drives nativewind's dark: variants.
 *  - `vars()` overrides the CSS custom properties global.css declares, scoped to this
 *    subtree. That's what makes 8 themes possible at all: nativewind has no data-theme
 *    concept, so every existing className (bg-card, text-foreground, ...) re-themes via
 *    the variables rather than by editing a single component.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const os = useOSScheme();
  const mode = useAppearance((s) => s.mode);
  const hydrate = useAppearance((s) => s.hydrate);
  const themeVars = useThemeVars();
  const scheme = resolveScheme(mode, os);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => { colorScheme.set(scheme); }, [scheme]);

  // The sweep overlay is last, so it paints above the app; it renders nothing
  // until a theme change asks for one. See ThemeSweep.tsx.
  return (
    <View style={vars(themeVars)} className="flex-1">
      {children}
      <ThemeSweepOverlay />
    </View>
  );
}
