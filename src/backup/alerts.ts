import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { blockReasonText, isRestoringBlock, useUploadBlock } from "@/upload/uploadBlock";
import { useBackupRun } from "./runState";
import { useBackupSettings } from "./settings";
import { useUploadStore } from "@/upload/store";
import { onLocaleChange, t } from "@/lib/i18n";
import { reportPause } from "./alertReport";

/**
 * Local notifications for backup problems, so failures aren't silent - the
 * case that matters is a BACKGROUND run hitting a fatal error (storage limit):
 * without this the engine latches paused and the user only finds out whenever
 * they next open the app.
 *
 * Notification policy (anti-spam):
 * - Fatal pause (quota/membership/permission): once per engagement - the
 *   null → reason transition; re-notifies only after a retry re-fails.
 * - Run finished with failed items: once per run (active → idle transition),
 *   and only when the app is NOT foregrounded (the dashboard already shows it)
 *   and no fatal notification just covered it.
 * - Permission is requested at the moment auto-backup is toggled ON (a
 *   foreground user action - background runs cannot show the iOS prompt).
 *
 * A fatal pause ALSO goes to the server (spec §5.9 `backup_failed`), because a
 * local alert reaches nobody but whoever is holding this phone at this moment:
 * no inbox row, no email, every preference the user set ignored, and gone once
 * it is swiped away. The tray alert stays as the immediate signal - it fires
 * with no network at all - and the server report is the durable record.
 */
const CHANNEL = "backup-alerts";

let started = false;
let unsubs: Array<() => void> = [];

function setChannel(): void {
  void Notifications.setNotificationChannelAsync(CHANNEL, {
    name: t("backup.label.backupAlerts"),
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {});
}

async function canNotify(interactive: boolean): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain && interactive) {
      const req = await Notifications.requestPermissionsAsync();
      return req.granted;
    }
    return false;
  } catch {
    return false;
  }
}

async function notify(title: string, body: string): Promise<void> {
  if (!(await canNotify(AppState.currentState === "active"))) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { url: "/(tabs)/backup" } },
      trigger: Platform.OS === "android" ? ({ channelId: CHANNEL } as never) : null,
    });
  } catch {
    /* alerting is best-effort - never let it break the engine */
  }
}

export function startBackupAlerts(): void {
  if (started) return;
  started = true;

  if (Platform.OS === "android") {
    setChannel();
    // The channel name shows in the OS settings; setting it again renames it.
    unsubs.push(onLocaleChange(setChannel));
  }

  // 1. Fatal pause - the block's null → reason transition.
  //
  // `isRestoringBlock()` is what separates "backup just stopped" from "the app
  // has remembered that it stopped". hydrateUploadBlock runs at launch and
  // resolves AFTER this subscription is installed, so without the guard every
  // single launch under an unresolved block raised a fresh alert - and would
  // now post a server notification with it.
  let lastReason = useUploadBlock.getState().reason;
  unsubs.push(
    useUploadBlock.subscribe((s) => {
      if (s.reason && !lastReason && !isRestoringBlock()) {
        void notify(t("backup.status.backupPaused"), t("backup.description.reasonOpenTheAppAndTapTheBackupButtonToRetry", { reason: blockReasonText(s, t) ?? s.reason }));
        void reportPause(s.reason);
      }
      lastReason = s.reason;
    }),
  );

  // 2. Run drained with failures - once, and only when the user isn't looking
  // at the app (the dashboard's red rows already cover the foreground case).
  let lastPhase = useBackupRun.getState().phase;
  unsubs.push(
    useBackupRun.subscribe((s) => {
      if (s.phase === "idle" && lastPhase !== "idle" && AppState.currentState !== "active") {
        const failed = useUploadStore
          .getState()
          .items.filter((i) => i.id.startsWith("bk_") && i.status === "error").length;
        if (failed > 0 && !useUploadBlock.getState().reason) {
          void notify(
            t("backup.status.backupFinishedWithProblems"),
            t("backup.error.failedPluralOneItemOtherItemsFailedToBackUpOpenDosyaDevTo", { failed }),
          );
        }
      }
      lastPhase = s.phase;
    }),
  );

  // 3. Enabling auto-backup is the natural, foreground moment to ask for
  // notification permission (background runs can never show the prompt).
  let lastAuto = useBackupSettings.getState().settings.autoBackup;
  unsubs.push(
    useBackupSettings.subscribe((s) => {
      if (s.settings.autoBackup && !lastAuto) void canNotify(true);
      lastAuto = s.settings.autoBackup;
    }),
  );

  // 4. Tapping an alert lands on the Backup tab.
  try {
    Notifications.addNotificationResponseReceivedListener((resp) => {
      const url = resp.notification.request.content.data?.url;
      if (typeof url === "string") router.push(url as never);
    });
  } catch {
    /* listener unavailable (e.g. bare test env) */
  }
}

// Test hook.
export function __resetBackupAlerts(): void {
  for (const u of unsubs) u();
  unsubs = [];
  started = false;
}
