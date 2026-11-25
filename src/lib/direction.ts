import { I18nManager, Platform } from "react-native";
import { reloadAppAsync } from "expo";
import * as Sentry from "@sentry/react-native";
import { getItem, setItem } from "@/lib/keychain";
import { getLayoutOverride, setLayoutOverride } from "@/lib/direction-seam";

/**
 * Native layout direction.
 *
 * On React Native the layout direction is fixed for the life of a JS runtime:
 * allowRTL/forceRTL only take effect at the next start. The app keeps one
 * invariant, "the native direction equals the direction of the language on
 * screen", by syncing the flags at boot and reloading once when they disagree.
 * This is the only module that touches I18nManager or reloadAppAsync.
 */

/**
 * Keychain entry holding the last direction reload as "<ms since epoch>:<1 for
 * RTL, 0 for LTR>". An older stamp without the direction counts as the same one.
 */
export const DIRECTION_RELOAD_KEY = "dosya.directionReloadAt";
/** A second reload to the same direction inside this window is refused: it would be a loop. */
export const DIRECTION_RELOAD_GUARD_MS = 60_000;

// The seam lives in a module with no imports so jest-setup can reset it after
// every test without loading react-native, expo or Sentry into each test file.
/** Native truth for this runtime. Constant until the app restarts. */
export function layoutIsRtl(): boolean {
  const override = getLayoutOverride();
  if (override !== null) return override;
  try {
    return I18nManager.getConstants().isRTL === true;
  } catch {
    return false;
  }
}

const INPUT_START = { textAlign: "right" } as const;

/**
 * The start-edge alignment for a TextInput on iOS in a right-to-left layout,
 * spread into its style (undefined otherwise, so left to right and Android are
 * unchanged). iOS resolves an unset alignment from the app bundle's
 * localization, which has no RTL language, so fields started on the left; and
 * unlike Text, a TextInput's "left"/"right" are not swapped in RTL, so the start
 * side is asked for physically. Fields that set their own alignment skip it.
 */
export function inputStartAlign(): typeof INPUT_START | undefined {
  return Platform.OS === "ios" && layoutIsRtl() ? INPUT_START : undefined;
}

/** Same value as layoutIsRtl(); a hook so components read it the React way. */
export function useLayoutRtl(): boolean {
  return layoutIsRtl();
}

/**
 * Sets the three native flags for the next start. React Native's left/right
 * swap stays OFF on both platforms (Android defaults it on), so a physical
 * style always means physical. Never throws.
 */
export function syncNativeDirection(rtl: boolean): void {
  try {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
    I18nManager.swapLeftAndRightInRTL(false);
  } catch (err) {
    console.error("[direction] could not set the native flags:", err);
  }
}

/**
 * Whether this runtime must restart to lay out in `rtl`: the native direction
 * differs, or (RTL wanted) the runtime still swaps left and right, which
 * swapLeftAndRightInRTL(false) only changes at the next start.
 */
export function needsReload(rtl: boolean): boolean {
  if (layoutIsRtl() !== rtl) return true;
  if (!rtl) return false;
  try {
    return I18nManager.getConstants().doLeftAndRightSwapInRTL === true;
  } catch {
    return false;
  }
}

/**
 * Restarts the JS runtime so the native flags take effect, toward `rtl`. A
 * second reload to the same direction within 60 s is refused: the first one
 * did not take, so another would loop. A reload back to the other direction is
 * a switch (de to he and back within a minute) and goes ahead.
 */
export async function reloadForDirection(
  reason: string,
  rtl: boolean,
): Promise<"reloading" | "guarded" | "failed"> {
  try {
    const now = Date.now();
    const dir = rtl ? "1" : "0";
    let last = 0;
    let lastDir: string | undefined;
    try {
      const [at, d] = String((await getItem(DIRECTION_RELOAD_KEY)) ?? "").split(":");
      last = Number(at) || 0;
      lastDir = d;
    } catch {
      /* an unreadable stamp means no recent reload we know of */
    }
    const sameDir = lastDir === undefined || lastDir === dir;
    if (sameDir && last > 0 && now - last >= 0 && now - last < DIRECTION_RELOAD_GUARD_MS) {
      Sentry.addBreadcrumb({
        category: "direction",
        level: "warning",
        message: "direction reload refused: one to the same direction ran less than 60 s ago",
        data: { reason, rtl, agoMs: now - last },
      });
      return "guarded";
    }
    try {
      await setItem(DIRECTION_RELOAD_KEY, `${now}:${dir}`);
    } catch {
      /* the guard is best effort */
    }
    await reloadAppAsync(reason);
    return "reloading";
  } catch (err) {
    console.error("[direction] reload failed:", err);
    return "failed";
  }
}

/** Test seam: pretend the native layout is RTL (true), LTR (false), or read it (null). */
export function __setLayoutRtlForTests(rtl: boolean | null): void {
  setLayoutOverride(rtl);
}
