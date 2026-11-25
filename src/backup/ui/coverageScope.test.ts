import { coverageScope, coverageWarning, formatDay } from "./coverageScope";
import { DEFAULT_BACKUP_FILTERS } from "@/backup/filters";

const SEP_17_2025 = 1_758_067_200; // 2025-09-17T00:00:00Z

describe("coverageScope", () => {
  it("says nothing when the filters cover the whole library and nothing is left out", () => {
    expect(coverageScope(DEFAULT_BACKUP_FILTERS, 10_062, 10_062)).toBeNull();
  });

  it("names a date floor", () => {
    expect(coverageScope({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, 10_062, 1_380)).toBe(
      `Since ${formatDay(SEP_17_2025)}`,
    );
  });

  it("names a folder selection", () => {
    expect(coverageScope({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a", "b", "c"] }, 10_062, 1_380)).toBe("3 folders");
    expect(coverageScope({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a"] }, 100, 40)).toBe("1 folder");
  });

  it("names a media-type restriction", () => {
    expect(coverageScope({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] }, 100, 90)).toBe("Photos only");
  });

  it("combines every narrowing in one line", () => {
    const s = coverageScope(
      { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["video"], albumMode: "include", albumIds: ["a", "b"], dateFloor: SEP_17_2025 },
      10_062,
      12,
    );
    expect(s).toBe(`Videos only, 2 folders, since ${formatDay(SEP_17_2025)}`);
  });

  it("reports items left out even when no filter explains it", () => {
    // Nothing narrowed in settings, yet the eligible count is short: the
    // honest line is the number, not silence.
    expect(coverageScope(DEFAULT_BACKUP_FILTERS, 10_062, 1_380)).toBe("8682 more on this phone not included");
    expect(coverageScope(DEFAULT_BACKUP_FILTERS, 1_379, 1_380)).toBeNull();
  });
});

describe("coverageWarning", () => {
  it("is silent when nothing is left out, or when the counts are unknown", () => {
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, 1_380, 1_380)).toBeNull();
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, null, 1_380)).toBeNull();
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, 1_380, null)).toBeNull();
    // Two separate metadata reads can race a new photo; never claim "-1 older".
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, 1_379, 1_380)).toBeNull();
  });

  it("explains a date floor: what was chosen, how many older items it skips, where to change it", () => {
    const w = coverageWarning({ ...DEFAULT_BACKUP_FILTERS, dateFloor: SEP_17_2025 }, 13_380, 1_380);
    expect(w).toEqual({
      title: `Only photos and videos since ${formatDay(SEP_17_2025)} are backed up`,
      detail: "Backup was set to start from that date. 12000 older photos and videos on this phone are not backed up. Tap to change the start date.",
      target: "settings",
    });
  });

  it("explains a folder selection and sends the user to the folder picker", () => {
    const w = coverageWarning({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a", "b", "c"] }, 10_062, 1_380);
    expect(w).toEqual({
      title: "Only 3 folders are backed up",
      detail: "8682 photos and videos in other folders on this phone are not backed up. Tap to choose folders.",
      target: "folders",
    });
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, albumMode: "include", albumIds: ["a"] }, 100, 40)?.title).toBe(
      "Only 1 folder is backed up",
    );
  });

  it("explains a media-type restriction", () => {
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["photo"] }, 100, 90)).toEqual({
      title: "Videos are not backed up",
      detail: "10 videos on this phone are not backed up. Tap to include them.",
      target: "settings",
    });
    expect(coverageWarning({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["video"] }, 100, 10)?.title).toBe("Photos are not backed up");
  });

  it("names every narrowing when more than one applies", () => {
    const w = coverageWarning(
      { ...DEFAULT_BACKUP_FILTERS, mediaTypes: ["video"], albumMode: "include", albumIds: ["a", "b"], dateFloor: SEP_17_2025 },
      10_062,
      12,
    );
    expect(w).toEqual({
      title: "Not everything on this phone is backed up",
      detail: `Backup is limited to videos only, 2 folders, since ${formatDay(SEP_17_2025)}. 10050 other photos and videos are not backed up. Tap to change what gets backed up.`,
      target: "settings",
    });
  });

  it("says so even when no setting explains the shortfall", () => {
    expect(coverageWarning(DEFAULT_BACKUP_FILTERS, 10_062, 1_380)).toEqual({
      title: "Not everything on this phone is backed up",
      detail: "8682 photos and videos on this phone are not included in the backup. Tap to check what gets backed up.",
      target: "settings",
    });
  });
});
