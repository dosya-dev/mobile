import type { View } from "react-native";

/**
 * Window-coordinate rectangle of a mounted view. Its own module so tests can
 * hand the drag fixed rectangles: under jest a host view's measureInWindow is
 * a no-op mock whose callback never fires.
 */
export function measureInWindow(view: View, cb: (x: number, y: number, width: number, height: number) => void): void {
  view.measureInWindow(cb);
}
