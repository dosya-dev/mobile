import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";

/** Width of a revealed action button. */
const ACTION_W = 88;
/** A swipe shorter than this snaps back and reveals nothing. */
const REVEAL_MIN = 40;
/** Past this share of the row's width the swipe commits on release, no tap needed. */
const COMMIT_SHARE = 0.55;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 };

/**
 * Mail-style row swipes for the file list. Swipe right reveals Select (left
 * side), swipe left reveals Delete (right side); a short swipe parks the
 * button for a tap, a long swipe past COMMIT_SHARE commits as the finger
 * lifts. Only the sides with an action respond, and nothing moves while
 * disabled (selection mode, or a drag being armed).
 *
 * Its own pan rather than gesture-handler's Swipeable: the commit-on-release
 * rule and a testable gesture id are easier to own than to retrofit.
 */
export function SwipeRow({ id, children, onSelect, onDelete, enabled = true, width: widthProp }: {
  id: string;
  children: ReactNode;
  /** Swipe right. Absent: that side does not move. */
  onSelect?: () => void;
  /** Swipe left. Absent: that side does not move. */
  onDelete?: () => void;
  enabled?: boolean;
  /** Row width, for the commit distance; measured when not given. */
  width?: number;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const tx = useSharedValue(0);
  const openSide = useSharedValue<0 | 1 | -1>(0);
  const pastCommit = useSharedValue(false);
  const width = useSharedValue(widthProp ?? 360);
  const [revealed, setRevealed] = useState<"left" | "right" | null>(null);
  const measured = useRef(false);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    if (widthProp !== undefined) return;
    measured.current = true;
    width.value = e.nativeEvent.layout.width;
  }, [width, widthProp]);

  const tick = useCallback(() => { void Haptics.selectionAsync().catch(() => {}); }, []);

  const commit = useCallback((side: 1 | -1) => {
    if (side === 1) onSelect?.(); else onDelete?.();
  }, [onDelete, onSelect]);

  const close = useCallback(() => {
    tx.value = withSpring(0, SPRING);
    openSide.value = 0;
    setRevealed(null);
  }, [openSide, tx]);

  const park = useCallback((side: 1 | -1) => {
    setRevealed(side === 1 ? "left" : "right");
  }, []);

  const hasLeft = !!onSelect;
  const hasRight = !!onDelete;

  const pan = useMemo(() => Gesture.Pan()
    .withTestId(`swipe-${id}`)
    .enabled(enabled && (hasLeft || hasRight))
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .maxPointers(1)
    .onUpdate((e) => {
      "worklet";
      const base = openSide.value * ACTION_W;
      let next = base + e.translationX;
      if (!hasLeft) next = Math.min(next, 0);
      if (!hasRight) next = Math.max(next, 0);
      // Resist past the row's own width: the gesture has made its point.
      const limit = width.value;
      if (next > limit) next = limit + (next - limit) * 0.15;
      if (next < -limit) next = -limit + (next + limit) * 0.15;
      tx.value = next;
      const past = Math.abs(next) >= width.value * COMMIT_SHARE;
      if (past !== pastCommit.value) {
        pastCommit.value = past;
        if (past) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      "worklet";
      const v = tx.value;
      const side: 1 | -1 = v > 0 ? 1 : -1;
      if (Math.abs(v) >= width.value * COMMIT_SHARE) {
        openSide.value = 0;
        pastCommit.value = false;
        tx.value = withTiming(0, { duration: 180 });
        runOnJS(commit)(side);
        runOnJS(park)(side);
        runOnJS(close)();
        return;
      }
      if (Math.abs(v) >= REVEAL_MIN) {
        openSide.value = side;
        tx.value = withSpring(side * ACTION_W, SPRING);
        runOnJS(park)(side);
        return;
      }
      openSide.value = 0;
      tx.value = withSpring(0, SPRING);
      runOnJS(close)();
    })
    .onFinalize((_e, success) => {
      "worklet";
      if (success) return;
      pastCommit.value = false;
      tx.value = withSpring(openSide.value * ACTION_W, SPRING);
    }), [close, commit, enabled, hasLeft, hasRight, id, openSide, park, pastCommit, tick, tx, width]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] })); // rtl-ok: mirrored (the sides are mirrored by the layout direction, the translation follows the finger)
  const leftStyle = useAnimatedStyle(() => ({ opacity: tx.value > 0 ? 1 : 0 }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: tx.value < 0 ? 1 : 0 }));

  return (
    <View onLayout={onLayout} testID={`swipe-row-${id}`} accessibilityState={{ expanded: revealed !== null }}>
      {/* Parked buttons are the only ones a screen reader (or a query) should see. */}
      {hasLeft ? (
        <Animated.View
          pointerEvents={revealed === "left" ? "auto" : "none"}
          accessibilityElementsHidden={revealed !== "left"}
          importantForAccessibility={revealed === "left" ? "auto" : "no-hide-descendants"}
          className="absolute inset-y-0 start-0 flex-row"
          style={leftStyle}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("files.action.select")}
            testID={`swipe-select-${id}`}
            onPress={() => { commit(1); close(); }}
            className="items-center justify-center bg-primary"
            style={{ width: ACTION_W }}
          >
            <Icon name="checkmark-circle-outline" size={22} color={tokens.primaryForeground} />
            <Text className="mt-1 text-xs text-primary-foreground">{t("files.action.select")}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      {hasRight ? (
        <Animated.View
          pointerEvents={revealed === "right" ? "auto" : "none"}
          accessibilityElementsHidden={revealed !== "right"}
          importantForAccessibility={revealed === "right" ? "auto" : "no-hide-descendants"}
          className="absolute inset-y-0 end-0 flex-row"
          style={rightStyle}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.delete")}
            testID={`swipe-delete-${id}`}
            onPress={() => { commit(-1); close(); }}
            className="items-center justify-center bg-destructive"
            style={{ width: ACTION_W }}
          >
            <Icon name="trash-outline" size={22} color="#ffffff" />
            <Text className="mt-1 text-xs text-white">{t("common.delete")}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View className="bg-background" style={rowStyle}>
          {/* A tap on the row while a button is parked only closes it. */}
          {revealed ? <Pressable className="absolute inset-0 z-10" onPress={close} testID={`swipe-close-${id}`} /> : null}
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
