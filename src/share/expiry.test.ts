import {
  EXPIRY_CHOICES, NEVER, CUSTOM, FALLBACK_EXPIRY_DAYS, FREE_MAX_EXPIRY_DAYS,
  choicesForDefault, choicesForExisting, daysForKey, isExpiryLockedOnFree, freeMaxExpiryAt,
} from "./expiry";

const NOW = 1_700_000_000;
const DAY = 86400;

describe("EXPIRY_CHOICES", () => {
  it("offers the same seven choices web does, up from the old four", () => {
    expect(EXPIRY_CHOICES.map((c) => c.label)).toEqual([
      "1 hour", "24 hours", "7 days", "30 days", "90 days", "Pick a date", "Never",
    ]);
  });

  // days: null keeps it out of daysForKey, so a caller that forgets to read the
  // picked date sends no expiry rather than a wrong one.
  it("marks the date chip as not a duration", () => {
    expect(CUSTOM.days).toBeNull();
    expect(daysForKey(EXPIRY_CHOICES, CUSTOM.key)).toBeUndefined();
  });

  it("spells never as 0 days, which is what the API reads as no expiry", () => {
    expect(NEVER.days).toBe(0);
  });

  it("expresses an hour as a fraction of a day, since the API floors to the second", () => {
    expect(EXPIRY_CHOICES.find((c) => c.key === "1h")?.days).toBeCloseTo(1 / 24);
  });
});

describe("choicesForDefault", () => {
  it("opens on the product fallback when the workspace sets none", () => {
    const { selectedKey } = choicesForDefault(null);
    expect(daysForKey(EXPIRY_CHOICES, selectedKey)).toBe(FALLBACK_EXPIRY_DAYS);
  });

  // The old picker listed Never first and opened on it, so every link the
  // sheet created defaulted to outliving the conversation.
  it("never opens on Never", () => {
    for (const d of [null, undefined, 0, -5, 7, 14, 400]) {
      expect(choicesForDefault(d).selectedKey).not.toBe(NEVER.key);
    }
  });

  it("selects the matching preset when the workspace default is one", () => {
    expect(choicesForDefault(30).selectedKey).toBe("30d");
  });

  it("adds the workspace's own value rather than rounding it to a preset", () => {
    const { choices, selectedKey } = choicesForDefault(14);
    const selected = choices.find((c) => c.key === selectedKey);
    expect(selected).toMatchObject({ label: "14 days", days: 14 });
  });

  it("keeps the row in duration order, with the two non-durations last", () => {
    const { choices } = choicesForDefault(14);
    expect(choices[choices.length - 1].key).toBe(NEVER.key);
    expect(choices[choices.length - 2].key).toBe(CUSTOM.key);
    const days = choices
      .filter((c) => c.key !== NEVER.key && c.key !== CUSTOM.key)
      .map((c) => c.days ?? 0);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("ignores a nonsensical default rather than offering it", () => {
    expect(daysForKey(EXPIRY_CHOICES, choicesForDefault(-1).selectedKey)).toBe(FALLBACK_EXPIRY_DAYS);
  });
});

describe("choicesForExisting", () => {
  it("selects Never for a link with no expiry", () => {
    expect(choicesForExisting(null, NOW).selectedKey).toBe(NEVER.key);
  });

  it("selects the preset a link's remaining time matches", () => {
    expect(choicesForExisting(NOW + 7 * DAY, NOW).selectedKey).toBe("7d");
  });

  it("shows a link's actual remaining time when it matches no preset", () => {
    const { choices, selectedKey } = choicesForExisting(NOW + 40 * DAY, NOW);
    expect(choices.find((c) => c.key === selectedKey)).toMatchObject({ label: "40 days left", days: 40 });
    expect(choices[choices.length - 1].key).toBe(NEVER.key);
  });

  it("offers the date chip on an existing link too", () => {
    expect(choicesForExisting(NOW + 40 * DAY, NOW).choices.some((c) => c.key === CUSTOM.key)).toBe(true);
    expect(choicesForExisting(null, NOW).choices.some((c) => c.key === CUSTOM.key)).toBe(true);
  });

  it("selects nothing for an already-expired link rather than claiming a value", () => {
    expect(choicesForExisting(NOW - 1, NOW).selectedKey).toBe("");
  });
});

describe("daysForKey", () => {
  it("resolves a key to the days the payload should carry", () => {
    expect(daysForKey(EXPIRY_CHOICES, "90d")).toBe(90);
    expect(daysForKey(EXPIRY_CHOICES, "never")).toBe(0);
  });

  it("returns undefined for a key not in the list", () => {
    expect(daysForKey(EXPIRY_CHOICES, "nope")).toBeUndefined();
  });
});

// The API clamps a Free creator's links to 7 days without refusing, so these
// decide what the picker locks rather than letting the server cut it silently.
describe("Free plan expiry cap", () => {
  it("locks the choices that outlive 7 days, plus Pick a date", () => {
    expect(EXPIRY_CHOICES.filter(isExpiryLockedOnFree).map((c) => c.key)).toEqual(["30d", "90d", "custom", "never"]);
  });

  it("locks the date chip", () => {
    expect(isExpiryLockedOnFree(CUSTOM)).toBe(true);
  });

  it("locks a workspace or remaining-time chip past the cap, not one inside it", () => {
    const ws14 = choicesForDefault(14).choices.find((c) => c.key === "ws-14")!;
    expect(isExpiryLockedOnFree(ws14)).toBe(true);
    const left3 = choicesForExisting(NOW + 3 * DAY, NOW).choices.find((c) => c.key === "current")!;
    expect(isExpiryLockedOnFree(left3)).toBe(false);
  });

  it("opens on the cap when the workspace default is longer", () => {
    expect(choicesForDefault(30, FREE_MAX_EXPIRY_DAYS).selectedKey).toBe("7d");
    // Clamped to the preset, so no extra workspace chip is added either.
    expect(choicesForDefault(14, FREE_MAX_EXPIRY_DAYS).choices).toBe(EXPIRY_CHOICES);
  });

  it("keeps a shorter workspace default as it is", () => {
    expect(choicesForDefault(1, FREE_MAX_EXPIRY_DAYS).selectedKey).toBe("24h");
  });

  it("puts the latest expiry 7 days from now, the API's own clamp", () => {
    expect(freeMaxExpiryAt(NOW)).toBe(NOW + 7 * DAY);
  });
});
