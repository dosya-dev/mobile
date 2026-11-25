/**
 * The page a horizontal, full-width pager has settled on, from the native
 * `contentOffset.x` it reports.
 *
 * In LTR page i sits at x = i * width. In RTL the content is laid out from the
 * right, but the reported offset stays LEFT based on both platforms, so page 0
 * is at the far right: page i sits at x = (count - 1 - i) * width.
 *
 * - iOS: measured on a simulator (Task 3 probe): scrollToIndex(0..4) on a
 *   5-page RTL pager reported x = 4w, 3w, 2w, w, 0.
 * - Android: from React Native 0.81 source, not yet seen on a device:
 *   ReactHorizontalScrollView reports the raw getScrollX(), and its RTL snap
 *   code measures offsets from the right edge, so page 0 is at the maximum.
 *
 * Only READING the offset needs this. Writing (FlatList scrollToIndex and
 * initialScrollIndex) needs no conversion on either platform: VirtualizedList
 * already turns the flow-relative offset into this left-based one in RTL
 * (`_scrollToParamsFromOffset`), and both native scrollTo commands take it raw.
 *
 * The result is clamped to [0, count - 1]: an overscroll bounce reports
 * offsets past either end.
 */
export function pageFromOffset(
  x: number,
  width: number,
  count: number,
  o: { rtl: boolean; platform: "ios" | "android" },
): number {
  if (!(width > 0) || count <= 1) return 0;
  const fromLeft = Math.round(x / width);
  // Same formula on both platforms; `platform` names which evidence backs it
  // (iOS from a device, Android from source) and is where a difference lands
  // if an Android device ever disagrees.
  const page = o.rtl ? count - 1 - fromLeft : fromLeft;
  return Math.min(count - 1, Math.max(0, page));
}
