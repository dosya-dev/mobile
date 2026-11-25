import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

/**
 * The Files left menu's motion, in one place so the menu, the edge swipe and
 * the tabs layout's 18 pt shift all read the same numbers. Values are the
 * approved ones from the design (docs/superpowers/specs/2026-11-02-mobile-files-menu-design.md).
 */

/** The panel: 80% of the screen, never wider than 340 pt. */
export function MENU_WIDTH(screenW: number): number {
  "worklet";
  return Math.min(340, screenW * 0.8);
}

/** Open: no overshoot, settles in about 360 ms. */
export const OPEN_SPRING = { damping: 26, stiffness: 260, mass: 1, overshootClamping: true } as const;
/** Close: a timing with ease-in (Easing.in(Easing.cubic)). */
export const CLOSE_MS = 240;
/** Reduce Motion: a plain fade of scrim and panel, nothing travels. */
export const REDUCED_MS = 150;
/** Scrim opacity when fully open. */
export const SCRIM_MAX = 0.38;
/** How far the screen behind moves away from the menu while it opens. */
export const SHIFT = 18;
/** The strip at the screen's edge where the swipe that opens the menu may start. */
export const EDGE_ZONE = 24;
/** Delay between rows entering on open. */
export const ROW_STAGGER_MS = 20;

/**
 * After dragging the open panel: close when released past 35% of its width
 * or flicked towards the edge faster than 500 pt/s. `dx` and `vx` are measured
 * towards the menu's own edge as negative (callers flip them in right-to-left).
 */
export function shouldClose(dx: number, vx: number, width: number): boolean {
  "worklet";
  return dx < -0.35 * width || vx < -500;
}

/** The edge swipe's mirror of shouldClose: open past 35%, or on a flick outwards, unless flicked back. */
export function shouldOpen(dx: number, vx: number, width: number): boolean {
  "worklet";
  if (vx < -500) return false;
  return dx > 0.35 * width || vx > 500;
}

/**
 * 0 = closed, 1 = open. Owned by the tabs layout (it shifts the tabs with it);
 * the menu and the edge swipe drive it.
 */
export const FilesMenuProgressContext = createContext<SharedValue<number> | null>(null);

export function useFilesMenuProgress(): SharedValue<number> {
  const progress = useContext(FilesMenuProgressContext);
  if (!progress) throw new Error("useFilesMenuProgress outside FilesMenuProgressContext");
  return progress;
}
