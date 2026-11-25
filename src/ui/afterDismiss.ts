import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Run a sheet item's action only once the sheet is really gone.
 *
 * On iOS an RN `Modal` is a presented view controller, and it is still on
 * screen for the length of its slide-out after `visible` flips to false. A
 * native picker launched in that window is presented on top of the closing
 * sheet: UIKit either refuses it or tears it down with the sheet, and either
 * way the picker's delegate never hears back. expo-document-picker then keeps
 * its "picking in progress" flag forever, so the tap does nothing and every
 * later tap fails too until the app is killed (seen on an iPhone 11).
 *
 * `onDismiss` fires after the slide-out ends, so the queued action runs then.
 * Android's Modal is a dialog that does not block the next presentation, so
 * the action runs at once there, as before.
 *
 * The timer is a backstop for a dismissal that never reports back (an RN
 * regression): the action must still run, just late, rather than vanish.
 */
export const DISMISS_FALLBACK_MS = 1000;

export function useAfterDismiss(): { queue: (action: () => void) => void; onDismiss: () => void } {
  const pending = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const action = pending.current;
    pending.current = null;
    action?.();
  }, []);

  const queue = useCallback(
    (action: () => void) => {
      if (Platform.OS !== "ios") {
        action();
        return;
      }
      pending.current = action;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DISMISS_FALLBACK_MS);
    },
    [flush],
  );

  // A sheet its parent unmounts on close (FileBrowser's file and folder
  // sheets) never gets an onDismiss, so its action runs on the way out, as it
  // always did, rather than waiting out the backstop.
  useEffect(() => flush, [flush]);

  return { queue, onDismiss: flush };
}
