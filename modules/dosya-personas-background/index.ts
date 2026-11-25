import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * The OS windows the Personas background runner reads in (spec 5.3, 5.4).
 *
 * iOS: a BGProcessingTask `dev.dosya.personas.read` (registered at launch by
 * PersonasBackgroundAppDelegate) and, on iOS 26+, a BGContinuedProcessingTask
 * `dev.dosya.app.personas.continue.<uuid>` the user starts from the People screen.
 * Android: a foreground service (`PersonasReadService`, type mediaProcessing on
 * API 35+, dataSync below) started while the app is in front, which hands JS a
 * "service" window each time the app goes to the background; and WorkManager
 * unique work `dosya-personas-read`, whose worker starts the headless JS task
 * `DosyaPersonasRead` (registered in apps/mobile/index.js) with a 9 min
 * "worker" window, and enqueues itself again when JS ends it with moreLeft.
 * If headless start turns out not to work on a device (spec 11.7; the
 * Kotlin constant `PersonasReadWorker.HEADLESS_JS_START`), the worker posts
 * the "Tap to keep reading" notification (`tapText`) instead of starting JS,
 * and so does any run where Android refuses to start the headless service.
 *
 * The native side owns the OS task. It buffers `onWindow` / `onWindowExpired`
 * until JS listens (a cold background launch delivers the task before the JS
 * runtime is up), then flushes them in order. JS ends every window with
 * `windowDone`; after an expiry, native completes the task itself if
 * `windowDone` has not arrived within 5 s.
 *
 * Every function is safe without the native module (Expo Go, a build without
 * it): it does nothing and reports "no background".
 */

/** Who gave the window: iOS processing task / iOS continued task / Android service / Android worker. Same as src/personas/device/background.ts. */
export type WindowKind = "processing" | "continued" | "service" | "worker";

export interface WindowEvent {
  id: string;
  kind: WindowKind;
  /** Epoch ms when the OS takes the window back (the runner stops 10 s before). */
  deadlineMs: number;
}

/** Phone settings that stop background reading (spec 11.4). */
export type BackgroundBlock = "refreshOff" | "notificationsOff" | "batteryOptimized";

type Subscription = { remove(): void };

interface NativePersonasBackground {
  addListener(event: "onWindow", fn: (e: WindowEvent) => void): Subscription;
  addListener(event: "onWindowExpired", fn: (e: { id: string }) => void): Subscription;
  addListener(event: "onMemoryWarning", fn: () => void): Subscription;
  addListener(event: "onPausePressed", fn: () => void): Subscription;
  addListener(event: "onServiceStopped", fn: () => void): Subscription;
  windowDone(id: string, moreLeft: boolean): void;
  scheduleWindow(requiresPower: boolean): Promise<void>;
  cancelWindows(): Promise<void>;
  supportsContinued(): boolean;
  startContinued(title: string, subtitle: string): Promise<boolean>;
  setWindowProgress(id: string, read: number, total: number, text: string): void;
  backgroundBlocks(): Promise<BackgroundBlock[]>;
  openAppSettings(which: BackgroundBlock): Promise<void>;
  // Android only.
  startService(title: string, text: string, pauseLabel: string, channelName: string): Promise<boolean>;
  updateService(read: number, total: number, text: string): void;
  stopService(): void;
  enqueueWorker(requiresCharging: boolean, batteryNotLow: boolean, unmetered: boolean, tapText: string): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
}

const native = requireOptionalNativeModule<NativePersonasBackground>("DosyaPersonasBackground");

export function isPersonasBackgroundAvailable(): boolean {
  return native != null;
}

function listen(subscribe: (n: NativePersonasBackground) => Subscription): () => void {
  if (!native) return () => undefined;
  try {
    const sub = subscribe(native);
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}

/** A window the OS gave. Buffered natively until the first listener. */
export function onWindow(fn: (w: WindowEvent) => void): () => void {
  return listen((n) => n.addListener("onWindow", (e) => fn({ id: e.id, kind: e.kind, deadlineMs: e.deadlineMs })));
}

/** The OS is taking the window back now. */
export function onWindowExpired(fn: (id: string) => void): () => void {
  return listen((n) => n.addListener("onWindowExpired", (e) => fn(e.id)));
}

/** iOS didReceiveMemoryWarning; Android onTrimMemory at TRIM_MEMORY_RUNNING_LOW or worse, and onLowMemory. */
export function onMemoryWarning(fn: () => void): () => void {
  return listen((n) => n.addListener("onMemoryWarning", () => fn()));
}

/**
 * Ends a window. `moreLeft` is informational on iOS (the runner reschedules
 * through scheduleWindow). Android: a worker window completes its work and
 * enqueues it again when `moreLeft`; a service window does not stop the
 * service (stopService does).
 */
export function windowDone(id: string, moreLeft: boolean): void {
  try {
    native?.windowDone(id, moreLeft);
  } catch {
    // The window is already gone (expired and completed natively).
  }
}

/** iOS: a BGProcessingTaskRequest(dev.dosya.personas.read), network required, replacing any pending one. */
export async function scheduleWindow(o: { requiresPower: boolean }): Promise<void> {
  if (!native) return;
  await native.scheduleWindow(o.requiresPower);
}

/** Cancels every pending window request (a running window ends through windowDone). Android: cancels the unique work. */
export async function cancelWindows(): Promise<void> {
  if (!native) return;
  await native.cancelWindows();
}

/** iOS 26+ only: the continued task ("Keep reading in background"). */
export function supportsContinued(): boolean {
  if (Platform.OS !== "ios" || !native) return false;
  try {
    return native.supportsContinued();
  } catch {
    return false;
  }
}

/** Submits the continued task (strategy .fail). False when iOS refuses it or it is unsupported. */
export async function startContinued(o: { title: string; subtitle: string }): Promise<boolean> {
  if (!supportsContinued() || !native) return false;
  try {
    return await native.startContinued(o.title, o.subtitle);
  } catch {
    return false;
  }
}

/** Progress for the continued task's system UI; a no-op for other windows. */
export function setWindowProgress(id: string, p: { read: number; total: number; text: string }): void {
  try {
    native?.setWindowProgress(id, p.read, p.total, p.text);
  } catch {
    // Window already ended.
  }
}

/** Settings that stop background reading. iOS: Background App Refresh. Android: notifications off, battery optimisation on. */
export async function backgroundBlocks(): Promise<BackgroundBlock[]> {
  if (!native) return [];
  try {
    return await native.backgroundBlocks();
  } catch {
    return [];
  }
}

/**
 * Opens the settings page for a block. iOS: the app's page in Settings for
 * every block. Android: the app's notification settings for "notificationsOff",
 * the app's details page otherwise (never the battery-optimisation prompt).
 */
export async function openAppSettings(which: BackgroundBlock): Promise<void> {
  if (!native) return;
  await native.openAppSettings(which);
}

const isAndroid = () => Platform.OS === "android";

/**
 * Android: starts the foreground service with its notification. Only while an
 * Activity is resumed (Android 12+ forbids a background start); false
 * otherwise, on iOS, and when Android refuses. The service gives JS a
 * "service" window (deadline Number.MAX_SAFE_INTEGER) each time the app goes
 * to the background, and none while the app is in front. `channelName` names
 * the notification channel in the phone's settings (created once).
 */
export async function startService(o: { title: string; text: string; pauseLabel: string; channelName: string }): Promise<boolean> {
  if (!isAndroid() || !native) return false;
  try {
    return await native.startService(o.title, o.text, o.pauseLabel, o.channelName);
  } catch {
    return false;
  }
}

/** Android: the service notification's progress and text; a no-op when it is not running. */
export function updateService(p: { read: number; total: number; text: string }): void {
  if (!isAndroid()) return;
  try {
    native?.updateService(p.read, p.total, p.text);
  } catch {
    // Service already gone.
  }
}

/** Android: stops the foreground service (an open service window still ends through windowDone). */
export function stopService(): void {
  if (!isAndroid()) return;
  try {
    native?.stopService();
  } catch {
    // Already stopped.
  }
}

/** Android: the notification's Pause action. Buffered natively until the first listener. */
export function onPausePressed(fn: () => void): () => void {
  return listen((n) => n.addListener("onPausePressed", () => fn()));
}

/**
 * Android: the foreground service went away, however it ended (JS's
 * stopService, Android 15's onTimeout, a refused startForeground). Buffered
 * natively until the first listener (only the latest). Never fires on iOS.
 */
export function onServiceStopped(fn: () => void): () => void {
  if (!isAndroid()) return () => undefined;
  return listen((n) => n.addListener("onServiceStopped", () => fn()));
}

/**
 * Android: one-time unique work `dosya-personas-read` (ExistingWorkPolicy.REPLACE)
 * with these constraints. `tapText` is the translated "Tap to keep reading
 * photos for Personas" notification shown when the worker cannot start JS
 * headless; an empty text shows none.
 */
export async function enqueueWorker(o: { requiresCharging: boolean; batteryNotLow: boolean; unmetered: boolean; tapText: string }): Promise<void> {
  if (!isAndroid() || !native) return;
  await native.enqueueWorker(o.requiresCharging, o.batteryNotLow, o.unmetered, o.tapText);
}

/** Android 13+: asks for POST_NOTIFICATIONS; true below 13 and on iOS, false without the module. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isAndroid()) return true;
  if (!native) return false;
  try {
    return await native.requestNotificationPermission();
  } catch {
    return false;
  }
}
