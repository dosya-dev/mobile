import { storageColor, stackedSegments, segmentColor, WS_SEGMENT_COLORS, type OwnedWorkspace } from "./helpers";

const ws = (id: string, used_bytes: number): OwnedWorkspace => ({
  id, name: id, icon_initials: "X", icon_color: "#000", icon_image_url: null,
  used_bytes, share_pct: 0,
});

describe("storageColor", () => {
  // The thresholds are the contract; the hexes come from the shared palette
  // (packages/brand) and are asserted there, so this checks the banding and that each
  // band is a distinct colour rather than pinning three literals in four places.
  it("bands at 70 and 90, with a distinct colour per band", () => {
    const ok = storageColor(0);
    expect(storageColor(70)).toBe(ok);
    const warn = storageColor(71);
    expect(storageColor(90)).toBe(warn);
    const critical = storageColor(91);
    expect(new Set([ok, warn, critical]).size).toBe(3);
  });

  it("has a colour for each band in both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const pct of [0, 80, 95]) expect(storageColor(pct, scheme)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("stackedSegments", () => {
  it("filters zero-usage rows (any position) and divides by the usedBytes param", () => {
    const segs = stackedSegments([ws("a", 0), ws("b", 30), ws("c", 10)], 50);
    expect(segs.map((s) => s.id)).toEqual(["b", "c"]);
    expect(segs[0].widthPct).toBeCloseTo(60);
    expect(segs[1].widthPct).toBeCloseTo(20);
  });
  it("returns [] when nothing is used", () => {
    expect(stackedSegments([ws("a", 0)], 0)).toEqual([]);
  });
});

it("carries the shared series palette, capped at five for colour-vision safety", () => {
  // Was 8 hardcoded hues here, and two more copies in web and desktop. The shared set is
  // five because a sixth drops the worst pair below the separation floor under simulated
  // deutan vision - see packages/brand/src/palette.test.mjs.
  expect(WS_SEGMENT_COLORS).toHaveLength(5);
  expect(new Set(WS_SEGMENT_COLORS).size).toBe(WS_SEGMENT_COLORS.length);
});

it("cycles segment colours past the end of the palette", () => {
  expect(segmentColor(0)).toBe(WS_SEGMENT_COLORS[0]);
  expect(segmentColor(WS_SEGMENT_COLORS.length)).toBe(WS_SEGMENT_COLORS[0]);
  expect(segmentColor(0, "dark")).not.toBe(segmentColor(0, "light"));
});
