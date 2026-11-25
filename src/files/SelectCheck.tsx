import { memo } from "react";
import Animated, { useAnimatedStyle, useReducedMotion, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { staggerDelay, useSelectionMotion } from "./selection/SelectionMotion";

const POP = { damping: 12, stiffness: 300 };
const FADE = { duration: 160 };

/**
 * The tick shown on every row and card while selection mode is on. It is
 * not itself pressable: the whole row toggles, so the target is the row's
 * full width rather than a 20pt circle.
 *
 * It pops in (scale 0.4 -> 1, opacity 0 -> 1) when selection mode turns on,
 * driven by the one shared `active` value every check reads, delayed by its
 * place in the on-screen wave (`row`/`col`; without them it pops at once).
 * Leaving reverses it with no wave: `active` goes to 0 and the check stays
 * mounted (the tile's `checks` prop) until the fade is over.
 * Reduce Motion: no wave, no scale, it is just there.
 */
export const SelectCheck = memo(function SelectCheck({ selected, testID, overlay = false, row, col = 0 }: {
  selected: boolean; testID: string; overlay?: boolean;
  /** Visual row and column in the list, for the entrance wave. */
  row?: number; col?: number;
}) {
  const { tokens } = useColorTheme();
  const reduced = useReducedMotion();
  const { active, firstVisibleRow, visibleRows } = useSelectionMotion();
  const style = useAnimatedStyle(() => {
    const on = active.value;
    if (reduced) return { opacity: on, transform: [{ scale: 1 }] };
    const delay = on && row !== undefined ? staggerDelay(row, col, firstVisibleRow.value, visibleRows.value) : 0;
    return {
      opacity: withDelay(delay, withTiming(on, FADE)),
      transform: [{ scale: withDelay(delay, withSpring(on ? 1 : 0.4, POP)) }],
    };
  });
  return (
    <Animated.View
      testID={testID}
      accessibilityState={{ checked: selected }}
      pointerEvents="none"
      className={overlay ? "absolute start-1 top-1 rounded-full bg-black/40 p-0.5" : undefined}
      style={style}
    >
      <Icon
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={overlay ? 20 : 22}
        color={selected ? tokens.primary : overlay ? "#ffffff" : tokens.mutedForeground}
      />
    </Animated.View>
  );
});
