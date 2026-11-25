import Constants from "expo-constants";
import * as Application from "expo-application";

/**
 * The version string Settings shows: `1.0.1 (36)`.
 *
 * Both halves are read from expo-application - that is, from the INSTALLED
 * binary's Info.plist / AndroidManifest - and not from app.config.ts. That
 * distinction is the entire reason this helper exists.
 *
 * eas.json sets `appVersionSource: "remote"`, so EAS owns the build number:
 * it is assigned server-side at build time and written into the native
 * project, never into this repo. The literals still sitting in app.config.ts
 * (`ios.buildNumber: "1"`, `android.versionCode: 1`) are inert, so a screen
 * that read `Constants.expoConfig` would tell every user they are on build 1
 * forever - the same trap the sideload update check documents in
 * src/update/runtime.ts, where reading the stale literal would have reported
 * an update available on every launch.
 *
 * `nativeApplicationVersion` is CFBundleShortVersionString on iOS and
 * versionName on Android; `nativeBuildVersion` is CFBundleVersion and
 * versionCode respectively (a string on both platforms).
 *
 * Both are null where there is no native binary - Expo Go, web, jest - which
 * is why the config version is the fallback for the marketing version and the
 * build number is dropped entirely rather than rendered as "(null)".
 */
export function getDisplayVersion(): string | null {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
  if (!version) return null;
  const build = Application.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}
