import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The sign-in stack.
 *
 * Signing in is a sequence - login leads to two-factor, or to forgot-password
 * and back - so the screen that arrives says which way you moved: a push comes
 * in from the right, a pop returns the way it came. That direction is the whole
 * reason this flow gets motion at all; it is rare-tier, unlike the tabs behind
 * it, which a user opens dozens of times a day and which stay instant.
 *
 * This is the native stack's own animation rather than anything hand-written,
 * so it runs off the JS thread, survives a slow render, and follows the
 * interactive back gesture frame for frame. The desktop app mirrors it in CSS
 * (see `.auth-step` in apps/desktop) so the two products feel like one.
 */
export default function AuthLayout() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {
        // The query is best-effort; failing it should never block sign-in.
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Reduced motion keeps a fade rather than dropping to "none": the
        // change still needs to read as a new step, it just stops travelling.
        animation: reduceMotion ? "fade" : "slide_from_right",
      }}
    />
  );
}
