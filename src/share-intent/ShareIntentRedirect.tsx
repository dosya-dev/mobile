import { useEffect } from "react";
import { router } from "expo-router";
import { useShareIntentStore } from "./store";

/** How long to keep retrying a push the navigator was not ready for. */
export const RETRY_MS = 100;
export const MAX_ATTEMPTS = 20;

/**
 * Mounted beside the signed-in <Stack>, after every gate has let it render.
 * When a shared or opened file is parked (useShareIntentRouting receives it),
 * this opens the destination picker.
 *
 * Its position is the whole point: being rendered here is the proof that the
 * real navigator exists. Checking for that from the root layout cannot work -
 * see useShareIntentRouting for the remount loop that crashed the iOS app.
 *
 * The push is deferred a tick, like PendingReportRedirect's: this effect fires
 * in the same commit that mounts the <Stack>, before expo-router can take a
 * navigation. If it still is not ready (push throws), it retries briefly; the
 * file stays parked either way, so nothing is lost.
 *
 * Not cleared here - app/save-to.tsx calls take() as it mounts, which flips
 * `pending` to null and ends this effect. Clearing first would empty the slot
 * before the screen that needs it exists.
 */
export function ShareIntentRedirect() {
  const pending = useShareIntentStore((s) => s.pending);

  useEffect(() => {
    if (pending === null) return;
    let attempts = 0;
    let id: ReturnType<typeof setTimeout>;
    const attempt = () => {
      attempts += 1;
      try {
        router.push("/save-to");
      } catch {
        if (attempts < MAX_ATTEMPTS) id = setTimeout(attempt, RETRY_MS);
      }
    };
    id = setTimeout(attempt, 0);
    return () => clearTimeout(id);
  }, [pending]);

  return null;
}
