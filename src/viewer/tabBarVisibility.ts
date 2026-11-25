/**
 * Routes inside the Files tab that take over the whole screen.
 *
 * The Files tab deliberately keeps its bar mounted while you browse - that is
 * the entire reason folders and files were nested inside the tab rather than
 * pushed onto the root stack. The viewer is the one exception: it is a
 * full-bleed surface whose sheet is anchored to the bottom edge, and a tab bar
 * under it both crops the stage and survives the tap that is supposed to strip
 * every control away.
 *
 * `getFocusedRouteNameFromRoute` returns undefined until the nested navigator
 * has laid out, which is the common case on first paint. Undefined must mean
 * "show the bar", never "hide it" - guessing wrong in that direction makes the
 * tab bar flicker away on every cold start of the Files tab.
 */
const IMMERSIVE_ROUTES = new Set(["file/[id]"]);

export function shouldHideTabBar(focusedRouteName: string | undefined): boolean {
  if (!focusedRouteName) return false;
  return IMMERSIVE_ROUTES.has(focusedRouteName);
}
