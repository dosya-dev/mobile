/**
 * The stage - the surface the file itself sits on - stays dark in every app
 * theme, and this module is the only place that decides so.
 *
 * The rest of the viewer follows the user's chosen theme through nativewind as
 * usual. The stage does not, for the same reason no photo viewer does: a light
 * ground shifts the apparent colour and contrast of whatever is shown on it,
 * and a photo, a video frame and a scanned page all read wrong against white.
 *
 * In a light theme it lifts off pure black so it reads as a deliberate surface
 * rather than a hole punched in the screen; in a dark theme it settles onto the
 * app's own background so the stage and the sheet feel like one screen.
 */
export interface StagePalette {
  /** The ground behind the file. */
  bg: string;
  /** A slightly lifted ground, for stages that show a card rather than an image. */
  bgRaised: string;
  /** Foreground on the stage - always light, since the stage is always dark. */
  fg: string;
  /** Secondary text and inactive glyphs on the stage. */
  fgMuted: string;
  /** Fill for the floating chrome buttons. */
  chrome: string;
  /** Hairline on stage-level surfaces. */
  hairline: string;
}

const LIGHT_SCHEME_STAGE: StagePalette = {
  bg: "#0c1319",
  bgRaised: "#131c24",
  fg: "#ffffff",
  fgMuted: "rgba(255,255,255,0.62)",
  chrome: "rgba(255,255,255,0.14)",
  hairline: "rgba(255,255,255,0.13)",
};

const DARK_SCHEME_STAGE: StagePalette = {
  bg: "#02080e",
  bgRaised: "#0a141c",
  fg: "#ffffff",
  fgMuted: "rgba(255,255,255,0.6)",
  chrome: "rgba(255,255,255,0.13)",
  hairline: "rgba(255,255,255,0.12)",
};

export function stagePalette(scheme: "light" | "dark"): StagePalette {
  return scheme === "dark" ? DARK_SCHEME_STAGE : LIGHT_SCHEME_STAGE;
}

/** The scrim behind the top chrome, so white glyphs stay legible on a bright photo. */
export const CHROME_SCRIM = ["rgba(2,8,14,0.62)", "rgba(2,8,14,0.26)", "rgba(2,8,14,0)"] as const;
