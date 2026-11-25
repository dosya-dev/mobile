import { computeUploadStats } from "./stats";
import type { UploadItem } from "./types";

const mk = (over: Partial<UploadItem>): UploadItem => ({ id: String(Math.random()), name: "f", uri: "x", size: 100, mime: "image/jpeg", folderId: null, workspaceId: "w1", status: "queued", progress: 0, ...over });

describe("computeUploadStats", () => {
  it("sums totals, counts, and byte-level progress; derives speed + eta", () => {
    const items = [
      mk({ status: "done", size: 100, progress: 1 }),
      mk({ status: "uploading", size: 200, progress: 0.5 }), // 100 bytes uploaded
      mk({ status: "queued", size: 300 }),
      mk({ status: "error", size: 400 }),
    ];
    const s = computeUploadStats(items, 1000, 3000); // 2s elapsed
    expect(s.totalBytes).toBe(1000);
    expect(s.uploadedBytes).toBe(200);
    expect(s.remainingBytes).toBe(800);
    expect(s.doneCount).toBe(1);
    expect(s.uploadingCount).toBe(1);
    expect(s.activeCount).toBe(2);
    expect(s.erroredCount).toBe(1);
    expect(s.pct).toBe(20);
    expect(s.bytesPerSec).toBe(100); // 200 / 2s
    expect(s.etaSec).toBe(8); // 800 / 100
  });
  it("no speed/eta before a start time", () => {
    const s = computeUploadStats([mk({ status: "queued", size: 100 })], null, 5000);
    expect(s.bytesPerSec).toBe(0);
    expect(s.etaSec).toBeNull();
  });
});

describe("settled baseline", () => {
  it("adds folded items back into totals, progress, and speed", () => {
    const items = [
      { id: "bk_live", name: "a", uri: "u", size: 100, mime: "m", folderId: null, workspaceId: "w", status: "uploading", progress: 0.5 },
    ] as never;
    const s = computeUploadStats(items, 1_000_000, 1_010_000, { count: 9, bytes: 900 });
    expect(s.totalCount).toBe(10);
    expect(s.doneCount).toBe(9);
    expect(s.totalBytes).toBe(1000);
    expect(s.uploadedBytes).toBe(950);
    expect(s.pct).toBe(95);
    expect(s.bytesPerSec).toBe(95); // 950 bytes over 10s - folded work still counts
  });
});
