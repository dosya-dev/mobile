import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * How far the keyboard covers the bottom of the screen, beyond the safe-area
 * inset the screen already keeps clear. Pad a screen's body by it to keep a
 * bottom composer above the keyboard.
 *
 * The platforms report the keyboard differently: iOS gives its full height,
 * which includes the home-indicator area the screen's bottom inset already
 * clears, so that inset comes off. Android (edge to edge) reports the height
 * above the navigation bar, so taking the inset off again left the composer
 * one navigation bar short, still under the keyboard (seen on a Galaxy A06).
 *
 * Why not KeyboardAvoidingView: Android apps on Expo 54 draw edge to edge, so
 * the window no longer shrinks for the keyboard (adjustResize does nothing),
 * and a KeyboardAvoidingView with a behavior on iOS only left the composer
 * under the keyboard on Android. This works the same on both platforms.
 */
export function useKeyboardLift(): number {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return Math.max(0, Platform.OS === "ios" ? height - insets.bottom : height);
}
