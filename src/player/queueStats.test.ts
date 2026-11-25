import { fmtDuration, queueStats } from "./queueStats";
import type { PlayerTrack } from "./types";
import type { TrackMetadata } from "./metadata/metadataStore";

const t = (fileId: string): PlayerTrack => ({ fileId, title: fileId, artist: "Mix", extension: "mp3", sizeBytes: 1, modifiedAt: 1 });
const m = (fileId: string, durationSec?: number): TrackMetadata => ({ fileId, durationSec, sizeBytes: 1, modifiedAt: 1 });

describe("fmtDuration", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(3661)).toBe("1:01:01");
  });
});

describe("queueStats", () => {
  it("counts tracks and totals only when every duration is known", () => {
    const queue = [t("a"), t("b")];
    expect(queueStats(queue, { a: m("a", 60) })).toEqual({ count: 2, totalLabel: null });
    expect(queueStats(queue, { a: m("a", 100), b: m("b", 200) })).toEqual({ count: 2, totalLabel: "5 min" });
    expect(queueStats([t("a")], { a: m("a", 4000) })).toEqual({ count: 1, totalLabel: "1 h 7 min" });
  });

  it("ignores stale entries (size/modified mismatch)", () => {
    const stale: TrackMetadata = { fileId: "a", durationSec: 60, sizeBytes: 999, modifiedAt: 1 };
    expect(queueStats([t("a")], { a: stale })).toEqual({ count: 1, totalLabel: null });
  });
});
