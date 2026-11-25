import { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import type { FileViewMode } from "./viewPrefs";

const SPRING = { damping: 14, stiffness: 220 };

/**
 * One button for the list/grid choice. It shows the layout a tap switches TO
 * (list icon while in grid, grid icon while in list). The two icons are stacked;
 * on a change the outgoing one turns away and shrinks while the incoming one
 * turns in from the other side, driven by one shared value 0 (list mode) to 1
 * (grid mode). Reduce Motion swaps them at once.
 */
export function ViewToggleButton({ mode, onToggle }: { mode: FileViewMode; onToggle(): void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const reduced = useReducedMotion();
  const target = mode === "grid" ? 1 : 0;
  const p = useSharedValue(target);

  useEffect(() => {
    p.value = reduced ? target : withSpring(target, SPRING);
  }, [target, reduced, p]);

  // Grid mode shows the list icon (p = 1); list mode shows the grid icon (p = 0).
  const listStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ rotate: `${(1 - p.value) * -90}deg` }, { scale: 0.6 + 0.4 * p.value }],
  }));
  const gridStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ rotate: `${p.value * 90}deg` }, { scale: 1 - 0.4 * p.value }],
  }));

  const toList = mode === "grid";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={toList ? t("files.action.listView") : t("files.action.gridView")}
      accessibilityState={{ selected: false }}
      hitSlop={8}
      onPress={onToggle}
      testID="view-toggle"
      style={{ width: 24, height: 24 }}
    >
      <Animated.View
        testID="view-toggle-icon-list"
        pointerEvents="none"
        style={[styles.layer, listStyle]}
        accessibilityElementsHidden={!toList}
        importantForAccessibility={toList ? "auto" : "no-hide-descendants"}
      >
        <Icon name="list" size={20} color={tokens.mutedForeground} />
      </Animated.View>
      <Animated.View
        testID="view-toggle-icon-grid"
        pointerEvents="none"
        style={[styles.layer, gridStyle]}
        accessibilityElementsHidden={toList}
        importantForAccessibility={toList ? "no-hide-descendants" : "auto"}
      >
        <Icon name="grid" size={18} color={tokens.mutedForeground} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
