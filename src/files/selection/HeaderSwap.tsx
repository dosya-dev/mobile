import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSelectionMotion } from "./SelectionMotion";

const SHIFT = 8;

/**
 * The header slot while selection mode turns on and off: the normal content
 * fades and slides up 8 pt as the selection header fades in from 8 pt below,
 * both following the motion's `progress` (Reduce Motion: progress jumps, so
 * the swap is instant). Both stay mounted; the hidden one takes no touches and
 * is out of the accessibility tree. The slot keeps the normal content's height.
 */
export function HeaderSwap({ selecting, normal, selection }: { selecting: boolean; normal: ReactNode; selection: ReactNode }) {
  const { progress } = useSelectionMotion();
  const normalStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -progress.value * SHIFT }],
  }));
  const selectionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * SHIFT }],
  }));
  return (
    <View>
      <Animated.View
        style={normalStyle}
        pointerEvents={selecting ? "none" : "auto"}
        accessibilityElementsHidden={selecting}
        importantForAccessibility={selecting ? "no-hide-descendants" : "auto"}
      >
        {normal}
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.center, selectionStyle]}
        pointerEvents={selecting ? "auto" : "none"}
        accessibilityElementsHidden={!selecting}
        importantForAccessibility={selecting ? "auto" : "no-hide-descendants"}
      >
        {selection}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { justifyContent: "center" } });
