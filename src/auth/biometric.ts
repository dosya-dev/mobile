import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { t } from "@/lib/i18n";

const PREF_KEY = "dosya.biometric";

export async function isBiometricAvailable(): Promise<boolean> {
  const [hw, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hw && enrolled;
}

/** Which picture and words to use: Face ID style, or a fingerprint. */
export async function biometricKind(): Promise<"face" | "fingerprint"> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync().catch((): LocalAuthentication.AuthenticationType[] => []);
  return types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? "face" : "fingerprint";
}

/**
 * `pinFallback`: an app PIN exists, so a failed or cancelled scan lands on the
 * dosya PIN pad instead of the phone's own passcode. Knowing the phone passcode
 * must not open dosya once it has a PIN of its own.
 */
export async function authenticateBiometric(opts: { pinFallback?: boolean } = {}): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: t("security.label.unlockDosyaDev"),
    ...(opts.pinFallback
      ? { disableDeviceFallback: true, fallbackLabel: t("security.action.usePin") }
      : {}),
  });
  return res.success;
}

export async function getBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PREF_KEY)) === "1";
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(PREF_KEY, "1");
  else await SecureStore.deleteItemAsync(PREF_KEY);
}
