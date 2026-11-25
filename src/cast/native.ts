import { NativeModules } from "react-native";

type GoogleCast = typeof import("react-native-google-cast");

/**
 * JS face of react-native-google-cast, resolved lazily.
 *
 * The library reads its native modules at import time and builds event
 * emitters over them, which throws in a binary that does not carry the Cast
 * SDK: every dev client built before casting existed, and jest. So nothing in
 * the app imports it directly; this returns null there and the Cast row simply
 * does not appear.
 */
let cached: GoogleCast | null | undefined;

export function googleCast(): GoogleCast | null {
  if (cached === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = NativeModules.RNGCCastContext ? (require("react-native-google-cast") as GoogleCast) : null;
  }
  return cached;
}
