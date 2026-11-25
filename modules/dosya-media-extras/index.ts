import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

interface MediaExtrasBackupNative {
  /**
   * iOS: set NSURLIsExcludedFromBackupKey on a file or directory (a directory's
   * contents follow it) and read it back. Resolves with the value now on disk.
   * Absent from builds made before offline files existed.
   */
  setExcludedFromBackup?(uri: string, excluded: boolean): Promise<boolean>;
}

/**
 * Keep a path out of iCloud and Finder backups.
 *
 * Null when the answer is unknown: not iOS (Android excludes through its backup
 * rules - plugins/withOfflineBackupRules.js), no native module (Expo Go, jest),
 * or a JS bundle newer than the installed binary. The caller decides how loud
 * an unknown should be; this never throws.
 */
export async function setExcludedFromBackup(uri: string, excluded = true): Promise<boolean | null> {
  if (Platform.OS !== "ios") return null;
  const native = requireOptionalNativeModule<MediaExtrasBackupNative>("DosyaMediaExtras");
  if (!native || typeof native.setExcludedFromBackup !== "function") return null;
  try {
    return await native.setExcludedFromBackup(uri, excluded);
  } catch {
    return false;
  }
}

interface MediaExtrasAirPlayNative {
  /** iOS: open the system AirPlay picker. Absent from builds made before casting. */
  showAirPlayPicker?(preferVideo: boolean): Promise<boolean>;
}

/**
 * Open iOS's AirPlay picker. False when it could not be shown: not iOS, or a
 * binary older than the picker bridge, where the caller points the user at
 * Control Center instead.
 */
export async function showAirPlayPicker(preferVideo: boolean): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const native = requireOptionalNativeModule<MediaExtrasAirPlayNative>("DosyaMediaExtras");
  if (!native || typeof native.showAirPlayPicker !== "function") return false;
  try {
    return await native.showAirPlayPicker(preferVideo);
  } catch {
    return false;
  }
}
