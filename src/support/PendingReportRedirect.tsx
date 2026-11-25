import { useEffect } from "react";
import { router } from "expo-router";
import { useReportStore } from "./reportStore";

/**
 * Mounted beside the signed-in navigator. When the root ErrorBoundary parked a
 * report (it has no router of its own), this pushes the screen once the tree
 * is back, and clears the slot so a re-render cannot push it twice.
 *
 * The push is deferred to the next tick rather than fired straight from the
 * effect: this component remounts in the SAME commit that the ErrorBoundary's
 * reset remounts the <Stack>, and expo-router's router.push() calls
 * assertIsReady(), which throws "Attempted to navigate before mounting the
 * Root Layout component" when the navigator has not finished mounting yet -
 * sending that error straight back into the boundary and looping. A tick
 * later the navigator is up; if it still is not (push throws for some other
 * reason), the report has already been consumed and is simply dropped rather
 * than retried.
 *
 * Deliberately not a `useReportStore((s) => s.pending)` selector: this
 * component is freshly MOUNTED every time there is something to push (the
 * ErrorBoundary's reset remounts the whole signed-in tree), so a mount-only
 * effect already sees the current value. Subscribing reactively would backfire
 * here - consumePending() below flips the store's `pending` back to null as
 * its very first act, and a selector on that field would re-render this same
 * component from that change, tearing the effect down (and clearing the timer
 * this effect just started) before the deferred push ever gets to run.
 */
export function PendingReportRedirect() {
  useEffect(() => {
    const p = useReportStore.getState().consumePending();
    if (!p) return;
    const id = setTimeout(() => {
      try {
        router.push({
          pathname: "/report-problem",
          params: { from: p.from ?? "", errorRef: p.errorRef ?? "", errorMessage: p.errorMessage ?? "" },
        });
      } catch {
        // navigator not ready; the report stays consumed
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return null;
}
