import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Application from "expo-application";
import type { DistributionChannel } from "./sideloadUpdate";

/**
 * Runtime facts the update check needs, kept apart from the check itself so
 * the decision logic stays a pure function with no native modules to stub.
 */

/**
 * How this binary reached the device, as baked in by app.config.ts.
 *
 * Anything other than the exact string "direct" is treated as a store build.
 * That asymmetry is deliberate and load-bearing: see the long comment on
 * `distributionChannel` in app.config.ts. A missing or misspelled value must
 * disable the update check, never enable it.
 */
export function getDistributionChannel(): DistributionChannel {
  const extra = Constants.expoConfig?.extra as { distributionChannel?: unknown } | undefined;
  return extra?.distributionChannel === "direct" ? "direct" : "play";
}

/**
 * This build's Android versionCode.
 *
 * Read from expo-application rather than `Constants.expoConfig.android
 * .versionCode`, because eas.json sets `appVersionSource: "remote"` - EAS
 * assigns the real versionCode server-side at build time and writes it into
 * the native project, never into the JS-visible config. app.config.ts no
 * longer carries a versionCode literal at all (it was inert, and reading it
 * would have reported an update available on every launch forever), so that
 * config path is now `undefined` rather than merely stale.
 *
 * `nativeBuildVersion` is a string on both platforms (it is iOS's
 * CFBundleVersion there), so it is parsed rather than trusted, and anything
 * unparseable returns null - which the caller treats as "cannot check".
 */
export function getInstalledVersionCode(): number | null {
  if (Platform.OS !== "android") return null;
  const raw = Application.nativeBuildVersion;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
