import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/ui/Icon";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useT } from "@/lib/i18n";
import { CHROME_BOTTOM_GAP, CHROME_BUTTON, CHROME_TOP_GAP } from "./chromeLayout";

/** Long enough to read as a fade, short enough that the chrome still feels instant to a tap. */
const FADE_MS = 180;
/** How far each button travels on entry. Small - this is a settle, not a slide-in. */
const TRAVEL = 10;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Floating chrome over the reader page: a circular close button (top right)
 * and a circular menu button (bottom right), both inset for the safe area.
 *
 * Both buttons stay MOUNTED at all times and cross-fade instead of appearing
 * and disappearing outright, which is what makes the show/hide feel smooth.
 * That costs the one thing an `if (!visible) return null` would give for
 * free - an unmounted button cannot intercept a touch - so `pointerEvents`
 * is driven off the same flag: while hidden, taps must fall through to the
 * page underneath, not land on an invisible button.
 *
 * There is no auto-hide timer. The reader decides when the chrome goes
 * away from what the person does (a tap on the page, a swipe, a page turn -
 * see bridge.ts's decideTap), so a control never vanishes from under a
 * finger that was reaching for it. Presentational only.
 *
 * Styled with a StyleSheet, deliberately not `className`: NativeWind only
 * rewrites className on the component types it has registered, and the
 * reanimated wrapper is a new, unregistered type, so a className here is
 * silently dropped. That once left both buttons unpositioned - the X laid
 * out below the bottom edge of the screen, the menu a bare white glyph at
 * the bottom-left - with every corner tap turning a page instead. Jest
 * cannot catch that (NativeWind skips registration under NODE_ENV=test),
 * which is why ReaderChrome.test.tsx asserts the resolved style.
 */
export function ReaderChrome(props: { visible: boolean; onClose: () => void; onOpenMenu: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(props.visible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(props.visible ? 1 : 0, { duration: FADE_MS });
  }, [props.visible, progress]);

  // The top button drops in from above and the bottom one rises from below, so
  // the pair reads as chrome settling onto the page rather than two unrelated
  // dots blinking on.
  const closeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -TRAVEL }],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * TRAVEL }],
  }));

  const hitState = props.visible ? "auto" : "none";

  return (
    <>
      <AnimatedPressable
        testID="reader-close"
        accessibilityRole="button"
        accessibilityLabel={t("reader.action.closeBook")}
        accessibilityElementsHidden={!props.visible}
        importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
        hitSlop={10}
        pointerEvents={hitState}
        onPress={props.onClose}
        style={[styles.button, { top: insets.top + CHROME_TOP_GAP }, closeStyle]}
      >
        <Icon name="close" size={21} color="#fff" />
      </AnimatedPressable>
      <AnimatedPressable
        testID="reader-menu"
        accessibilityRole="button"
        accessibilityLabel={t("reader.action.readingSettings")}
        accessibilityElementsHidden={!props.visible}
        importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
        hitSlop={10}
        pointerEvents={hitState}
        onPress={props.onOpenMenu}
        style={[styles.button, { bottom: insets.bottom + CHROME_BOTTOM_GAP }, menuStyle]}
      >
        <Icon name="ellipsis-horizontal" size={21} color="#fff" />
      </AnimatedPressable>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    end: 16,
    width: CHROME_BUTTON,
    height: CHROME_BUTTON,
    borderRadius: CHROME_BUTTON / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
});
