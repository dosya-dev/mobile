import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Breathing room under a sheet's last row, before the safe area is added. */
const BASE_PAD = 16;

/**
 * Bottom padding for a sheet anchored to the bottom of the screen.
 *
 * The app draws edge-to-edge (`edgeToEdgeEnabled=true`, and Android 15 enforces
 * it for SDK 35 targets regardless), so the window extends underneath the system
 * navigation bar. A sheet with a fixed `pb-6` therefore puts its last row - the
 * one people reach for first, because it is nearest the thumb - behind the back
 * and home buttons.
 *
 * It is worst with three-button navigation, where the bar is ~48dp of opaque
 * chrome. Gesture navigation only reserves a thin hint, which is why this is
 * easy to miss on a test device set to gestures.
 *
 * A React Navigation SCREEN gets these insets applied for it. A `Modal` does
 * not: it renders in its own window, outside the navigator, so every sheet has
 * to ask for them itself.
 */
export function useSheetBottomPad(base: number = BASE_PAD): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + base;
}
