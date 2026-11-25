import { SWATCHES } from "@/theme/palette";

/**
 * Per-person colours from the identity swatches, assigned by rank (payer
 * first, then by usage), as the web and desktop Family views do. A family
 * holds at most 16 people and SWATCHES has 7: past the list, people share the
 * last swatch rather than cycling back to someone else's colour.
 *
 * Every function takes `dark` from useColorTheme() at render, so a theme
 * change while the screen is open repaints at once.
 */
export function personColor(index: number, dark: boolean): string {
  const sw = SWATCHES[Math.min(Math.max(0, index), SWATCHES.length - 1)];
  return dark ? sw.dark : sw.light;
}

/** The label colour that meets AA on personColor (avatar initials). */
export function personInk(index: number, dark: boolean): string {
  const sw = SWATCHES[Math.min(Math.max(0, index), SWATCHES.length - 1)];
  return dark ? sw.darkInk : sw.lightInk;
}

/**
 * A #rrggbb colour at `pct` percent opacity (#rrggbbaa): reserved space a
 * person has not used yet, a badge's tint. React Native has no color-mix().
 */
export function tint(hex: string, pct: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const a = Math.round((Math.min(100, Math.max(0, pct)) / 100) * 255);
  return `${hex}${a.toString(16).padStart(2, "0")}`;
}

/** The amber note (reservations over the plan, a reservation below use), the mockup's warn tone. */
export function warnTone(dark: boolean): { backgroundColor: string; color: string } {
  return dark ? { backgroundColor: "rgba(251,191,36,0.12)", color: "#fbbf24" } : { backgroundColor: "rgba(180,83,9,0.10)", color: "#b45309" };
}

/** The green chip ("5 places included", "Shared with you"). */
export function greenTone(dark: boolean): { backgroundColor: string; color: string } {
  const green = personColor(0, dark);
  return { backgroundColor: tint(green, dark ? 14 : 10), color: green };
}
