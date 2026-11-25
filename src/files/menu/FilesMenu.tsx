import { useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "@/lib/i18n";
import { layoutIsRtl } from "@/lib/direction";
import { usePersonasEntry } from "@/personas/hooks";
import { useFilesMenu } from "./menuStore";
import { CLOSE_MS, MENU_WIDTH, OPEN_SPRING, REDUCED_MS, SCRIM_MAX, shouldClose, useFilesMenuProgress } from "./menuMotion";
import { FavouritesSection, GroupsSection, PLACE_COUNT, PlaceRows, ViewRows, WorkspaceCard, useMenuWorkspace } from "./MenuSections";

const CLOSE = { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) };
const FADE = { duration: REDUCED_MS };

/**
 * The Files left menu: a panel over the whole Files tab (tab bar included)
 * with a scrim, mounted once in the tabs layout. The shared progress (0..1)
 * drives the panel, the scrim and the tabs' shift; the edge swipe drives it
 * too while its finger is down (`dragging`). Rendered only while open or
 * animating. Reduce Motion: a 150 ms fade, nothing travels.
 */
export function FilesMenu() {
  const t = useT();
  const open = useFilesMenu((s) => s.open);
  const dragging = useFilesMenu((s) => s.dragging);
  const closeMenu = useFilesMenu((s) => s.closeMenu);
  const progress = useFilesMenuProgress();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const width = MENU_WIDTH(screenW);
  const sign = layoutIsRtl() ? -1 : 1;
  const [mounted, setMounted] = useState(open || dragging);

  useEffect(() => {
    if (dragging) {
      setMounted(true);
      return;
    }
    if (open) {
      setMounted(true);
      progress.value = reduced ? withTiming(1, FADE) : withSpring(1, OPEN_SPRING);
      return;
    }
    progress.value = withTiming(0, reduced ? FADE : CLOSE, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [open, dragging, reduced, progress]);

  // Android back closes the menu instead of leaving the screen behind it.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeMenu();
      return true;
    });
    return () => sub.remove();
  }, [open, closeMenu]);

  // Drag the panel towards its edge: it follows the finger, then closes past
  // 35% or on a flick, else springs back open.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          const dx = Math.min(0, e.translationX * sign);
          progress.value = Math.max(0, 1 + dx / width);
        })
        .onEnd((e) => {
          if (shouldClose(e.translationX * sign, e.velocityX * sign, width)) runOnJS(closeMenu)();
          else progress.value = reduced ? withTiming(1, FADE) : withSpring(1, OPEN_SPRING);
        })
        .withTestId("files-menu-pan"),
    [sign, width, progress, reduced, closeMenu],
  );

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * SCRIM_MAX }));
  const panelStyle = useAnimatedStyle(() =>
    reduced
      ? { opacity: progress.value }
      : // rtl-ok: mirrored (sign flips it in RTL; the panel sits at the start edge)
        { transform: [{ translateX: (progress.value - 1) * (width + 12) * sign }] },
  );

  const { activeId } = useMenuWorkspace();
  const personas = usePersonasEntry(activeId).visible;

  if (!mounted) return null;
  const live = open || dragging;
  const viewCount = 5 + (personas ? 1 : 0);
  return (
    <View
      testID="files-menu"
      style={StyleSheet.absoluteFill}
      pointerEvents={live ? "auto" : "none"}
      // Screen readers stay inside the menu (scrim included), and the escape
      // gesture closes it like a scrim tap.
      accessibilityViewIsModal
      onAccessibilityEscape={closeMenu}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, scrimStyle]} pointerEvents="none" />
      <Pressable
        testID="files-menu-scrim"
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={t("common.close")}
        onPress={closeMenu}
      />
      <GestureDetector gesture={pan}>
        <Animated.View
          className="bg-background"
          style={[
            { position: "absolute", top: 0, bottom: 0, start: 0, width, paddingTop: insets.top + 8 },
            { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 4 * sign, height: 0 }, elevation: 16 },
            panelStyle,
          ]}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} showsVerticalScrollIndicator={false}>
            <WorkspaceCard index={0} />
            <ViewRows index={1} personas={personas} />
            <View className="mx-5 my-2 h-px bg-border" />
            <PlaceRows index={1 + viewCount} />
            <FavouritesSection index={1 + viewCount + PLACE_COUNT} />
            <GroupsSection index={2 + viewCount + PLACE_COUNT} />
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
