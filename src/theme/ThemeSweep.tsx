import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { layoutIsRtl } from "@/lib/direction";

/** Per phase. Cover + uncover together match the web wipe's 520ms. */
export const SWEEP_MS = 260;
const EASING = Easing.bezier(0.65, 0, 0.35, 1);

type Runner = (color: string, apply: () => void) => void;
let runner: Runner | null = null;

/**
 * Wipe a theme change in from the left instead of snapping to it.
 *
 * Web does this with the View Transitions API, which has no React Native
 * equivalent - there is no page snapshot to clip, and re-theming happens by
 * re-rendering the tree rather than by swapping a stylesheet. So a band of the
 * DESTINATION background colour crosses the screen instead: it slides in from
 * the left (cover), the theme is applied while the band hides the re-render,
 * then the band exits right (uncover), revealing the new theme from the left
 * edge. Both phases travel left to right, so it reads as a single pass.
 *
 * Applies instantly when no overlay is mounted (tests, early boot) or when the
 * OS Reduce Motion setting is on - same escape hatches as the web version.
 *
 * Right to left: the band travels from the start edge to the end edge, so it
 * enters from the right and leaves to the left. translateX is physical, so
 * both the start and the exit value are negated.
 */
export function sweepTheme(color: string, apply: () => void): void {
  if (runner) runner(color, apply);
  else apply();
}

/**
 * The band itself. Mounted once by ThemeProvider, above the app - it registers
 * the module-level runner that sweepTheme() calls.
 */
export function ThemeSweepOverlay() {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const [color, setColor] = useState<string | null>(null);
  const reduceMotion = useRef(false);
  // Read on the UI thread's callback path, so keep them in refs rather than
  // closing over a render's values.
  const widthRef = useRef(width);
  widthRef.current = width;
  const pending = useRef<(() => void) | null>(null);
  // +1 travels left to right, -1 right to left. Fixed for the life of a runtime.
  const dir = layoutIsRtl() ? -1 : 1;
  const dirRef = useRef(dir);
  dirRef.current = dir;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) reduceMotion.current = on; })
      .catch(() => { /* unavailable: keep animating */ });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      reduceMotion.current = on;
    });
    return () => { alive = false; sub.remove(); };
  }, []);

  const hide = useCallback(() => setColor(null), []);

  // Runs with the screen fully covered: swap the theme, give React a frame to
  // commit it, then pull the band off to the right.
  const applyAndUncover = useCallback(() => {
    const apply = pending.current;
    pending.current = null;
    apply?.();
    requestAnimationFrame(() => {
      x.value = withTiming(dirRef.current * widthRef.current, { duration: SWEEP_MS, easing: EASING }, () => {
        "worklet";
        runOnJS(hide)();
      });
    });
  }, [hide, x]);

  useEffect(() => {
    runner = (next, apply) => {
      if (reduceMotion.current) { apply(); return; }
      // The callback fires even on an interrupted animation, and it applies
      // unconditionally: a swallowed theme change would be far worse than a
      // clipped animation.
      pending.current = apply;
      x.value = -dirRef.current * widthRef.current;
      setColor(next);
      x.value = withTiming(0, { duration: SWEEP_MS, easing: EASING }, () => {
        "worklet";
        runOnJS(applyAndUncover)();
      });
    };
    return () => { runner = null; };
  }, [applyAndUncover, x]);

  // rtl-ok: mirrored (start and exit values are negated in RTL above)
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (color === null) return null;
  return (
    <Animated.View
      testID="theme-sweep"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]}
    />
  );
}
