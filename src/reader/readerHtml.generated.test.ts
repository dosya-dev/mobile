import { READER_HTML } from "./readerHtml.generated";

/**
 * readerHtml.generated.ts is an esbuild-minified bundle of reader-page/main.js
 * checked into the tree, and it is what actually ships - the WebView never
 * loads main.js. Asserting on main.js would therefore pass even if someone
 * edited the source and forgot `npm run build:reader`, leaving the shipped
 * bundle stale. These assertions run against the generated artifact.
 */
describe("READER_HTML", () => {
  it("contains a real bundle, not a stub", () => {
    expect(READER_HTML).toContain("<!doctype html>");
    expect(READER_HTML).not.toContain("<!--INJECT:BUNDLE-->");
    expect(READER_HTML.length).toBeGreaterThan(50_000);
  });

  it("enables the paginator's animated page turns", () => {
    // The attribute is the sole switch for foliate's eased page-turn
    // animation: paginator.js's #scrollTo assigns the offset instantly unless
    // hasAttribute('animated'). Minification rewrites identifiers but not
    // string literals, so both the setter and the paginator's own checks
    // survive verbatim.
    expect(READER_HTML).toContain('setAttribute?.("animated","")');
    expect(READER_HTML).toContain('hasAttribute("animated")');
  });

  it("classifies taps from touch events and exposes the host-driven page turn", () => {
    // The tap model lives on the host (bridge.ts's decideTap): the page
    // reports taps with a position and swipes, and turns pages only when
    // told to via __dosyaTurn. A stale bundle would still carry the old
    // click-based in-page zones and never post a swipe.
    expect(READER_HTML).toContain("__dosyaTurn");
    expect(READER_HTML).toContain('"touchend"');
    expect(READER_HTML).toContain('"swipe"');
  });

  it("still sets paginated flow alongside it", () => {
    // Animation only applies to paginated flow - a scrolled renderer has no
    // page turns to animate. If flow ever stops being set, the animation
    // assertion above would pass while doing nothing on device.
    expect(READER_HTML).toContain('setAttribute?.("flow","paginated")');
  });
});
