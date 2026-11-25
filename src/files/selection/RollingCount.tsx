import { useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";

const ROLL = { duration: 200, easing: Easing.out(Easing.cubic) };
const SHIFT = 8;

/**
 * "N selected", where a change of N rolls: the old line slides up and fades
 * out while the new one comes in from below. Only the new line is read out.
 * `roll` false (the header is hidden or just appearing): the text just changes,
 * and so it does when the previous render was not rolling either - a count
 * that changes as the header fades in does not roll. Reduce Motion: no roll.
 */
export function RollingCount({ count, roll = true }: { count: number; roll?: boolean }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [prev, setPrev] = useState<number | null>(null);
  const last = useRef(count);
  const wasRolling = useRef(roll);
  const p = useSharedValue(1);

  // A layout effect: progress is back at 0 before the new number is painted,
  // so it never shows for a frame at full opacity first.
  useLayoutEffect(() => {
    const canRoll = roll && wasRolling.current && !reduced;
    wasRolling.current = roll;
    if (last.current === count) return;
    const from = last.current;
    last.current = count;
    if (!canRoll) {
      p.value = 1;
      setPrev(null);
      return;
    }
    setPrev(from);
    p.value = 0;
    p.value = withTiming(1, ROLL);
  }, [count, roll, reduced, p]);

  const inStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * SHIFT }] }));
  const outStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ translateY: -p.value * SHIFT }] }));

  return (
    <View className="flex-1 overflow-hidden">
      <Animated.View style={inStyle}>
        <Text testID="selection-count" className="text-base text-foreground" numberOfLines={1}>
          {t("files.label.countSelected", { count })}
        </Text>
      </Animated.View>
      {prev !== null && !reduced ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, outStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text className="text-base text-foreground" numberOfLines={1}>{t("files.label.countSelected", { count: prev })}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
