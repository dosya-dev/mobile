// The grab area at the top of a bottom sheet: the grabber bar plus whatever
// the caller puts under it (a title, a header row). A drag down on it closes
// the sheet; a tap does nothing.
//
// The drag runs on PanResponder from React Native core, as the viewer's sheet
// does it (a transparent Modal has no swipe of its own, and gesture-handler
// needs its own root view inside a Modal). The one thing that makes it work
// inside a sheet whose body is a Pressable: the handle claims the touch at
// touch START (onStartShouldSetPanResponder). The start question bubbles from
// the deepest view up, so the handle wins over the Pressable around it; a
// handle that only answered on MOVE would never be asked, because once the
// Pressable is the responder the move negotiation skips its descendants.
// Controls placed inside the handle (a Cancel button) are deeper still, so
// they keep their taps.
import { useMemo, useRef, type ReactNode } from "react";
import { PanResponder, View } from "react-native";

/** How far a drag down has to travel before it counts as a dismissal. */
export const SHEET_DISMISS_DY = 40;

/** A released drag closes the sheet when it went down this far. */
export function dragDismisses(dy: number): boolean {
  return dy > SHEET_DISMISS_DY;
}

export interface SheetHandleProps {
  /** Called when a drag down was released past SHEET_DISMISS_DY. */
  onDismiss: () => void;
  /** Rendered under the grabber bar, inside the grab area. */
  children?: ReactNode;
  className?: string;
  testID?: string;
}

export function SheetHandle({ onDismiss, children, className, testID }: SheetHandleProps) {
  // A ref mirror keeps the responder off the dependency treadmill: it is
  // created once and reads the current callback through the ref.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_e, g) => { if (dragDismisses(g.dy)) dismissRef.current(); },
  }), []);
  return (
    <View className={className ?? "px-5 pt-2"} testID={testID} {...pan.panHandlers}>
      <View className="items-center pb-1">
        <View className="h-1 w-10 rounded-full bg-border" />
      </View>
      {children}
    </View>
  );
}
