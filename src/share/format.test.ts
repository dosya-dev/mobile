import {
  expiryLabel, expiryShort, statusTone, statusLabel, badgesFor,
  avatarLabel, avatarColor, summarySentence, timelinePeak, countryLabel,
} from "./format";
import type { ShareAnalytics } from "./types";

const NOW = 1_700_000_000;
const DAY = 86400;

const live = { is_revoked: 0, expires_at: null, revoked_at: null };

describe("expiryLabel", () => {
  it("says a link with no expiry never expires", () => {
    expect(expiryLabel(live, NOW)).toBe("Never expires");
  });

  it("counts whole days down", () => {
    expect(expiryLabel({ ...live, expires_at: NOW + 5 * DAY }, NOW)).toBe("5 days left");
  });

  // An earlier ceil-based version rendered 30 hours as "2 days left",
  // overstating the time left on exactly the links worth warning about.
  it("floors the day count instead of rounding it up", () => {
    expect(expiryLabel({ ...live, expires_at: NOW + 20 * 3600 }, NOW)).toBe("20 hours left");
    expect(expiryLabel({ ...live, expires_at: NOW + 30 * 3600 }, NOW)).toBe("1 day left");
    expect(expiryLabel({ ...live, expires_at: NOW + 47 * 3600 }, NOW)).toBe("1 day left");
    expect(expiryLabel({ ...live, expires_at: NOW + 49 * 3600 }, NOW)).toBe("2 days left");
  });

  it("never claims more time than the link actually has", () => {
    for (const hours of [25, 30, 47, 50, 71, 100, 121]) {
      const label = expiryLabel({ ...live, expires_at: NOW + hours * 3600 }, NOW);
      const claimed = Number(/^(\d+)/.exec(label)?.[1] ?? 0);
      expect(claimed * 24).toBeLessThanOrEqual(hours);
    }
  });

  it("drops to hours inside a day and to a vaguer phrase inside an hour", () => {
    expect(expiryLabel({ ...live, expires_at: NOW + 3600 }, NOW)).toBe("1 hour left");
    expect(expiryLabel({ ...live, expires_at: NOW + 120 }, NOW)).toBe("Under an hour left");
  });

  it("reports a past expiry as expired", () => {
    expect(expiryLabel({ ...live, expires_at: NOW - 1 }, NOW)).toBe("Expired");
  });

  // A revoked link's expires_at is often still in the future - it was killed
  // early. Showing "6 days left" on a link that stopped working is the one
  // wrong answer this function must never give.
  it("puts revoked ahead of any remaining time", () => {
    expect(expiryLabel({ is_revoked: 1, expires_at: NOW + 6 * DAY, revoked_at: NOW - 10 }, NOW)).toBe("Revoked");
  });
});

describe("expiryShort", () => {
  it("fits the same facts into a chip", () => {
    expect(expiryShort(live, NOW)).toBe("Never");
    expect(expiryShort({ ...live, expires_at: NOW + 3 * DAY }, NOW)).toBe("3d");
    expect(expiryShort({ ...live, expires_at: NOW + 30 * 3600 }, NOW)).toBe("1d");
    expect(expiryShort({ ...live, expires_at: NOW + 47 * 3600 }, NOW)).toBe("1d");
    expect(expiryShort({ ...live, expires_at: NOW + 600 }, NOW)).toBe("<1d");
    expect(expiryShort({ ...live, expires_at: NOW - 1 }, NOW)).toBe("Expired");
    expect(expiryShort({ is_revoked: 1, expires_at: NOW + DAY, revoked_at: NOW }, NOW)).toBe("Revoked");
  });
});

describe("status", () => {
  it("maps each API status to a tone the row can colour by", () => {
    expect(statusTone("active")).toBe("live");
    expect(statusTone("expiring")).toBe("warn");
    expect(statusTone("expired")).toBe("dead");
    expect(statusTone("revoked")).toBe("revoked");
  });

  it("labels a status for display", () => {
    expect(statusLabel("expiring")).toBe("Expiring");
  });
});

describe("badgesFor", () => {
  const open = { is_password_protected: 0, lock_mode: "none" as const, access_mode: "public" as const, recipient_count: 0 };

  it("shows nothing for a plain public link", () => {
    expect(badgesFor(open)).toEqual([]);
  });

  it("surfaces the password the list used to hide", () => {
    expect(badgesFor({ ...open, is_password_protected: 1 }).map((b) => b.key)).toEqual(["password"]);
  });

  it("surfaces a restricted link with its recipient count", () => {
    const [badge] = badgesFor({ ...open, access_mode: "restricted", recipient_count: 2 });
    expect(badge).toMatchObject({ key: "restricted", count: 2 });
  });

  it("surfaces view-only, the mode only the CLI could ever set", () => {
    expect(badgesFor({ ...open, lock_mode: "view_only" }).map((b) => b.key)).toEqual(["view_only"]);
  });

  it("orders restricted ahead of password so a narrow row keeps the strongest signal", () => {
    const keys = badgesFor({ is_password_protected: 1, lock_mode: "view_only", access_mode: "restricted", recipient_count: 1 })
      .map((b) => b.key);
    expect(keys).toEqual(["restricted", "password", "view_only"]);
  });
});

describe("avatarLabel", () => {
  it("prefers the extension the API supplies", () => {
    expect(avatarLabel("Q3-Forecast.pdf", "pdf")).toBe("PDF");
  });

  it("tolerates the dot-prefixed form the API sometimes returns", () => {
    expect(avatarLabel("Q3-Forecast.pdf", ".pdf")).toBe("PDF");
  });

  it("falls back to the name's own extension", () => {
    expect(avatarLabel("report.xlsx")).toBe("XLSX");
  });

  it("uses initials for a folder or a name with no extension", () => {
    expect(avatarLabel("Client deliverables")).toBe("CD");
    expect(avatarLabel("Archive")).toBe("AR");
  });

  it("never returns an empty tag", () => {
    expect(avatarLabel("   ")).toBe("?");
  });
});

describe("avatarColor", () => {
  it("is stable for a given name", () => {
    expect(avatarColor("Q3-Forecast.pdf")).toBe(avatarColor("Q3-Forecast.pdf"));
  });

  it("separates different names", () => {
    expect(avatarColor("a.txt")).not.toBe(avatarColor("zzzz-different.txt"));
  });

  it("always returns a hex colour", () => {
    for (const n of ["", "a", "Client deliverables", "𝕏.png"]) {
      expect(avatarColor(n)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("summarySentence", () => {
  const base = {
    link: {
      is_revoked: false, status: "active" as const, download_count: 12,
      access_mode: "public" as const,
    },
    reach: { visitors: 14 },
  } as unknown as ShareAnalytics;

  it("reads a public link's numbers and says the visitors are anonymous", () => {
    expect(summarySentence(base)).toBe(
      "14 people opened this link, and it has 12 downloads. Anyone holding the link can open it.",
    );
  });

  it("singularises one person and one download", () => {
    const one = { link: { ...base.link, download_count: 1 }, reach: { visitors: 1 } } as unknown as ShareAnalytics;
    expect(summarySentence(one)).toBe(
      "1 person opened this link, and it has 1 download. Anyone holding the link can open it.",
    );
  });

  it("says nobody else can open a restricted link", () => {
    const r = { link: { ...base.link, access_mode: "restricted" }, reach: { visitors: 2 } } as unknown as ShareAnalytics;
    expect(summarySentence(r)).toContain("Nobody else can open it.");
  });

  it("puts a revoked link in the past tense", () => {
    const rev = { link: { ...base.link, is_revoked: true, status: "revoked" }, reach: { visitors: 3 } } as unknown as ShareAnalytics;
    expect(summarySentence(rev)).toBe(
      "3 people opened this link before it was revoked. It cannot be opened again.",
    );
  });

  it("distinguishes an untouched live link from an untouched expired one", () => {
    const fresh = { link: { ...base.link }, reach: { visitors: 0 } } as unknown as ShareAnalytics;
    const gone = { link: { ...base.link, status: "expired" }, reach: { visitors: 0 } } as unknown as ShareAnalytics;
    expect(summarySentence(fresh)).toBe("Nobody has opened this link yet.");
    expect(summarySentence(gone)).toBe("Nobody opened this link before it expired.");
  });

  it("does not claim downloads on a link nobody opened", () => {
    const none = { link: { ...base.link, is_revoked: true }, reach: { visitors: 0 } } as unknown as ShareAnalytics;
    expect(summarySentence(none)).toBe("Nobody opened this link before it was revoked.");
  });
});

describe("timelinePeak", () => {
  it("scales to the tallest bar of either series", () => {
    expect(timelinePeak([{ day: "d", opens: 3, downloads: 9 }, { day: "e", opens: 4, downloads: 1 }])).toBe(9);
  });

  it("is 0 for an empty range, so the chart can show an empty state instead of dividing by it", () => {
    expect(timelinePeak([])).toBe(0);
  });
});

describe("countryLabel", () => {
  it("upper-cases a code and dashes a missing one", () => {
    expect(countryLabel("nl")).toBe("NL");
    expect(countryLabel(null)).toBe("-");
  });
});
