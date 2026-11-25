import { useMemo, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { layoutIsRtl } from "@/lib/direction";
import { useFilesMenu } from "./menuStore";
import { useFilesInteraction } from "./interactionStore";
import { EDGE_ZONE, MENU_WIDTH, shouldOpen, useFilesMenuProgress } from "./menuMotion";

function endDrag(willOpen: boolean) {
  const s = useFilesMenu.getState();
  // One update: `open` and `dragging` land together, so the menu springs on
  // from where the finger left it (or falls closed) without a frame between.
  useFilesMenu.setState({ dragging: false, open: willOpen ? true : s.open });
}

/**
 * Wraps the Files root: a pan that can only begin in the 24 pt strip at the
 * menu's edge (via hitSlop, so no view covers the list) pulls the menu out
 * under the finger. Off while the browser is selecting or dragging a file.
 * The Files root is the stack root, so this never meets the iOS back swipe.
 */
export function MenuEdgeSwipe({ children }: { children: ReactNode }) {
  const busy = useFilesInteraction((s) => s.busy);
  const open = useFilesMenu((s) => s.open);
  const setDragging = useFilesMenu((s) => s.setDragging);
  const progress = useFilesMenuProgress();
  const { width: screenW } = useWindowDimensions();
  const width = MENU_WIDTH(screenW);
  const sign = layoutIsRtl() ? -1 : 1;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!busy && !open)
        // rtl-ok: mirrored (the strip is on the left in LTR, on the right in RTL)
        .hitSlop(sign > 0 ? { left: 0, width: EDGE_ZONE } : { right: 0, width: EDGE_ZONE })
        // Only a move away from the edge starts it; a vertical move lets the list scroll.
        .activeOffsetX(sign > 0 ? [-10000, 10] : [-10, 10000])
        .failOffsetY([-15, 15])
        .onStart(() => {
          runOnJS(setDragging)(true);
        })
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, (e.translationX * sign) / width));
        })
        // onFinalize, not onEnd: it also runs when the pan is cancelled, so
        // `dragging` can never be left on. It also runs for a pan that only
        // began and then failed (a vertical scroll flick from the strip):
        // that one must never open the menu, whatever its velocity.
        .onFinalize((e, success) => {
          runOnJS(endDrag)(success && shouldOpen(e.translationX * sign, e.velocityX * sign, width));
        })
        .withTestId("files-menu-edge"),
    [busy, open, sign, width, progress, setDragging],
  );

  return (
    <GestureDetector gesture={gesture}>
      <View className="flex-1" collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}
