import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { onLocaleChange, t } from "@/lib/i18n";
import { mapActionPath } from "./actionPath";

/**
 * Receiving and acting on SERVER pushes (the ones apps/api sends through Expo).
 * Local alerts - backup paused, backup finished with failures - live in
 * src/backup/alerts.ts and are untouched by this module.
 *
 * Two things were missing before this existed. No notification handler was
 * installed, so a push that arrived while the app was open was dropped on both
 * platforms. And the only response listener read `data.url`, the key the local
 * alerts use, while a server push carries `data.link_path` (a WEB route, see
 * actionPath.ts) - so tapping one opened the app and went nowhere.
 */

/**
 * The Android channel every server push names (apps/api's Expo sender sets
 * `channelId: "default"`). Created at HIGH importance so the OS raises a
 * heads-up and plays a sound; a channel Expo creates on the fly would get
 * DEFAULT importance, which is drawer-only.
 */
export const DEFAULT_CHANNEL = "default";

let started = false;
let subscription: { remove(): void } | null = null;
let stopLocaleWatch: (() => void) | null = null;
const routed = new Set<string>();

interface ResponseLike {
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
}

/** Where a tapped server push goes. Null for anything that is not a server push. */
export function destinationFor(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  // Server rows always carry the notification id; local alerts never do.
  const isServerPush = typeof data.id === "string" || typeof data.link_path === "string";
  if (!isServerPush) return null;
  // A link with no mobile equivalent still lands somewhere the user can read
  // the notice - the inbox - rather than doing nothing.
  return mapActionPath(typeof data.link_path === "string" ? data.link_path : null) ?? "/notifications";
}

function routeResponse(resp: ResponseLike): boolean {
  const id = resp.notification.request.identifier;
  if (routed.has(id)) return false;
  const to = destinationFor(resp.notification.request.content.data);
  if (!to) return false;
  routed.add(id);
  router.push(to as never);
  return true;
}

function setChannel(): void {
  void Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL, {
    name: t("common.label.notifications"),
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(() => {});
}

/** Install the foreground handler, the Android channel and the tap listener. Idempotent. */
export function startRemotePushRouting(): void {
  if (started) return;
  started = true;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* bare test env */
  }

  if (Platform.OS === "android") {
    setChannel();
    // The channel's name shows in the OS settings; setting it again renames it.
    stopLocaleWatch = onLocaleChange(setChannel);
  }

  try {
    subscription = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeResponse(resp as ResponseLike);
    });
  } catch {
    /* listener unavailable */
  }
}

/**
 * The tap that launched the app from cold. The listener above is not yet
 * installed when that happens, so the OS parks the response and we read it
 * here - once the session is restored, because routing to a file while still
 * signed out would only be bounced to the login screen and lost.
 */
export async function routeColdStartNotification(): Promise<void> {
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (!last) return;
    if (routeResponse(last as ResponseLike)) await Notifications.clearLastNotificationResponseAsync();
  } catch {
    /* nothing parked, or no native module */
  }
}

// Test hook.
export function __resetRemotePushRouting(): void {
  subscription?.remove();
  subscription = null;
  stopLocaleWatch?.();
  stopLocaleWatch = null;
  started = false;
  routed.clear();
}
