import { autoScrollStep, canDragInView, canDropOn, itemsForDrag, moveCount, mostCommon } from "./dragMove";

describe("autoScrollStep", () => {
  const area = { y: 100, h: 600 };
  it("does not scroll until the finger has moved away from where the hold began, even inside the edge band", () => {
    const r = autoScrollStep({ finger: { x: 100, y: 124 }, start: { x: 100, y: 120 }, area, armed: false, scrollY: 300, maxScrollY: 1400 });
    expect(r).toEqual({ next: null, armed: false });
  });
  it("arms once the finger has travelled far enough, and stays armed when it comes back", () => {
    const first = autoScrollStep({ finger: { x: 100, y: 200 }, start: { x: 100, y: 120 }, area, armed: false, scrollY: 300, maxScrollY: 1400 });
    expect(first.armed).toBe(true);
    expect(first.next).toBeNull();
    const back = autoScrollStep({ finger: { x: 100, y: 120 }, start: { x: 100, y: 120 }, area, armed: first.armed, scrollY: 300, maxScrollY: 1400 });
    expect(back).toEqual({ next: 290, armed: true });
  });
  it("scrolls down near the bottom edge and stops at the end of the content", () => {
    expect(autoScrollStep({ finger: { x: 100, y: 690 }, start: { x: 100, y: 400 }, area, armed: true, scrollY: 0, maxScrollY: 1400 }).next).toBe(10);
    expect(autoScrollStep({ finger: { x: 100, y: 690 }, start: { x: 100, y: 400 }, area, armed: true, scrollY: 1395, maxScrollY: 1400 }).next).toBe(1400);
    expect(autoScrollStep({ finger: { x: 100, y: 690 }, start: { x: 100, y: 400 }, area, armed: true, scrollY: 1400, maxScrollY: 1400 }).next).toBeNull();
  });
  it("never scrolls above the top, and leaves the middle alone", () => {
    expect(autoScrollStep({ finger: { x: 100, y: 110 }, start: { x: 100, y: 400 }, area, armed: true, scrollY: 0, maxScrollY: 1400 }).next).toBeNull();
    expect(autoScrollStep({ finger: { x: 100, y: 400 }, start: { x: 100, y: 100 }, area, armed: true, scrollY: 500, maxScrollY: 1400 }).next).toBeNull();
  });
});

describe("itemsForDrag", () => {
  const files = new Set(["f1", "f2"]);
  const folders = new Set(["d1"]);

  it("carries the whole selection when the dragged item is part of it", () => {
    expect(itemsForDrag({ id: "f2", kind: "file" }, files, folders)).toEqual({ fileIds: ["f1", "f2"], folderIds: ["d1"] });
    expect(itemsForDrag({ id: "d1", kind: "folder" }, files, folders)).toEqual({ fileIds: ["f1", "f2"], folderIds: ["d1"] });
  });

  it("carries only the dragged item when it is not selected", () => {
    expect(itemsForDrag({ id: "f9", kind: "file" }, files, folders)).toEqual({ fileIds: ["f9"], folderIds: [] });
    expect(itemsForDrag({ id: "d9", kind: "folder" }, files, folders)).toEqual({ fileIds: [], folderIds: ["d9"] });
  });
});

describe("moveCount", () => {
  it("adds files and folders", () => {
    expect(moveCount({ fileIds: ["a", "b"], folderIds: ["c"] })).toBe(3);
    expect(moveCount({ fileIds: [], folderIds: [] })).toBe(0);
  });
});

describe("canDropOn", () => {
  const items = { fileIds: ["f1"], folderIds: ["d1"] };

  it("refuses an empty drag", () => {
    expect(canDropOn({ fileIds: [], folderIds: [] }, "d2", null)).toBe(false);
  });

  it("refuses a folder dropped onto itself", () => {
    expect(canDropOn(items, "d1", null)).toBe(false);
  });

  it("refuses the folder the items are already listed in", () => {
    expect(canDropOn(items, "src", "src")).toBe(false);
    expect(canDropOn(items, null, null)).toBe(false);
  });

  it("accepts another folder", () => {
    expect(canDropOn(items, "d2", "src")).toBe(true);
    expect(canDropOn(items, "d2", null)).toBe(true);
  });

  it("only applies the self rule when the source folder is unknown", () => {
    expect(canDropOn(items, "d2", undefined)).toBe(true);
    expect(canDropOn(items, "d1", undefined)).toBe(false);
  });
});

describe("canDragInView", () => {
  it("allows the folder listing and refuses library and hidden views", () => {
    expect(canDragInView({ isLibrary: false, isHidden: false })).toBe(true);
    expect(canDragInView({ isLibrary: true, isHidden: false })).toBe(false);
    expect(canDragInView({ isLibrary: false, isHidden: true })).toBe(false);
  });
});

describe("mostCommon", () => {
  it("picks the most frequent string, first seen on a tie, null for none", () => {
    expect(mostCommon(["a", "b", "b"])).toBe("b");
    expect(mostCommon(["a", "b"])).toBe("a");
    expect(mostCommon([])).toBeNull();
  });
});
