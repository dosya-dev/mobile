import { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

const PULSE_MS = 850;
/** About ten seconds, then a still block. An even count ends on the resting opacity. */
const PULSE_RUNS = 12;

/**
 * A pulsing block shown while a thumbnail loads.
 *
 * A grid of empty grey squares looks like a broken screen; the same grid
 * breathing looks like a screen that is working. It cannot make the bytes
 * arrive sooner, but a large photo library spends real seconds in this state
 * and the difference between "loading" and "broken" is the whole experience.
 *
 * Deliberately not a spinner per tile: twenty spinners on one screen is noise,
 * and a spinner promises progress this component cannot measure.
 *
 * Bounded because a load that hangs, or is cancelled off screen, leaves the tile
 * mounted, and an endless pulse would keep the display redrawing the whole time.
 */
export function ThumbSkeleton() {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.75, { duration: PULSE_MS }), PULSE_RUNS, true);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      testID="thumb-skeleton"
      pointerEvents="none"
      className="absolute inset-0 bg-secondary"
      style={style}
    />
  );
}
