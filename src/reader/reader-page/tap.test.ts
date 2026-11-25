import { createTouchClassifier, SWIPE_MIN_PX, TAP_MAX_MS, TAP_SLOP_PX } from "./tap";

const gesture = (from: [number, number], to: [number, number], ms: number, via: [number, number][] = []) => {
  const c = createTouchClassifier();
  c.start(from[0], from[1], 1000);
  for (const [x, y] of via) c.move(x, y);
  c.move(to[0], to[1]);
  return c.end(to[0], to[1], 1000 + ms);
};

it("calls a still, quick touch a tap", () => {
  expect(gesture([100, 200], [100, 200], 80)).toBe("tap");
});

it("tolerates finger wobble inside the slop", () => {
  expect(gesture([100, 200], [100 + TAP_SLOP_PX, 200], 80)).toBe("tap");
});

it("does not call a long press a tap (that is a text selection)", () => {
  expect(gesture([100, 200], [100, 200], TAP_MAX_MS + 1)).toBeNull();
});

it("does not call a touch that wandered past the slop a tap, even if it came back", () => {
  expect(gesture([100, 200], [100, 200], 80, [[130, 200]])).toBeNull();
});

it("calls a horizontal drag past the threshold a swipe in either direction", () => {
  expect(gesture([300, 200], [300 - SWIPE_MIN_PX, 205], 250)).toBe("swipe");
  expect(gesture([100, 200], [100 + SWIPE_MIN_PX, 195], 250)).toBe("swipe");
});

it("ignores a short drag and a vertical drag", () => {
  expect(gesture([100, 200], [100 + SWIPE_MIN_PX - 1, 200], 250)).toBeNull();
  expect(gesture([100, 200], [110, 300], 250)).toBeNull();
});

it("voids the gesture when a second finger touches down at any point (pinch)", () => {
  const c = createTouchClassifier();
  c.start(100, 200, 0, 2);
  expect(c.end(100, 200, 50)).toBeNull();

  c.start(100, 200, 0, 1);
  c.move(100, 200, 2);
  c.move(100, 200, 1);
  expect(c.end(100, 200, 50)).toBeNull();
});

it("returns nothing while another finger is still down, and nothing without a start", () => {
  const c = createTouchClassifier();
  c.start(100, 200, 0);
  expect(c.end(100, 200, 50, 1)).toBeNull();
  expect(c.end(100, 200, 60)).toBeNull();
});

it("forgets the gesture on cancel", () => {
  const c = createTouchClassifier();
  c.start(100, 200, 0);
  c.cancel();
  expect(c.end(100, 200, 50)).toBeNull();
});

describe("hold", () => {
  it("reports a still finger as holding, and stops once it moves", () => {
    const c = createTouchClassifier();
    c.start(100, 100, 0);
    expect(c.isHolding()).toBe(true);
    c.move(103, 102); // within slop - still a hold
    expect(c.isHolding()).toBe(true);
    c.move(160, 100); // past slop - now a drag
    expect(c.isHolding()).toBe(false);
  });

  it("is not holding before a touch starts, or after it ends", () => {
    const c = createTouchClassifier();
    expect(c.isHolding()).toBe(false);
    c.start(10, 10, 0);
    c.end(10, 10, 100);
    expect(c.isHolding()).toBe(false);
  });

  it("a second finger voids the hold", () => {
    const c = createTouchClassifier();
    c.start(10, 10, 0, 2);
    expect(c.isHolding()).toBe(false);
  });

  it("once consumed, lifting the finger yields no tap or swipe", () => {
    // The hold timer fired and already revealed the controls; the same
    // finger coming up must not then also turn a page.
    const c = createTouchClassifier();
    c.start(100, 100, 0);
    c.consume();
    expect(c.isHolding()).toBe(false);
    expect(c.end(100, 100, 600)).toBeNull();

    const d = createTouchClassifier();
    d.start(100, 100, 0);
    d.consume();
    expect(d.end(300, 100, 600)).toBeNull(); // would have been a swipe
  });

  it("a fresh touch after a consumed one classifies normally again", () => {
    const c = createTouchClassifier();
    c.start(100, 100, 0);
    c.consume();
    c.end(100, 100, 600);
    c.start(100, 100, 1000);
    expect(c.isHolding()).toBe(true);
    expect(c.end(100, 100, 1050)).toBe("tap");
  });
});
