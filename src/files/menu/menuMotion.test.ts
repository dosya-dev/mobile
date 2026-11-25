import { CLOSE_MS, MENU_WIDTH, OPEN_SPRING, ROW_STAGGER_MS, SCRIM_MAX, SHIFT, shouldClose, shouldOpen } from "./menuMotion";

describe("menu motion constants", () => {
  it("is 80% of the screen, at most 340 pt", () => {
    expect(MENU_WIDTH(390)).toBe(312);
    expect(MENU_WIDTH(1024)).toBe(340);
  });

  it("uses the approved spring and timings", () => {
    expect(OPEN_SPRING).toEqual({ damping: 26, stiffness: 260, mass: 1, overshootClamping: true });
    expect(CLOSE_MS).toBe(240);
    expect(SCRIM_MAX).toBe(0.38);
    expect(SHIFT).toBe(18);
    expect(ROW_STAGGER_MS).toBe(20);
  });
});

describe("shouldClose", () => {
  const W = 300;
  it.each([
    [0, 0, false],
    [-50, 0, false], // a short drag springs back
    [-105, 0, false], // exactly 35% is not past it
    [-106, 0, true], // past 35% of the width
    [-20, -501, true], // a fast flick left
    [-20, -500, false], // 500 pt/s is not faster than 500
    [-200, 800, true], // far enough, even moving right at release
    [40, 0, false], // dragged right
  ])("dx %p vx %p -> %p", (dx, vx, expected) => {
    expect(shouldClose(dx, vx, W)).toBe(expected);
  });
});

describe("shouldOpen (edge swipe)", () => {
  const W = 300;
  it.each([
    [10, 0, false],
    [106, 0, true],
    [20, 501, true],
    [200, -600, false], // flicked back towards the edge
  ])("dx %p vx %p -> %p", (dx, vx, expected) => {
    expect(shouldOpen(dx, vx, W)).toBe(expected);
  });
});
