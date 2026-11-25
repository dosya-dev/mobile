/**
 * Where the app's own stores report to analytics. Kept apart from
 * ./analytics.ts so that module stays a leaf: the API client imports it, and
 * the auth store imports the API client.
 *
 * Everything here is a subscription to state that already exists. No screen
 * calls analytics to say someone signed in or an upload finished; the store
 * that knows says so once, here.
 */
import { useAuthStore } from "@/auth/authStore";
import { getLastMethod } from "@/auth/lastMethod";
import { useUploadStore } from "@/upload/store";
import { useDownloadStore } from "@/files/downloadStore";
import { currentLocale } from "@/lib/i18n";
import { hydrateAnalytics, startAnalyticsLifecycle, track, trackUpload } from "./analytics";
import { authEventFor } from "./authEvents";

let started = false;

/** Starts analytics for this process. Safe to call more than once; never throws. */
export function startAnalytics(): void {
  if (started) return;
  started = true;
  try {
    void hydrateAnalytics();
    startAnalyticsLifecycle({ locale: () => currentLocale() });

    useAuthStore.subscribe((state, prev) => {
      if (state.status === prev.status) return;
      void getLastMethod()
        .catch(() => null)
        .then((method) => {
          const event = authEventFor(state, prev, method, Date.now() / 1000);
          if (event) track(event.name, event.params);
        });
    });

    const counted = new Set<string>();
    useUploadStore.subscribe((state, prev) => {
      // Progress ticks patch the store many times a second; only a changed
      // list can hold a newly finished item.
      if (state.items === prev.items) return;
      for (const item of state.items) {
        // Camera backup (bk_) is not counted per file: see recordApiActivity.
        if (item.status !== "done" || item.id.startsWith("bk_") || counted.has(item.id)) continue;
        counted.add(item.id);
        trackUpload(item.size);
      }
    });

    useDownloadStore.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      for (const id of Object.keys(state.entries)) {
        // A download that just began: there now, and either absent before or
        // finished before and started again.
        const before = prev.entries[id];
        const entry = state.entries[id];
        if (entry.phase === "preparing" && (!before || before.startedAt !== entry.startedAt)) track("file_download", { kind: "file" });
      }
    });
  } catch {
    // Analytics is never a reason for the app not to start.
  }
}

/** Test seam. */
export function __resetAnalyticsWiring(): void {
  started = false;
}
