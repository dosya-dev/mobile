import { flattenPdfOutline, parsePageLocation, pageLocation } from "./pdfToc";

it("flattens nested outline to TocItems with 1-based page hrefs", () => {
  const items = flattenPdfOutline([
    { title: "Ch 1", pageIdx: 0, children: [{ title: "1.1", pageIdx: 4 }] },
    { title: "Ch 2", pageIdx: 10 },
  ]);
  expect(items).toEqual([
    { label: "Ch 1", href: "1", depth: 0 },
    { label: "1.1", href: "5", depth: 1 },
    { label: "Ch 2", href: "11", depth: 0 },
  ]);
});

it("tolerates missing fields and undefined input", () => {
  expect(flattenPdfOutline(undefined)).toEqual([]);
  expect(flattenPdfOutline([{ children: [] }])).toEqual([{ label: "Untitled", href: "1", depth: 0 }]);
});

it("round-trips page locations and rejects garbage", () => {
  expect(pageLocation(12)).toBe("page:12");
  expect(parsePageLocation("page:12")).toBe(12);
  expect(parsePageLocation("cfi(/6/4)")).toBeNull();
  expect(parsePageLocation(null)).toBeNull();
  expect(parsePageLocation("page:0")).toBeNull(); // pages are 1-based
});
