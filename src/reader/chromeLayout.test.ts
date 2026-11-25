import { CHROME_BAND_SLACK, CHROME_BOTTOM_GAP, CHROME_BUTTON, CHROME_TOP_GAP, FALLBACK_BAND, chromeBands } from "./chromeLayout";

it("sizes each band to its inset, gap, button, and slack as a fraction of the page height", () => {
  const bands = chromeBands({ top: 59, bottom: 34 }, 844);
  expect(bands.top).toBeCloseTo((59 + CHROME_TOP_GAP + CHROME_BUTTON + CHROME_BAND_SLACK) / 844, 6);
  expect(bands.bottom).toBeCloseTo((34 + CHROME_BOTTOM_GAP + CHROME_BUTTON + CHROME_BAND_SLACK) / 844, 6);
});

it("falls back to a fixed band before the page height is known", () => {
  expect(chromeBands({ top: 59, bottom: 34 }, 0)).toEqual({ top: FALLBACK_BAND, bottom: FALLBACK_BAND });
  expect(chromeBands({ top: 59, bottom: 34 }, Number.NaN)).toEqual({ top: FALLBACK_BAND, bottom: FALLBACK_BAND });
});

it("never lets a band swallow the middle of a very short page", () => {
  const bands = chromeBands({ top: 59, bottom: 34 }, 200);
  expect(bands.top).toBeLessThanOrEqual(1 / 3);
  expect(bands.bottom).toBeLessThanOrEqual(1 / 3);
  expect(1 - bands.top - bands.bottom).toBeGreaterThanOrEqual(1 / 3);
});
