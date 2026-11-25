import { pageFromOffset } from "./pagerIndex";

// The settled page of the horizontal file pager, read back from the native
// contentOffset.x. Task 3 measured iOS in RTL on a simulator: the offset stays
// LEFT based and page 0 sits at the RIGHT, so page i is at x = (n-1-i)*w.
// The Android rows come from reading React Native 0.81 source
// (ReactHorizontalScrollView reports raw getScrollX(), page 0 at the maximum
// in RTL); they are "from source", not yet seen on a device.
type Row = [label: string, x: number, width: number, count: number, rtl: boolean, platform: "ios" | "android", page: number];

const ROWS: Row[] = [
  ["LTR ios", 750, 375, 5, false, "ios", 2],
  ["LTR android", 750, 375, 5, false, "android", 2],
  ["LTR ios first page", 0, 375, 5, false, "ios", 0],
  ["LTR ios last page", 1500, 375, 5, false, "ios", 4],
  // Device evidence (iPhone 17 simulator, w=378): scrollToIndex(0..4) reported 1512, 1134, 756, 378, 0.
  ["RTL ios page 0 (device)", 1512, 378, 5, true, "ios", 0],
  ["RTL ios page 1 (device)", 1134, 378, 5, true, "ios", 1],
  ["RTL ios page 2 (device)", 756, 378, 5, true, "ios", 2],
  ["RTL ios page 3 (device)", 378, 378, 5, true, "ios", 3],
  ["RTL ios page 4 (device)", 0, 378, 5, true, "ios", 4],
  ["RTL android page 0 (from source)", 1512, 378, 5, true, "android", 0],
  ["RTL android page 1 (from source)", 1134, 378, 5, true, "android", 1],
  ["RTL android page 3 (from source)", 378, 378, 5, true, "android", 3],
  ["RTL android page 4 (from source)", 0, 378, 5, true, "android", 4],
  // A settle a few points off a page boundary still rounds to that page.
  ["RTL ios near page 1", 1130.4, 378, 5, true, "ios", 1],
  ["LTR ios near page 3", 1127.8, 375, 5, false, "ios", 3],
];

it.each(ROWS)("%s: x=%d w=%d n=%d -> page %#", (_label, x, width, count, rtl, platform, page) => {
  expect(pageFromOffset(x, width, count, { rtl, platform })).toBe(page);
});

describe("out of range offsets clamp to a real page", () => {
  it.each([
    // Overscroll past either end (iOS bounce) reports offsets outside the content.
    [-200, false, 0],
    [5000, false, 4],
    [-200, true, 4],
    [5000, true, 0],
  ])("x=%d rtl=%s -> %d", (x, rtl, page) => {
    for (const platform of ["ios", "android"] as const) {
      expect(pageFromOffset(x, 375, 5, { rtl, platform })).toBe(page);
    }
  });

  it("returns page 0 for a list of one, and before the pager is measured", () => {
    expect(pageFromOffset(0, 375, 1, { rtl: true, platform: "ios" })).toBe(0);
    expect(pageFromOffset(300, 0, 5, { rtl: false, platform: "ios" })).toBe(0);
    expect(pageFromOffset(300, 375, 0, { rtl: true, platform: "android" })).toBe(0);
  });
});
