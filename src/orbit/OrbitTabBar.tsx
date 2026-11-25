import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { OrbitButton, ORBIT_SIZE } from "./OrbitButton";
import { OrbitSheet } from "./OrbitSheet";
import { useTabBarHolds } from "./tabBarHold";

/**
 * The bottom of the app: a full-width bar of labelled tabs, split in two by
 * the orbit button in the middle.
 *
 * It replaced a floating pill with icon-only tabs and the button scooped into
 * its right end. That layout pushed the icons into the left three quarters of
 * the screen, left a padlock and a cloud to be guessed at, and hung a 56px
 * disc off a 48px bar. Here the tabs are named, the row is symmetric, and the
 * button is the one thing that breaks the bar's top edge.
 *
 * The bar sits in normal flow, so React Navigation insets every screen by its
 * height and a list ends where the bar begins - except for the strip the
 * button rises into. That strip is part of THIS view (Android drops touches
 * outside a parent's bounds, so a button lifted out of its parent would be
 * half dead there), but it must not cost the screen 20px: painted, it read as
 * an extra layer stacked on the bar whenever a list scrolled up to it. So the
 * whole view is pulled up over the screen by the strip's height, the strip is
 * left clear, and touches on its empty parts fall through to the screen.
 */

/** How far the button's ring rises above the bar's top edge. */
const RISE = 20;
/** The ring of page ground around the button that cuts it out of the bar. */
const RING = 4;

/** Adds an alpha channel to a `#rrggbb` token; anything else comes back unchanged. */
function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex + alpha : hex;
}

export function OrbitTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { tokens } = useColorTheme();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const held = useTabBarHolds((s) => s.holds.length > 0);
  if (held) return null;

  // The file viewer is full-bleed: tapping the stage is meant to leave nothing
  // but the file. The tabs layout expresses that by setting `display: "none"`
  // on `tabBarStyle`, which the stock bar honours for free - a custom bar has
  // to read it back itself or the viewer keeps its chrome.
  const focused = state.routes[state.index];
  const focusedOptions = descriptors[focused.key]?.options;
  const flat = StyleSheet.flatten(focusedOptions?.tabBarStyle) as { display?: string } | undefined;
  if (flat?.display === "none") return null;

  // The selected tab's indicator. `secondary` was the old one and it all but
  // vanished on `card` (#f4f4f4 on white); a tint of the foreground ink holds
  // its contrast in every theme and both schemes.
  const indicator = withAlpha(tokens.primary, "1A");

  const tabs = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const isFocused = state.index === index;
    const label = typeof options.tabBarLabel === "string" ? options.tabBarLabel : options.title ?? route.name;
    const color = isFocused ? tokens.primary : tokens.mutedForeground;

    const onPress = () => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    };

    return (
      <Pressable
        key={route.key}
        testID={`orbit-tab-${route.name}`}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
        style={{ flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 2 }}
      >
        <View
          testID={`orbit-tab-indicator-${route.name}`}
          style={{
            width: 52,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isFocused ? indicator : "transparent",
          }}
        >
          {options.tabBarIcon?.({ focused: isFocused, color, size: 22 })}
        </View>
        <Text
          numberOfLines={1}
          // Long translations ("Einstellungen") shrink a little rather than truncate.
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={1.3}
          // The accessibility label on the Pressable already names the tab.
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={{ fontSize: 11.5, color, fontWeight: isFocused ? "600" : "500" }}
        >
          {label}
        </Text>
      </Pressable>
    );
  });

  // The button takes the middle slot; with an odd count the extra tab goes first.
  const split = Math.ceil(tabs.length / 2);
  const ringSize = ORBIT_SIZE + RING * 2;

  return (
    <View
      testID="orbit-tab-bar"
      // Clear, and overlapping the screen by exactly its own top padding: the
      // screen's content runs on under the strip and only the button covers it.
      pointerEvents="box-none"
      style={{ marginTop: -RISE, paddingTop: RISE }}
    >
      <View
        testID="orbit-bar"
        style={{
          // The page's own ground, not `card`: a lighter fill read as a band
          // stacked under the screen. The hairline alone marks the edge.
          backgroundColor: tokens.background,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: tokens.border,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingHorizontal: 4,
          flexDirection: "row",
          alignItems: "flex-start",
        }}
      >
        {tabs.slice(0, split)}
        <View testID="orbit-button-slot" style={{ flex: 1 }} />
        {tabs.slice(split)}
      </View>

      {/* The button itself, centred over the empty middle slot and rising into
          the strip. A ring of page ground around it breaks the bar's top line
          so the line stops short of the disc instead of running behind it. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", top: 0, start: 0, end: 0, alignItems: "center" }}
      >
        <View
          testID="orbit-button-ring"
          style={{
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            padding: RING,
            backgroundColor: tokens.background,
          }}
        >
          <OrbitButton open={sheetOpen} onPress={() => setSheetOpen((o) => !o)} />
        </View>
      </View>

      <OrbitSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}
