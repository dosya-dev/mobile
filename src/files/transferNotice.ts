import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { onLocaleChange, t } from "@/lib/i18n";

/**
 * Tray notifications for a download the user started by hand.
 *
 * The two platforms are genuinely not equal here and this module does not
 * pretend otherwise:
 *
 *  - **Android** gets an ongoing, replaced-in-place notification carrying the
 *    percentage, so a transfer stays visible with the app backgrounded. It is
 *    posted under its own channel, because a user who mutes photo-backup noise
 *    has not asked to lose sight of a download they pressed for.
 *  - **iOS** gets nothing while the transfer runs. A local notification there
 *    has no updatable progress, so an "ongoing" one would be a stack of
 *    identical banners to dismiss by hand. A Live Activity can do it properly;
 *    that is a native module plus an entitlement plus a Dynamic Island layout,
 *    and it is deliberately not faked here in the meantime.
 *
 * Both platforms get the completion banner, and only when the app is not in the
 * foreground - on screen, the ring and the toast have already said it.
 */
export const TRANSFER_CHANNEL = "transfers";

/** One notification id per file, so ticks replace rather than stack. */
const idFor = (fileId: string) => `transfer-${fileId}`;

let channelReady = false;

async function setChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(TRANSFER_CHANNEL, {
    name: t("files.label.fileTransfers"),
    // LOW: it should be visible in the shade without a sound for every tick.
    importance: Notifications.AndroidImportance.LOW,
  }).catch(() => {});
}

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== "android") return;
  channelReady = true;
  await setChannel();
}

// The channel name is shown in system settings, so a language switch re-sets it
// (only once the channel exists; Android keeps the user's other channel settings).
onLocaleChange(() => {
  if (channelReady && Platform.OS === "android") void setChannel();
});

async function granted(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Post or replace the ongoing progress notification. Android only.
 *
 * Never asks for permission: this fires mid-transfer, and a permission prompt
 * on a background thread is either ignored or lands on the user at the wrong
 * moment. If the permission is not already there, the transfer is simply
 * silent - the in-app ring is still reporting.
 */
export async function updateTransferNotification(
  fileId: string,
  name: string,
  pct: number,
  detail: string,
): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!(await granted())) return;
  await ensureChannel();
  const body = detail ? `${pct}% · ${detail}` : `${pct}%`;
  await Notifications.scheduleNotificationAsync({
    identifier: idFor(fileId),
    content: {
      title: name,
      body,
      sticky: true,
      data: { url: "/(tabs)/(files)" },
      ...(Platform.OS === "android" ? { channelId: TRANSFER_CHANNEL } : {}),
    },
    trigger: null,
  }).catch(() => {});
}

/** Take the ongoing notification down - the transfer ended, one way or another. */
export async function clearTransferNotification(fileId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.dismissNotificationAsync(idFor(fileId)).catch(() => {});
}

/**
 * The one notification iOS does get: the file has landed and where it went.
 * Suppressed in the foreground, where the ring already turned green.
 */
export async function notifyTransferDone(name: string, outcome: string): Promise<void> {
  if (AppState.currentState === "active") return;
  if (!(await granted())) return;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: name,
      body: outcome,
      data: { url: "/(tabs)/(files)" },
      ...(Platform.OS === "android" ? { channelId: TRANSFER_CHANNEL } : {}),
    },
    trigger: null,
  }).catch(() => {});
}
