import { DOSYA_LOGO_SVG_DARK, DOSYA_LOGO_SVG_LIGHT, dosyaLogoSvg } from "./brandLogoSvg";

/**
 * `DosyaLogo` renders these strings through `SvgXml` from "react-native-svg".
 *
 * That parser only understands presentation attributes - the CSS middleware that
 * resolves `<style>` rules lives behind the separate "react-native-svg/css" entry
 * point, and xml.tsx never imports it. So the generated mark must carry every
 * colour as an attribute: `currentColor` for the ink (mapped from the Svg `color`
 * prop) and a literal hex for the seal.
 */
describe("dosyaLogoSvg", () => {
  it.each([DOSYA_LOGO_SVG_LIGHT, DOSYA_LOGO_SVG_DARK])("carries no <style> block or class for SvgXml to drop", (svg) => {
    expect(svg).not.toMatch(/<style[\s>]/i);
    expect(svg).not.toMatch(/class=/i);
  });

  it("strokes the folder with currentColor so the theme foreground colours it", () => {
    expect(DOSYA_LOGO_SVG_LIGHT).toMatch(/<path\b[^>]*stroke="currentColor"/);
    expect(DOSYA_LOGO_SVG_DARK).toMatch(/<path\b[^>]*stroke="currentColor"/);
  });

  it("bakes the brand green seal per scheme", () => {
    expect(DOSYA_LOGO_SVG_LIGHT).toMatch(/<circle\b[^>]*fill="#16a34a"/);
    expect(DOSYA_LOGO_SVG_DARK).toMatch(/<circle\b[^>]*fill="#22c55e"/);
    expect(dosyaLogoSvg("light")).toBe(DOSYA_LOGO_SVG_LIGHT);
    expect(dosyaLogoSvg("dark")).toBe(DOSYA_LOGO_SVG_DARK);
  });

  it("no longer carries the amber stock-folder palette", () => {
    for (const svg of [DOSYA_LOGO_SVG_LIGHT, DOSYA_LOGO_SVG_DARK]) {
      for (const colour of ["#e59015", "#ffbd17", "#262626"]) expect(svg.toLowerCase()).not.toContain(colour);
    }
  });
});
