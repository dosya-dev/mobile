import { deriveAttention, attentionHeading, type AttentionInput } from "./attention";

const quiet: AttentionInput = {
  unfinishedSetup: null,
  photoAccess: true,
  limited: false,
  filtersMigrated: true,
  nothingSelected: false,
  excluded: null,
  blockReason: null,
  network: null,
  runActive: false,
};

const ids = (i: Partial<AttentionInput>) => deriveAttention({ ...quiet, ...i }).map((a) => a.id);

describe("deriveAttention", () => {
  it("is empty for a settled, healthy install", () => {
    expect(deriveAttention(quiet)).toEqual([]);
  });

  it("orders setup problems before policy holds, worst first", () => {
    expect(
      ids({
        unfinishedSetup: "other",
        photoAccess: false,
        limited: true,
        nothingSelected: true,
        filtersMigrated: false,
        excluded: { title: "Only 3 folders are backed up", detail: "8682 photos and videos in other folders on this phone are not backed up. Tap to choose folders." },
        blockReason: "Storage limit reached.",
        network: "offline",
      }),
    ).toEqual(["finish-setup", "photo-access", "limited-access", "nothing-selected", "choose-what", "excluded", "blocked", "offline"]);
  });

  it("carries the scope warning through as an actionable warn row", () => {
    const [item] = deriveAttention({
      ...quiet,
      excluded: { title: "Only photos and videos since 17 Sep 2025 are backed up", detail: "12000 older photos and videos on this phone are not backed up." },
    });
    expect(item.id).toBe("excluded");
    expect(item.tone).toBe("warn");
    expect(item.actionable).toBe(true);
    expect(item.title).toMatch(/since 17 Sep 2025/);
    expect(item.detail).toMatch(/12000 older/);
  });

  it("names why setup is unfinished", () => {
    const [denied] = deriveAttention({ ...quiet, unfinishedSetup: "denied" });
    expect(denied.title).toBe("Finish setting up backup");
    expect(denied.detail).toMatch(/Photo access is still off/);
    const [other] = deriveAttention({ ...quiet, unfinishedSetup: "other" });
    expect(other.detail).toMatch(/not chosen what to back up/);
  });

  it("does not raise the photo item until the permission read has resolved", () => {
    // `null` = still checking. Flashing "Allow photo access" at a user who
    // already granted it is the bug the old primer guarded against.
    expect(ids({ photoAccess: null })).toEqual([]);
    expect(ids({ photoAccess: false })).toEqual(["photo-access"]);
  });

  it("carries the block reason into the paused item", () => {
    const [blocked] = deriveAttention({ ...quiet, blockReason: "Storage limit reached." });
    expect(blocked.id).toBe("blocked");
    expect(blocked.detail).toBe("Storage limit reached. Tap to retry.");
    expect(blocked.actionable).toBe(true);
  });

  it("punctuates a raw block reason before appending the retry hint", () => {
    // Reasons are server error strings and do not reliably end in a full stop.
    const [blocked] = deriveAttention({ ...quiet, blockReason: "Storage quota exceeded" });
    expect(blocked.detail).toBe("Storage quota exceeded. Tap to retry.");
  });

  it("makes the blocked row inert while uploads are still draining", () => {
    // For the seconds between the block and the last in-flight upload settling
    // the engine press means STOP; a "tap to retry" row must not do that.
    const [blocked] = deriveAttention({ ...quiet, blockReason: "Storage limit reached.", runActive: true });
    expect(blocked.actionable).toBe(false);
  });

  it("warns about the one-time filter migration as information, not a fault", () => {
    const [item] = deriveAttention({ ...quiet, filtersMigrated: false });
    expect(item.id).toBe("choose-what");
    expect(item.tone).toBe("info");
    expect(item.detail).toMatch(/including media saved by other apps/);
  });

  describe("network", () => {
    it("explains an idle wait for Wi-Fi", () => {
      const [item] = deriveAttention({ ...quiet, network: "waiting-for-wifi" });
      expect(item.id).toBe("waiting-for-wifi");
      expect(item.detail).toMatch(/Automatic backup pauses on mobile data/);
    });

    it("leaves a mid-run Wi-Fi hold to the ring, which already says it", () => {
      expect(ids({ network: "waiting-for-wifi", runActive: true })).toEqual([]);
    });

    it("warns that a run now would use mobile data", () => {
      const [item] = deriveAttention({ ...quiet, network: "cellular-data" });
      expect(item.tone).toBe("warn");
      expect(item.actionable).toBe(false);
      expect(item.detail).toMatch(/mobile data/);
    });

    it("reports offline as a wait, not a fault", () => {
      const [item] = deriveAttention({ ...quiet, network: "offline" });
      expect(item.tone).toBe("info");
      expect(item.detail).toMatch(/resumes when a connection returns/i);
    });

    it("leaves a mid-run offline hold to the ring as well", () => {
      // backupHoldReason reports "offline" mid-run, so the core already says it.
      expect(ids({ network: "offline", runActive: true })).toEqual([]);
    });
  });
});

describe("attentionHeading", () => {
  it("is silent for a single item - the row speaks for itself", () => {
    expect(attentionHeading(0, true)).toBeNull();
    expect(attentionHeading(1, true)).toBeNull();
  });
  it("counts the items, worded for the first run or for a settled install", () => {
    expect(attentionHeading(2, true)).toBe("2 things before the first backup");
    expect(attentionHeading(3, false)).toBe("3 things need attention");
  });
});
