import { TOKENS_LIGHT, TOKENS_DARK, THEME_IDS, THEME_META, THEME_TOKENS, THEME_VARS } from "./tokens";

const HEX = /^#[0-9a-f]{6}$/i;

describe("theme tokens", () => {
  it("light and dark expose the same token names", () => {
    expect(Object.keys(TOKENS_LIGHT).sort()).toEqual(Object.keys(TOKENS_DARK).sort());
  });
  it("every value is a 6-digit hex color", () => {
    for (const v of [...Object.values(TOKENS_LIGHT), ...Object.values(TOKENS_DARK)]) {
      expect(v).toMatch(HEX);
    }
  });
  it("light background is brighter than dark background", () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(TOKENS_LIGHT.background)).toBeGreaterThan(lum(TOKENS_DARK.background));
  });
  it("primary differs from background in both schemes", () => {
    expect(TOKENS_LIGHT.primary).not.toBe(TOKENS_LIGHT.background);
    expect(TOKENS_DARK.primary).not.toBe(TOKENS_DARK.background);
  });
});

// tokens.ts is generated from apps/web/src/index.css - these guard the generator's
// trickier behaviour rather than restating its output.
describe("generated multi-theme tokens", () => {
  it("generates all 8 web themes", () => {
    expect(THEME_IDS).toEqual(["default", "mono", "claude", "amber", "ocean", "bubblegum", "vercel", "neo-brutal"]);
    expect(THEME_META).toHaveLength(8);
  });

  it("gives every theme a complete light and dark token set", () => {
    const expected = Object.keys(TOKENS_LIGHT).sort();
    for (const id of THEME_IDS) {
      expect(Object.keys(THEME_TOKENS[id].light).sort()).toEqual(expected);
      expect(Object.keys(THEME_TOKENS[id].dark).sort()).toEqual(expected);
    }
  });

  it("resolves tokens a theme omits via the CSS cascade", () => {
    // ocean's block doesn't declare --destructive; it must inherit :root's.
    expect(THEME_TOKENS.ocean.light.destructive).toBe(THEME_TOKENS.default.light.destructive);
  });

  it("actually differentiates the themes", () => {
    const primaries = new Set(THEME_IDS.map((id) => THEME_TOKENS[id].light.primary));
    expect(primaries.size).toBeGreaterThan(4);
    expect(THEME_TOKENS.ocean.light.primary).not.toBe(THEME_TOKENS.default.light.primary);
  });

  it("light and dark differ within every theme", () => {
    for (const id of THEME_IDS) {
      expect(THEME_TOKENS[id].light.background).not.toBe(THEME_TOKENS[id].dark.background);
    }
  });

  it("keeps the back-compat default exports pointing at the default theme", () => {
    expect(TOKENS_LIGHT).toBe(THEME_TOKENS.default.light);
    expect(TOKENS_DARK).toBe(THEME_TOKENS.default.dark);
  });

  it("emits vars as RGB channel triples matching global.css", () => {
    const v = THEME_VARS.default.dark["--bg"];
    expect(v).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    // global.css is emitted by the same generator from the same values, so this pins
    // the shared default: #131313, the dark ground from packages/brand. If the brand
    // package moves it, this fails and both files get regenerated together.
    expect(v).toBe("19 19 19");
  });
});
