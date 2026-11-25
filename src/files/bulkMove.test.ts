import { describeMoveOutcome, liveTwinIds, moveItems, runBulk } from "./bulkMove";
import type { T } from "@/i18n/translator";

describe("runBulk", () => {
  it("runs every task, counts rejections instead of throwing, and keeps at most `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const res = await runBulk([1, 2, 3, 4, 5], async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      if (n === 3) throw new Error("no");
      return n * 10;
    }, 2);
    expect(res).toEqual({ ok: 4, fail: 1, results: [10, 20, null, 40, 50] });
    expect(peak).toBe(2);
  });

  it("answers immediately for no items", async () => {
    expect(await runBulk([], async () => 1)).toEqual({ ok: 0, fail: 0, results: [] });
  });
});

const still = { id: "f1", name: "IMG.HEIC", live_video_id: "v1" };
const twin = { id: "v1", name: "IMG.MOV", live_video_id: null };
const plain = { id: "f2", name: "doc.pdf", live_video_id: null };

describe("liveTwinIds", () => {
  it("names the video of every selected still that is not itself selected", () => {
    expect(liveTwinIds([still, twin, plain], new Set(["f1", "f2"]))).toEqual(["v1"]);
  });
  it("names nothing when the video is already in the selection, or no still is", () => {
    expect(liveTwinIds([still, twin], new Set(["f1", "v1"]))).toEqual([]);
    expect(liveTwinIds([still, twin, plain], new Set(["f2"]))).toEqual([]);
  });
});

describe("moveItems", () => {
  it("moves files and folders to the destination and takes the twins along, uncounted", async () => {
    const moved: string[] = [];
    const out = await moveItems(
      { fileIds: ["f1", "f2"], folderIds: ["d1"] },
      "dest",
      ["v1"],
      {
        moveFile: async (id, folderId) => { moved.push(`file:${id}->${folderId}`); },
        moveFolder: async (id, parentId) => { moved.push(`folder:${id}->${parentId}`); },
      },
    );
    expect(moved.sort()).toEqual(["file:f1->dest", "file:f2->dest", "file:v1->dest", "folder:d1->dest"]);
    expect(out).toEqual({ ok: 3, fail: 0, reasons: [] });
  });

  it("counts a refused item and keeps the server's message as the reason", async () => {
    const out = await moveItems(
      { fileIds: ["f2"], folderIds: ["d1", "d2"] },
      null,
      [],
      {
        moveFile: async () => {},
        moveFolder: async (id) => { if (id === "d2") throw new Error("Cannot move a folder into its own subfolder"); },
      },
    );
    expect(out).toEqual({ ok: 2, fail: 1, reasons: ["Cannot move a folder into its own subfolder"] });
  });
});

describe("describeMoveOutcome", () => {
  const t = ((key: string, values?: Record<string, string | number>) => `${key}${values ? " " + JSON.stringify(values) : ""}`) as unknown as T;

  it("reports a clean move as a success count", () => {
    expect(describeMoveOutcome({ ok: 3, fail: 0, reasons: [] }, t)).toEqual({
      message: 'files.feedback.okPluralOneItemOtherItemsMoved {"ok":3}',
      kind: "success",
    });
  });

  it("names the server's reason alone when the only item failed", () => {
    expect(describeMoveOutcome({ ok: 0, fail: 1, reasons: ["Locked"] }, t)).toEqual({ message: "Locked", kind: "error" });
  });

  it("falls back to a generic reason when the failure had no message", () => {
    expect(describeMoveOutcome({ ok: 0, fail: 1, reasons: [] }, t)).toEqual({ message: "files.error.theFileCouldNotBeMoved", kind: "error" });
  });

  it("reports a partial move with counts and the most common reason", () => {
    expect(describeMoveOutcome({ ok: 2, fail: 2, reasons: ["A", "B", "B"] }, t)).toEqual({
      message: 'files.error.okMovedFailNotMovedReason {"ok":2,"fail":2,"reason":"B"}',
      kind: "error",
    });
  });
});
