import { Modal } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

/**
 * Test-only: report that every open sheet has finished sliding away.
 *
 * On iOS a sheet item's action waits for its Modal's onDismiss (see
 * afterDismiss.ts), which the test renderer never fires on its own. Call this
 * right after pressing a sheet item.
 */
export function finishSheetDismissal(): void {
  act(() => {
    for (const modal of screen.UNSAFE_getAllByType(Modal)) modal.props.onDismiss?.();
  });
}

type Touch = { startX: number; startY: number; x: number; y: number; t: number };

/** A one-finger responder event as PanResponder reads it (TouchHistoryMath). */
function touchEvent({ startX, startY, x, y, t }: Touch) {
  return {
    // rtl-ok: pointer coordinates (a synthetic touch in the finger's frame)
    nativeEvent: { pageX: x, pageY: y, timestamp: t, identifier: 0, touches: [], changedTouches: [] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: t,
      touchBank: [{
        touchActive: true,
        startPageX: startX, startPageY: startY, startTimeStamp: 1,
        currentPageX: x, currentPageY: y, currentTimeStamp: t,
        previousPageX: startX, previousPageY: startY, previousTimeStamp: 1,
      }],
    },
    persist() {},
  };
}

/**
 * Test-only: touch down on a SheetHandle (src/ui/SheetHandle), drag by
 * (dx, dy), lift. Drives the responder props PanResponder installed with the
 * touch history it reads, so the release sees the real gesture state. Returns
 * whether the handle claimed the touch at touch start. What jest cannot do is
 * the native negotiation between views, so a device check still stands.
 */
export function dragSheetHandle(handle: ReturnType<typeof screen.getByTestId>, dx: number, dy: number): boolean {
  const down = touchEvent({ startX: 100, startY: 100, x: 100, y: 100, t: 1 });
  const claimed = handle.props.onStartShouldSetResponder(down) as boolean;
  fireEvent(handle, "responderGrant", down);
  fireEvent(handle, "responderMove", touchEvent({ startX: 100, startY: 100, x: 100 + dx, y: 100 + dy, t: 2 }));
  fireEvent(handle, "responderRelease", touchEvent({ startX: 100, startY: 100, x: 100 + dx, y: 100 + dy, t: 3 }));
  return claimed;
}
