import type { View } from "react-native";
import type { ComposedGesture, GestureType } from "react-native-gesture-handler";

/**
 * What a row or card needs from useDragMove to be a drag source: a composed
 * gesture (hold, then pan) for a GestureDetector around its root view. The
 * Pressable inside keeps the tap and accessibility; see useDragMove.ts.
 */
export interface DragHandle {
  gesture: ComposedGesture | GestureType;
  /** The gesture test id prefix, `drag-<kind>-<id>` for the pan and `hold-<kind>-<id>` for the long press. */
  key: string;
}

/** Registers a folder's root view as a drop target, so the drag can hit-test it. */
export type DropTargetRef = (view: View | null) => void;
