import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface SiriSearchNativeModule {
  addListener(eventName: "query", listener: (event: { text: string }) => void): EventSubscription;
  takePendingQuery(): string | null;
}

/**
 * iOS-only (expo-module.config.json restricts platforms to ["ios"]) - absent
 * on Android and in Expo Go, same contract as src/perf/thermal.ts and
 * src/share-intent/listener.ts. `requireNativeModule` (the throwing variant)
 * would crash at import time on every non-iOS-dev-client launch, since
 * installVoiceSearch() runs unconditionally from index.js on every platform.
 *
 * Native modules already implement EventEmitter directly as of Expo SDK 52
 * (see expo-modules-core's NativeModule/EventEmitter classes) - no separate
 * `new EventEmitter(native)` wrapper is needed or used elsewhere in this repo.
 */
const native = requireOptionalNativeModule<SiriSearchNativeModule>("SiriSearch");

export const SiriSearch = {
  addQueryListener(cb: (text: string) => void): EventSubscription {
    if (!native) return { remove() {} };
    return native.addListener("query", (e) => cb(e.text));
  },
  takePendingQuery(): string | null {
    return native?.takePendingQuery() ?? null;
  },
};
