import { requireOptionalNativeModule } from "expo-modules-core";
import { useShareIntentStore } from "./store";
import type { SharedFile } from "./types";

interface Subscription {
  remove(): void;
}

interface DosyaShareIntentModule {
  /** The intent the activity was launched with, or null if it carries no files / was already read. */
  consumePendingShare(): Promise<unknown>;
  addListener(event: "onShareIntent", listener: (payload: unknown) => void): Subscription;
}

/**
 * Android-only. Present in dev-client / release builds that include the local
 * module; absent in Expo Go and on iOS - same contract as
 * src/backup/foregroundService.ts.
 *
 * Resolved on use rather than at import: the native registry is not guaranteed
 * to be populated when this module is first evaluated.
 */
function nativeModule(): DosyaShareIntentModule | null {
  return requireOptionalNativeModule<DosyaShareIntentModule>("DosyaShareIntent");
}

/** True when the app can receive files from the chooser / share sheet. */
export function isShareIntentAvailable(): boolean {
  return nativeModule() != null;
}

/**
 * Watches both ways Android can hand this app a file and parks whatever arrives.
 *
 * Two paths, because they are genuinely different events:
 *  - cold start: the activity already held the intent before the JS engine
 *    existed, so no listener could have caught it. It has to be asked for.
 *  - warm start: MainActivity is launchMode="singleTask", so a share into a
 *    running app never re-creates the activity - it only ever arrives as an
 *    event.
 *
 * Missing either one is a silent half-feature: sharing works the first time and
 * not the second, or the reverse.
 *
 * Returns a dispose function. Everything is best-effort: this runs inside the
 * root layout's mount effect, where a throw takes the app down on launch.
 */
export function startShareIntentListener(): () => void {
  const native = nativeModule();
  if (!native) return () => {};

  const receive = (files: SharedFile[]) => useShareIntentStore.getState().receive(files);

  let subscription: Subscription | null = null;
  try {
    subscription = native.addListener("onShareIntent", (payload) => {
      receive(normalize((payload as { files?: unknown })?.files));
    });
  } catch {
    // Listener registration failed - the cold-start drain below still runs.
  }

  native
    .consumePendingShare()
    .then((files) => receive(normalize(files)))
    .catch(() => {
      // No activity attached yet, or the provider went away. Nothing to hand
      // over; the app carries on as if it were launched normally.
    });

  return () => {
    try {
      subscription?.remove();
    } catch {
      /* already torn down */
    }
  };
}

/**
 * The payload crosses the native bridge, so it is treated as untrusted here.
 * Anything without a readable uri is dropped rather than enqueued - an upload
 * whose source cannot be opened fails at transfer time, long after the user was
 * told it was queued.
 */
function normalize(input: unknown): SharedFile[] {
  if (!Array.isArray(input)) return [];
  const out: SharedFile[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const { uri, name, size, mime } = raw as Record<string, unknown>;
    if (typeof uri !== "string" || uri.length === 0) continue;
    out.push({
      uri,
      // A blank name would leave the user with an unidentifiable row in their
      // file list; the native side already tries DISPLAY_NAME first.
      name: typeof name === "string" && name.trim().length > 0 ? name : "shared-file",
      size: typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0,
      mime: typeof mime === "string" && mime.length > 0 ? mime : "application/octet-stream",
    });
  }
  return out;
}
