import { coverPalette } from "./bookCover";

it("gives the same book the same cover every time", () => {
  expect(coverPalette("file_abc")).toEqual(coverPalette("file_abc"));
});

// A shelf where every cover is the same colour defeats the point of having
// covers at all.
it("spreads different books across the palette", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `file_${i}`);
  const distinct = new Set(ids.map((id) => coverPalette(id).from));
  expect(distinct.size).toBeGreaterThan(3);
});

it("always returns a usable pair, even with no id", () => {
  const p = coverPalette("");
  expect(p.from).toMatch(/^#[0-9a-f]{6}$/i);
  expect(p.to).toMatch(/^#[0-9a-f]{6}$/i);
});
