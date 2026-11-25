import { Platform } from "react-native";

/**
 * react-native-carplay runs native-module side effects (NativeEventEmitter
 * construction, a bridge connectivity check) at import time and has no
 * Android build of the pieces this app uses. Every incar file that touches
 * CarPlay templates must go through here, never `require`/`import` the
 * package directly.
 */
export function isCarPlaySupported(): boolean {
  return Platform.OS === "ios";
}

let mod: typeof import("react-native-carplay") | null = null;

export function getCarPlayModule(): typeof import("react-native-carplay") {
  if (!isCarPlaySupported()) {
    throw new Error("CarPlay is iOS-only");
  }
  if (mod) return mod;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load, see module doc above
  const loaded: typeof import("react-native-carplay") = require("react-native-carplay");
  mod = loaded;
  return loaded;
}
