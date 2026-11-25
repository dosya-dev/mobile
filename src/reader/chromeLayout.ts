/**
 * Where the reader's two floating controls sit, and therefore where the
 * page must treat a tap as "show me the controls" rather than "turn the
 * page". ReaderChrome positions the buttons from these numbers and
 * BookReader derives its tap bands from them, so the two can never drift
 * apart.
 */

/** Diameter of each circular control, in pt. */
export const CHROME_BUTTON = 44;
/** Gap between the top safe-area inset and the close button. */
export const CHROME_TOP_GAP = 14;
/** Gap between the bottom safe-area inset and the menu button. */
export const CHROME_BOTTOM_GAP = 40;
/** Extra reach past each button so a slightly-off tap still counts as aiming for it. */
export const CHROME_BAND_SLACK = 14;
/** Used until the page has reported its height (or if it never does). */
export const FALLBACK_BAND = 0.15;

/** Fractions of the page height the top and bottom control bands occupy. */
export interface TapBands {
  top: number;
  bottom: number;
}

export function chromeBands(insets: { top: number; bottom: number }, pageHeight: number): TapBands {
  if (!(pageHeight > 0)) return { top: FALLBACK_BAND, bottom: FALLBACK_BAND };
  const top = insets.top + CHROME_TOP_GAP + CHROME_BUTTON + CHROME_BAND_SLACK;
  const bottom = insets.bottom + CHROME_BOTTOM_GAP + CHROME_BUTTON + CHROME_BAND_SLACK;
  // A very short page (split view, tiny device) must keep a middle band to
  // turn pages from, so neither band may claim more than a third of it.
  return {
    top: Math.min(top / pageHeight, 1 / 3),
    bottom: Math.min(bottom / pageHeight, 1 / 3),
  };
}
