import { useAnimatedStyle, useReducedMotion, withSpring } from "react-native-reanimated";

const SPRING = { damping: 18, stiffness: 260 };
/** rounded-lg, the tile's resting corner. */
const REST_RADIUS = 8;
const SELECTED_RADIUS = 10;
const SELECTED_SCALE = 0.88;

/**
 * A selected grid tile's content shrinks to 0.88 with its corners rounding to
 * 10, on a spring. Reduce Motion: the corners still round, nothing scales.
 * `restRadius`: the tile's corner when not selected (a library photo tile is
 * square, 0; everything else is rounded-lg).
 */
export function useSelectedScale(selected: boolean, restRadius: number = REST_RADIUS) {
  const reduced = useReducedMotion();
  return useAnimatedStyle(() => {
    const radius = selected ? SELECTED_RADIUS : restRadius;
    if (reduced) return { borderRadius: radius, transform: [{ scale: 1 }] };
    return {
      borderRadius: withSpring(radius, SPRING),
      transform: [{ scale: withSpring(selected ? SELECTED_SCALE : 1, SPRING) }],
    };
  });
}
