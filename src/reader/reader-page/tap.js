// Touch classifier for the reader page: turns a touchstart/touchmove/touchend
// sequence into a "tap" or "swipe" verdict (or neither).
//
// Bundled into the WebView page by scripts/build-reader.mjs and imported
// directly by tap.test.ts under jest - so no DOM in here, only numbers. The
// page used to rely on the browser synthesising a `click` for a tap on plain
// text inside foliate's section iframe; WebKit on iOS only does that for
// targets it deems clickable, which made tap-to-reveal unreliable. Touch
// events always fire, so the tap is derived from those instead.

/** Finger travel (CSS px) beyond which a touch stops counting as a tap. */
export const TAP_SLOP_PX = 10;
/** A finger held longer than this is a hold, not a tap. */
export const TAP_MAX_MS = 500;
/**
 * How long a still finger must stay down to reveal the controls.
 *
 * Deliberately the same threshold as TAP_MAX_MS: the moment a touch stops
 * being a tap it becomes a hold, so there is no dead window where a finger
 * is neither. The page fires this on a timer while the finger is still down
 * (see attachTouch) rather than on release - a reveal that waited for
 * touchend would feel like lag, not like a press.
 */
export const HOLD_MS = TAP_MAX_MS;
/** Horizontal travel (CSS px) from which a touch counts as a page swipe. */
export const SWIPE_MIN_PX = 30;

/**
 * One classifier per touch surface. Feed it the first changed touch of each
 * event plus the number of fingers still on the surface; `end()` returns
 * "tap", "swipe", or null. A second finger at any point (pinch-zoom) voids
 * the gesture, and so does lifting a finger while another is still down.
 *
 * The swipe verdict carries no direction: foliate's paginator performs the
 * actual page turn from the same touch sequence, the host only needs to
 * know that the reader was swiped so it can hide the controls.
 */
export function createTouchClassifier({ slop = TAP_SLOP_PX, maxTapMs = TAP_MAX_MS, swipeMin = SWIPE_MIN_PX } = {}) {
  let start = null;
  let moved = false;
  let voided = false;
  // Set once a hold has already acted on this touch, so the same finger
  // coming up cannot ALSO register as a tap or a swipe - without it, holding
  // still and releasing would reveal the controls and then immediately act
  // again on touchend.
  let consumed = false;
  return {
    start(x, y, t, touches = 1) {
      start = { x, y, t };
      moved = false;
      voided = touches > 1;
      consumed = false;
    },
    move(x, y, touches = 1) {
      if (!start) return;
      if (touches > 1) voided = true;
      if (Math.hypot(x - start.x, y - start.y) > slop) moved = true;
    },
    /**
     * Whether this touch is, right now, a finger resting still on the glass -
     * the state the hold timer checks when it fires.
     */
    isHolding() {
      return start !== null && !moved && !voided && !consumed;
    },
    /** Mark the gesture as already handled by a hold. */
    consume() {
      consumed = true;
    },
    end(x, y, t, remainingTouches = 0) {
      if (!start) return null;
      const s = start;
      start = null;
      if (consumed) return null;
      if (voided || remainingTouches > 0) return null;
      if (!moved && t - s.t <= maxTapMs) return "tap";
      const dx = x - s.x;
      const dy = y - s.y;
      if (Math.abs(dx) >= swipeMin && Math.abs(dx) > Math.abs(dy)) return "swipe";
      return null;
    },
    cancel() {
      start = null;
    },
  };
}
