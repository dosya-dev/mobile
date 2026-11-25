import { Platform } from "react-native";
import * as Device from "expo-device";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import { fatalReasonCode } from "@/upload/controller";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useBackupRun } from "./runState";
import { pendingTotals } from "./ledger";
import { reportBackupPause } from "./api";

/**
 * Telling the SERVER that backup paused, so spec §5.9's `backup_failed` becomes
 * a real notification.
 *
 * Separate from `alerts.ts`, which owns the local OS notification, for two
 * reasons. They are different mechanisms with different failure modes - the
 * tray alert works offline and reaches one phone, this one needs a network and
 * reaches the account - and keeping them apart means the sign-out purge can
 * clear this module's throttle without dragging expo-notifications and
 * expo-router into an account teardown that has nothing to do with either.
 */

/**
 * Which of the four device names spec §5.9 may use. A CODE, not a name: the
 * server owns the wording (`DEVICE_KINDS` in lib/notifications/backup.ts). The
 * model name and the user's own device name were both rejected there - the
 * first is more precision than the sentence needs, the second is free text the
 * owner typed that would land in an email subject.
 */
export function deviceKind(): string {
  const tablet = Device.deviceType === Device.DeviceType.TABLET;
  if (Platform.OS === "ios") return tablet ? "ipad" : "iphone";
  return tablet ? "android_tablet" : "android_phone";
}

/**
 * Spec §5.9 asks for a 24 hour dedupe window on `backup_failed`, and the
 * server's engine has a fixed ONE hour one (`dedupeWindowStart` in
 * lib/notifications/logic.ts). So the wider window is enforced here, where the
 * pause actually happens.
 *
 * Persisted, because the case it exists for spans process lifetimes: a phone
 * that is out of storage stays out of storage, and every retry re-enters the
 * paused state. Keyed by reason as well as by time - a different fatal cause is
 * a different incident and deserves to be told.
 *
 * Storage failing costs the throttle, and the report goes out again. That is
 * the right way round: an extra notification about a real pause beats a silence
 * caused by a keychain read.
 */
export const REPORT_KEY = "dosya.backup.alert.reported";
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function throttled(reasonCode: string, now: number): Promise<boolean> {
  try {
    const raw = await getItem(REPORT_KEY);
    if (!raw) return false;
    const last = JSON.parse(raw) as { reason?: unknown; at?: unknown };
    return last.reason === reasonCode && typeof last.at === "number" && now - last.at < REPORT_WINDOW_MS;
  } catch {
    return false; // unreadable or corrupt - report, never swallow
  }
}

/**
 * Send the pause. Best-effort throughout: this runs inside a store subscription
 * on the engine's own path, so neither a dead network nor an unreadable ledger
 * may escape into it.
 */
export async function reportPause(reason: string): Promise<void> {
  const now = Date.now();
  const reasonCode = fatalReasonCode(reason);
  if (await throttled(reasonCode, now)) return;

  try {
    // The run's workspace while a run is live; the active one once `idle()` has
    // cleared it, which is the state a pause usually leaves behind.
    const workspaceId = useBackupRun.getState().workspaceId ?? useWorkspaceStore.getState().activeId;
    const { count, bytes } = await pendingTotals(workspaceId);
    await reportBackupPause({ reasonCode, deviceKind: deviceKind(), pendingCount: count, pendingBytes: bytes });
  } catch {
    // Offline is the common case here - a fatal upload error and a dead network
    // often arrive together. The local alert has already fired, and nothing is
    // recorded below, so the next pause tries again.
    return;
  }

  try {
    await setItem(REPORT_KEY, JSON.stringify({ reason: reasonCode, at: now }));
  } catch {
    /* not throttled next time - one extra notification, never a missing one */
  }
}

/**
 * Forget the throttle on sign-out.
 *
 * The window is device-level, but what it suppresses belongs to an account.
 * Left in place, the next account signing in on this handset could hit the same
 * fatal cause and be told nothing for up to a day.
 */
export async function clearBackupAlertReport(): Promise<void> {
  try {
    await deleteItem(REPORT_KEY);
  } catch {
    /* best-effort, like every other step in the purge */
  }
}
