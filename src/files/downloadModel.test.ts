import {
  DONE_HOLD_MS,
  PROGRESS_STEP,
  SHOW_LINE_BYTES,
  shouldEmitProgress,
  downloadStats,
  progressCaption,
  ringState,
  type DownloadEntry,
} from "./downloadModel";

function entry(over: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    fileId: "f1",
    name: "match.mp4",
    phase: "downloading",
    written: 0,
    total: 0,
    startedAt: 1_000_000,
    ...over,
  };
}

describe("downloadStats", () => {
  it("computes percent, cumulative speed and eta from bytes and elapsed time", () => {
    // 100 MB of 500 MB in 10s -> 10 MB/s, 400 MB left, 40s to go.
    const s = downloadStats(
      entry({ written: 100 * 1024 * 1024, total: 500 * 1024 * 1024 }),
      1_010_000,
    );
    expect(s.pct).toBe(20);
    expect(s.bytesPerSec).toBeCloseTo(10 * 1024 * 1024, 0);
    expect(s.etaSec).toBeCloseTo(40, 1);
  });

  it("reports no eta while the total is still unknown", () => {
    const s = downloadStats(entry({ written: 5_000, total: 0 }), 1_005_000);
    expect(s.pct).toBe(0);
    expect(s.etaSec).toBeNull();
  });

  it("never reports more than 100 percent when the server over-reports bytes", () => {
    const s = downloadStats(entry({ written: 120, total: 100 }), 1_001_000);
    expect(s.pct).toBe(100);
    expect(s.etaSec).toBeNull();
  });

  it("reports no eta before any time has elapsed, rather than infinity", () => {
    const s = downloadStats(entry({ written: 0, total: 100 }), 1_000_000);
    expect(Number.isFinite(s.bytesPerSec)).toBe(true);
    expect(s.etaSec).toBeNull();
  });
});

describe("progressCaption", () => {
  it("names the bytes written, the rate and the time left", () => {
    const c = progressCaption(
      entry({ written: 100 * 1024 * 1024, total: 500 * 1024 * 1024 }),
      1_010_000,
    );
    expect(c).toBe("100.0 MB · 10.0 MB/s · 40s left");
  });

  it("omits the estimate rather than guessing while the total is unknown", () => {
    expect(progressCaption(entry({ written: 1024, total: 0 }), 1_001_000)).toBe(
      "1.0 KB · 1.0 KB/s",
    );
  });

  it("says what the unmeasurable save phase is doing instead of a stale rate", () => {
    const c = progressCaption(
      entry({ phase: "saving", written: 100, total: 100 }),
      1_010_000,
    );
    expect(c).toBe("Saving to your phone…");
  });

  it("names the failure and that the transfer resumes, not just that it broke", () => {
    const c = progressCaption(
      entry({ phase: "error", written: 50 * 1024 * 1024, total: 100 * 1024 * 1024 }),
      1_010_000,
    );
    expect(c).toContain("50.0 MB");
    expect(c.toLowerCase()).toContain("resume");
  });
});

describe("ringState", () => {
  it("is preparing while the total is still unknown", () => {
    expect(ringState(entry({ phase: "preparing" }))).toBe("preparing");
    expect(ringState(entry({ phase: "downloading", total: 0 }))).toBe("preparing");
  });

  it("counts only once there is a total to count against", () => {
    expect(ringState(entry({ phase: "downloading", written: 1, total: 100 }))).toBe("downloading");
  });

  it("is idle when there is no entry at all", () => {
    expect(ringState(undefined)).toBe("idle");
  });

  it("maps the remaining phases straight through", () => {
    expect(ringState(entry({ phase: "saving" }))).toBe("saving");
    expect(ringState(entry({ phase: "done" }))).toBe("done");
    expect(ringState(entry({ phase: "error" }))).toBe("error");
  });
});

describe("SHOW_LINE_BYTES", () => {
  it("is the 25MB threshold the progress line appears at", () => {
    expect(SHOW_LINE_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("shouldEmitProgress", () => {
  // Every emitted tick is a store write and a re-render. A fast local download
  // fires the native callback far more often than a 46px ring can show.
  it("holds back a tick that has barely moved and is not yet due", () => {
    expect(shouldEmitProgress({ pct: 0.40, at: 1_000 }, 0.405, 1_050)).toBe(false);
  });

  it("emits once the step is worth drawing", () => {
    expect(shouldEmitProgress({ pct: 0.40, at: 1_000 }, 0.42, 1_050)).toBe(true);
  });

  // On a slow connection a 2%-only rule would leave the ring frozen for
  // minutes, which is the exact complaint this work started from.
  it("emits on time alone when the bytes are crawling", () => {
    expect(shouldEmitProgress({ pct: 0.40, at: 1_000 }, 0.401, 1_400)).toBe(true);
  });

  it("always emits the last tick, so the ring never stops one step short", () => {
    expect(shouldEmitProgress({ pct: 0.99, at: 1_000 }, 1, 1_001)).toBe(true);
  });

  it("emits the very first tick, so pressing down shows something immediately", () => {
    expect(shouldEmitProgress(null, 0.001, 1_000)).toBe(true);
  });
});

describe("timings", () => {
  it("throttles to the same 2% step the upload controller uses", () => {
    expect(PROGRESS_STEP).toBe(0.02);
  });

  it("holds the saved state long enough to read, and not longer", () => {
    expect(DONE_HOLD_MS).toBe(1600);
  });
});
