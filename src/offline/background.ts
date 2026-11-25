import { AppState } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import * as Network from "expo-network";
import { loadUser } from "@/auth/tokenStore";
import { runOfflineSync } from "./sync";
import { beginSession, currentSession } from "./session";
import { useOfflineStore } from "./offlineStore";
import { isUnmetered } from "./network";

/**
 * When offline files get checked: at launch, on returning to the app (at most
 * every 10 minutes), when the connection or Wi-Fi comes back, and whenever iOS
 * or Android grant a background slot. All best effort - G5 in the plan. The
 * Offline screen shows when each pin was last checked and always offers Sync
 * now, so nothing here has to be on time to be honest.
 */

export const OFFLINE_TASK = "dosya-offline-sync";
export const FOREGROUND_THROTTLE_MS = 10 * 60_000;

let taskDefined = false;

/**
 * The background handler. Defined at module scope (below) so the OS can run it
 * after a cold start, before React mounts. Never rejects.
 */
export function defineOfflineTask(): void {
  if (taskDefined) return;
  taskDefined = true;
  TaskManager.defineTask(OFFLINE_TASK, async () => {
    try {
      // A headless launch has no React tree, so nothing has begun the session.
      // The stored user names the account; the API client recovers its access
      // token from disk on the first 401, as every headless run does.
      if (!currentSession()) {
        const user = await loadUser<{ id?: string }>().catch(() => null);
        if (!user?.id) return BackgroundTask.BackgroundTaskResult.Success;
        beginSession(user.id);
      }
      await runOfflineSync({ reason: "background" });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Ask for background slots only while something is pinned: a registered task
 * with nothing to do still costs the user a wake-up. 60 minutes is a request,
 * not a schedule; the OS decides.
 */
export async function syncRegistration(hasPins: boolean): Promise<void> {
  try {
    if (hasPins) {
      await BackgroundTask.registerTaskAsync(OFFLINE_TASK, { minimumInterval: 60 });
    } else if (await TaskManager.isTaskRegisteredAsync(OFFLINE_TASK)) {
      await BackgroundTask.unregisterTaskAsync(OFFLINE_TASK);
    }
  } catch {
    // Expo Go and some emulators have no background tasks; the foreground
    // triggers still run.
  }
}

/** Start the foreground triggers for the signed-in session. Returns the stop. */
export function startOfflineTriggers(): () => void {
  let lastForeground = Date.now();
  void runOfflineSync({ reason: "foreground" });

  const app = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    if (Date.now() - lastForeground < FOREGROUND_THROTTLE_MS) return;
    lastForeground = Date.now();
    void runOfflineSync({ reason: "foreground" });
  });

  // Coming back online, or back onto Wi-Fi, is when a waiting check or a
  // waiting transfer can finally happen. Unknown starts as "connected on Wi-Fi"
  // so the first event is only a trigger when it is a real change.
  let was = { connected: true, wifi: true };
  let net: { remove(): void } | null = null;
  try {
    net = Network.addNetworkStateListener((e) => {
      const now = { connected: e.isConnected ?? false, wifi: isUnmetered(e.type) };
      const regained = now.connected && (!was.connected || (now.wifi && !was.wifi));
      was = now;
      if (regained) void runOfflineSync({ reason: "network" });
    });
  } catch {
    // No network events: launch and foreground triggers still apply.
  }

  let hadPins: boolean | null = null;
  const unsub = useOfflineStore.subscribe((s) => {
    const has = s.pins.length > 0;
    if (has === hadPins) return;
    hadPins = has;
    void syncRegistration(has);
  });

  return () => {
    app.remove();
    net?.remove();
    unsub();
  };
}

/**
 * The shell's one call once the signed-in user is known: begin that account's
 * session, show what is already saved, and start the triggers. Returns the stop.
 */
export function startOfflineForAccount(accountId: string): () => void {
  beginSession(accountId);
  void useOfflineStore.getState().refresh();
  return startOfflineTriggers();
}

/** Test hook. */
export function __resetOfflineTriggersForTests(): void {
  taskDefined = false;
}

// Define at module scope (global) - do not wait for a component to mount.
defineOfflineTask();
