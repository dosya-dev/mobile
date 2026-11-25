import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { t } from "@/lib/i18n";
import { registerPushDevice, unregisterPushDevice } from "./api";

export type PushRegisterResult =
  | { kind: "registered"; token: string }
  | { kind: "denied" }
  | { kind: "unsupported"; reason: string };

/**
 * How far a sync may go to obtain permission.
 *
 * - "silent": register only if the OS already allows it. Never prompts.
 * - "prompt-once": prompt the first time this device is asked, then behave
 *   as "silent" for good. What a new session uses (app/_layout.tsx).
 * - "prompt": prompt whenever the OS still lets us. The notification-settings
 *   switch, where the user has just asked for exactly this.
 */
export type PushSyncMode = "silent" | "prompt-once" | "prompt";

/** Device-wide, not per account: the OS prompt is per app install. */
export const PUSH_PROMPTED_KEY = "dosya.push.prompted";

/**
 * Expo needs the EAS project id to mint a token. It's absent until the project is
 * linked to EAS, and without it getExpoPushTokenAsync throws - so surface that as
 * "unsupported" rather than an opaque crash.
 */
function easProjectId(): string | undefined {
  const c = Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId;
}

async function alreadyPrompted(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PUSH_PROMPTED_KEY)) === "1";
  } catch {
    // Unreadable store: treat as prompted. Losing one prompt is cheaper than
    // a prompt on every launch on a device whose store never answers.
    return true;
  }
}

async function markPrompted(): Promise<void> {
  try {
    await SecureStore.setItemAsync(PUSH_PROMPTED_KEY, "1");
  } catch {
    /* best-effort */
  }
}

/**
 * Bring this device's registration in line with the OS permission and the
 * current session. Safe to call repeatedly - the server upserts on the token
 * and re-points it at whoever is signed in.
 *
 * Until 2026-09-27 the only caller was the Push switch on the settings screen,
 * which already displayed as "on" for everyone. Nobody flipped it off and on
 * again, so production held no ios/android registration at all: every
 * server-side push to a phone was a query that returned no rows.
 */
export async function syncPushRegistration(mode: PushSyncMode = "silent"): Promise<PushRegisterResult> {
  // Simulators can't receive push; asking would just fail confusingly.
  if (!Device.isDevice) return { kind: "unsupported", reason: t("notifications.error.pushNeedsAPhysicalDevice") };

  const projectId = easProjectId();
  if (!projectId) {
    return { kind: "unsupported", reason: t("notifications.error.pushIsnTConfiguredForThisBuildNoEasProjectId") };
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const mayAsk = mode === "prompt" || (mode === "prompt-once" && !(await alreadyPrompted()));
    if (mayAsk) {
      if (mode === "prompt-once") await markPrompted();
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
  }
  if (!granted) return { kind: "denied" };

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const platform = Platform.OS === "ios" ? "ios" : "android";
  await registerPushDevice(token, platform, Device.deviceName ?? undefined);
  return { kind: "registered", token };
}

/**
 * Ask for permission and register this device's Expo push token with the server.
 * The settings switch's path: an explicit request, so it always prompts if it can.
 */
export function registerForPush(): Promise<PushRegisterResult> {
  return syncPushRegistration("prompt");
}

/** Stop delivery to this device. Best-effort: a missing token just means never registered. */
export async function unregisterForPush(): Promise<void> {
  const projectId = easProjectId();
  if (!projectId || !Device.isDevice) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await unregisterPushDevice(token);
  } catch {
    /* nothing registered */
  }
}
