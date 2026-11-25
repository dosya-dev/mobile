import { READING_THEMES, APP_READER_THEMES, ALL_READER_THEMES, themeById, isKnownThemeId } from "./readerThemes";

const HEX = /^#[0-9a-f]{6}$/i;

describe("readerThemes", () => {
  it("reading group has exactly the three specified colors", () => {
    expect(READING_THEMES).toEqual([
      { id: "light", label: "Light", group: "reading", bg: "#ffffff", fg: "#1a1a1a" },
      { id: "sepia", label: "Sepia", group: "reading", bg: "#f4ecd8", fg: "#5b4636" },
      { id: "dark", label: "Dark", group: "reading", bg: "#121212", fg: "#c8c8c8" },
    ]);
  });

  it("app group includes every known app theme id", () => {
    const ids = APP_READER_THEMES.map((t) => t.id);
    for (const id of ["default", "mono", "claude", "amber", "ocean", "bubblegum", "vercel"]) {
      expect(ids).toContain(id);
    }
  });

  it("every app theme has a non-empty hex bg and fg, and is tagged app", () => {
    expect(APP_READER_THEMES.length).toBeGreaterThan(0);
    for (const t of APP_READER_THEMES) {
      expect(t.group).toBe("app");
      expect(t.bg).toMatch(HEX);
      expect(t.fg).toMatch(HEX);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("ALL_READER_THEMES is the reading group followed by the app group", () => {
    expect(ALL_READER_THEMES).toEqual([...READING_THEMES, ...APP_READER_THEMES]);
  });

  it("themeById falls back to light for an unknown id", () => {
    expect(themeById("nope")).toEqual(READING_THEMES[0]);
  });

  it("themeById resolves a known reading id", () => {
    expect(themeById("dark")).toEqual(READING_THEMES[2]);
  });

  it("themeById resolves a known app id to the app group", () => {
    expect(themeById("ocean").group).toBe("app");
  });

  it("isKnownThemeId is true for reading and app ids, false otherwise", () => {
    expect(isKnownThemeId("light")).toBe(true);
    expect(isKnownThemeId("sepia")).toBe(true);
    expect(isKnownThemeId("ocean")).toBe(true);
    expect(isKnownThemeId("nope")).toBe(false);
  });
});
