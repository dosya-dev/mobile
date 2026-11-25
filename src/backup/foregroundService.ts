import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

interface DosyaBackupServiceModule {
  start(text: string): void;
  update(text: string, percent: number): void;
  stop(): void;
}

/**
 * Android-only. Present in dev-client / release builds that include the local
 * module; absent in Expo Go and on iOS.
 *
 * Android stops a backup shortly after the screen locks unless a foreground
 * service is running, which is why a long first backup used to die in the
 * user's pocket. iOS has no equivalent: there the engine relies on
 * BGTaskScheduler plus the Live Activity.
 *
 * Every call here is best-effort. A backup must never fail because a
 * notification could not be shown - if POST_NOTIFICATIONS is denied the service
 * still runs, the user just does not see the progress.
 */
/** Resolved on use, not at import: the native registry is not guaranteed to be
 * populated when this module is first evaluated. */
function nativeModule(): DosyaBackupServiceModule | null {
  if (Platform.OS !== "android") return null;
  return requireOptionalNativeModule<DosyaBackupServiceModule>("DosyaBackupService");
}

/** True when a locked screen will not kill an in-progress backup. */
export function isBackupServiceAvailable(): boolean {
  return nativeModule() != null;
}

export function startBackupService(text: string): void {
  try {
    nativeModule()?.start(text);
  } catch {
    // Not linked, or the OS refused - the backup carries on regardless.
  }
}

/** `progress` is 0..1; the notification wants a whole percentage. */
export function updateBackupService(text: string, progress: number): void {
  const pct = Math.max(0, Math.min(100, Math.round((Number.isFinite(progress) ? progress : 0) * 100)));
  try {
    nativeModule()?.update(text, pct);
  } catch {
    // See above.
  }
}

export function stopBackupService(): void {
  try {
    nativeModule()?.stop();
  } catch {
    // See above.
  }
}
