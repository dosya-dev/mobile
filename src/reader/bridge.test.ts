import {
  parsePageMessage,
  readerReducer,
  INITIAL_UI,
  jsInit,
  jsChunk,
  jsGoTo,
  jsApply,
  jsOpen,
  jsSearch,
  jsSearchClear,
  jsTurn,
  decideTap,
  TURN_ZONE,
  allowsReaderNavigation,
  READER_BASE_URL,
} from "./bridge";

describe("parsePageMessage", () => {
  it("parses known messages", () => {
    expect(parsePageMessage('{"type":"loaded"}')).toEqual({ type: "loaded" });
    expect(parsePageMessage('{"type":"relocated","location":"cfi(a)","fraction":0.5,"section":"Ch 1"}'))
      .toEqual({ type: "relocated", location: "cfi(a)", fraction: 0.5, section: "Ch 1" });
  });
  it("rejects garbage and unknown types", () => {
    expect(parsePageMessage("not json")).toBeNull();
    expect(parsePageMessage('{"type":"nope"}')).toBeNull();
    expect(parsePageMessage('{"type":"relocated"}')).toBeNull(); // missing fields
  });
  it("tap parses its page-fraction position and rejects a tap without one", () => {
    expect(parsePageMessage('{"type":"tap","x":0.9,"y":0.05}')).toEqual({ type: "tap", x: 0.9, y: 0.05 });
    expect(parsePageMessage('{"type":"tap"}')).toBeNull();
    expect(parsePageMessage('{"type":"tap","x":"0.9","y":0.05}')).toBeNull();
    expect(parsePageMessage('{"type":"tap","x":null,"y":0.05}')).toBeNull();
  });
  it("swipe parses", () => {
    expect(parsePageMessage('{"type":"swipe"}')).toEqual({ type: "swipe" });
  });
  it("toc happy path parses valid items with label/href/depth", () => {
    expect(parsePageMessage('{"type":"toc","items":[{"label":"Chapter 1","href":"c1","depth":0},{"label":"Section 1.1","href":"s1","depth":1}]}'))
      .toEqual({ type: "toc", items: [{ label: "Chapter 1", href: "c1", depth: 0 }, { label: "Section 1.1", href: "s1", depth: 1 }] });
  });
  it("toc filters out malformed items and nulls", () => {
    const result = parsePageMessage('{"type":"toc","items":[{"label":"Valid","href":"v","depth":0},null,{"href":"no-label","depth":1}]}');
    expect(result).toEqual({ type: "toc", items: [{ label: "Valid", href: "v", depth: 0 }] });
  });
  it("toc with non-array items returns null", () => {
    expect(parsePageMessage('{"type":"toc","items":"not-an-array"}')).toBeNull();
    expect(parsePageMessage('{"type":"toc","items":null}')).toBeNull();
  });
  it("error happy path parses with string message", () => {
    expect(parsePageMessage('{"type":"error","message":"File corrupted"}')).toEqual({ type: "error", message: "File corrupted" });
  });
  it("error with non-string message returns null", () => {
    expect(parsePageMessage('{"type":"error","message":123}')).toBeNull();
    expect(parsePageMessage('{"type":"error","message":null}')).toBeNull();
    expect(parsePageMessage('{"type":"error"}')).toBeNull(); // missing message
  });
  it("relocated rejects wrong-typed fields", () => {
    expect(parsePageMessage('{"type":"relocated","location":"cfi(a)","fraction":"0.5","section":null}')).toBeNull(); // fraction as string
    expect(parsePageMessage('{"type":"relocated","location":123,"fraction":0.5,"section":null}')).toBeNull(); // location as number
  });
  it("externalLink happy path parses with string href", () => {
    expect(parsePageMessage('{"type":"externalLink","href":"https://example.com"}'))
      .toEqual({ type: "externalLink", href: "https://example.com" });
  });
  it("externalLink with non-string href returns null", () => {
    expect(parsePageMessage('{"type":"externalLink","href":123}')).toBeNull();
    expect(parsePageMessage('{"type":"externalLink","href":null}')).toBeNull();
    expect(parsePageMessage('{"type":"externalLink"}')).toBeNull(); // missing href
  });
  it("searchResults happy path parses valid hits", () => {
    expect(
      parsePageMessage(
        '{"type":"searchResults","gen":1,"items":[{"cfi":"epubcfi(/6/2!/4/2)","excerpt":"a match"},{"cfi":"epubcfi(/6/4!/2)","excerpt":"another"}]}',
      ),
    ).toEqual({
      type: "searchResults",
      gen: 1,
      items: [
        { cfi: "epubcfi(/6/2!/4/2)", excerpt: "a match" },
        { cfi: "epubcfi(/6/4!/2)", excerpt: "another" },
      ],
    });
  });
  it("searchResults drops malformed items and keeps valid ones", () => {
    const result = parsePageMessage(
      '{"type":"searchResults","gen":1,"items":[{"cfi":"c1","excerpt":"ok"},null,{"cfi":"no-excerpt"},{"excerpt":"no-cfi"},{"cfi":123,"excerpt":"bad-cfi-type"}]}',
    );
    expect(result).toEqual({ type: "searchResults", gen: 1, items: [{ cfi: "c1", excerpt: "ok" }] });
  });
  it("searchResults with non-array items returns null", () => {
    expect(parsePageMessage('{"type":"searchResults","gen":1,"items":"not-an-array"}')).toBeNull();
    expect(parsePageMessage('{"type":"searchResults","gen":1,"items":null}')).toBeNull();
    expect(parsePageMessage('{"type":"searchResults","gen":1}')).toBeNull();
  });
  it("searchResults rejects a missing or non-number gen", () => {
    expect(parsePageMessage('{"type":"searchResults","items":[{"cfi":"c1","excerpt":"ok"}]}')).toBeNull(); // missing gen
    expect(parsePageMessage('{"type":"searchResults","gen":"1","items":[{"cfi":"c1","excerpt":"ok"}]}')).toBeNull(); // gen as string
    expect(parsePageMessage('{"type":"searchResults","gen":null,"items":[{"cfi":"c1","excerpt":"ok"}]}')).toBeNull();
  });
  it("searchDone happy path parses", () => {
    expect(parsePageMessage('{"type":"searchDone","gen":1}')).toEqual({ type: "searchDone", gen: 1 });
  });
  it("searchDone rejects a missing or non-number gen", () => {
    expect(parsePageMessage('{"type":"searchDone"}')).toBeNull();
    expect(parsePageMessage('{"type":"searchDone","gen":"1"}')).toBeNull();
    expect(parsePageMessage('{"type":"searchDone","gen":null}')).toBeNull();
  });
  it("searchError happy path parses with string message", () => {
    expect(parsePageMessage('{"type":"searchError","gen":1,"message":"Search failed."}'))
      .toEqual({ type: "searchError", gen: 1, message: "Search failed." });
  });
  it("searchError with non-string message returns null", () => {
    expect(parsePageMessage('{"type":"searchError","gen":1,"message":123}')).toBeNull();
    expect(parsePageMessage('{"type":"searchError","gen":1,"message":null}')).toBeNull();
    expect(parsePageMessage('{"type":"searchError","gen":1}')).toBeNull(); // missing message
  });
  it("searchError rejects a missing or non-number gen", () => {
    expect(parsePageMessage('{"type":"searchError","message":"Search failed."}')).toBeNull(); // missing gen
    expect(parsePageMessage('{"type":"searchError","gen":"1","message":"Search failed."}')).toBeNull(); // gen as string
    expect(parsePageMessage('{"type":"searchError","gen":null,"message":"Search failed."}')).toBeNull();
  });
});

describe("readerReducer", () => {
  it("moves to ready on first relocated", () => {
    const s = readerReducer(INITIAL_UI, { type: "relocated", location: "cfi(a)", fraction: 0.25, section: null });
    expect(s.status).toBe("ready");
    expect(s.location).toBe("cfi(a)");
    expect(s.fraction).toBe(0.25);
  });
  it("stores toc", () => {
    const s = readerReducer(INITIAL_UI, { type: "toc", items: [{ label: "One", href: "c1", depth: 0 }] });
    expect(s.toc).toHaveLength(1);
  });
  it("tap is a state no-op - its meaning needs the page geometry, see decideTap", () => {
    const before = { ...INITIAL_UI, status: "ready" as const, chromeVisible: false };
    expect(readerReducer(before, { type: "tap", x: 0.5, y: 0.5 })).toEqual(before);
  });
  it("swipe hides the chrome", () => {
    expect(readerReducer({ ...INITIAL_UI, chromeVisible: true }, { type: "swipe" }).chromeVisible).toBe(false);
    expect(readerReducer({ ...INITIAL_UI, chromeVisible: false }, { type: "swipe" }).chromeVisible).toBe(false);
  });
  it("toggleChrome flips chrome", () => {
    const s1 = readerReducer(INITIAL_UI, { type: "toggleChrome" });
    expect(s1.chromeVisible).toBe(!INITIAL_UI.chromeVisible);
    expect(readerReducer(s1, { type: "toggleChrome" }).chromeVisible).toBe(INITIAL_UI.chromeVisible);
  });
});

describe("decideTap", () => {
  const bands = { top: 0.15, bottom: 0.15 };

  it("hides the chrome and turns nothing when the chrome is showing, wherever the tap lands", () => {
    for (const tap of [{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }, { x: 0.95, y: 0.05 }, { x: 0.5, y: 0.5 }]) {
      expect(decideTap(tap, true, bands)).toEqual({ chrome: false, turn: 0 });
    }
  });

  it("shows the chrome from the top and bottom bands when hidden, even at the page edges", () => {
    expect(decideTap({ x: 0.95, y: 0.05 }, false, bands)).toEqual({ chrome: true, turn: 0 });
    expect(decideTap({ x: 0.05, y: 0.05 }, false, bands)).toEqual({ chrome: true, turn: 0 });
    expect(decideTap({ x: 0.95, y: 0.95 }, false, bands)).toEqual({ chrome: true, turn: 0 });
    expect(decideTap({ x: 0.5, y: 0.14 }, false, bands)).toEqual({ chrome: true, turn: 0 });
  });

  it("turns pages from the outer quarters of the middle band when hidden", () => {
    expect(decideTap({ x: TURN_ZONE - 0.01, y: 0.5 }, false, bands)).toEqual({ chrome: false, turn: -1 });
    expect(decideTap({ x: 1 - TURN_ZONE + 0.01, y: 0.5 }, false, bands)).toEqual({ chrome: false, turn: 1 });
    expect(decideTap({ x: 0.95, y: 0.16 }, false, bands)).toEqual({ chrome: false, turn: 1 });
  });

  it("shows the chrome from the centre of the middle band when hidden", () => {
    expect(decideTap({ x: 0.5, y: 0.5 }, false, bands)).toEqual({ chrome: true, turn: 0 });
    expect(decideTap({ x: TURN_ZONE, y: 0.5 }, false, bands)).toEqual({ chrome: true, turn: 0 });
    expect(decideTap({ x: 1 - TURN_ZONE, y: 0.5 }, false, bands)).toEqual({ chrome: true, turn: 0 });
  });

  it("clamps out-of-range fractions instead of misreading them", () => {
    expect(decideTap({ x: 1.4, y: 0.5 }, false, bands)).toEqual({ chrome: false, turn: 1 });
    expect(decideTap({ x: -0.2, y: 0.5 }, false, bands)).toEqual({ chrome: false, turn: -1 });
    expect(decideTap({ x: 0.5, y: -1 }, false, bands)).toEqual({ chrome: true, turn: 0 });
  });
  it("error is terminal", () => {
    const s = readerReducer(INITIAL_UI, { type: "error", message: "bad zip" });
    expect(s.status).toBe("error");
    expect(s.errorMessage).toBe("bad zip");
  });
  it("externalLink is a state no-op", () => {
    const before = { ...INITIAL_UI, status: "ready" as const, fraction: 0.4 };
    const after = readerReducer(before, { type: "externalLink", href: "https://example.com" });
    expect(after).toEqual(before);
  });
  it("searchResults is a state no-op (search state lives in the sheet)", () => {
    const before = { ...INITIAL_UI, status: "ready" as const, fraction: 0.4 };
    const after = readerReducer(before, { type: "searchResults", gen: 1, items: [{ cfi: "c1", excerpt: "x" }] });
    expect(after).toEqual(before);
  });
  it("searchDone is a state no-op", () => {
    const before = { ...INITIAL_UI, status: "ready" as const, fraction: 0.4 };
    const after = readerReducer(before, { type: "searchDone", gen: 1 });
    expect(after).toEqual(before);
  });
  it("searchError is a state no-op - it must never make status terminal", () => {
    const before = { ...INITIAL_UI, status: "ready" as const, fraction: 0.4 };
    const after = readerReducer(before, { type: "searchError", gen: 1, message: "Search failed." });
    expect(after).toEqual(before);
    expect(after.status).not.toBe("error");
  });
});

describe("injection builders", () => {
  it("embed JSON safely and end with ;true;", () => {
    const init = jsInit({ name: 'a"b.epub', format: "book", fontSizePct: 100, bg: "#ffffff", fg: "#1a1a1a", location: null });
    expect(init).toContain('a\\"b.epub');
    for (const s of [
      init,
      jsChunk("QUJD"),
      jsOpen(),
      jsGoTo("cfi(x)"),
      jsApply({ fontSizePct: 120, bg: "#121212", fg: "#c8c8c8" }),
      jsSearch("hello"),
      jsSearchClear(),
      jsTurn(1),
      jsTurn(-1),
    ]) {
      expect(s.endsWith(";true;")).toBe(true);
    }
  });

  it("jsTurn embeds the direction as a bare number", () => {
    expect(jsTurn(1)).toBe("window.__dosyaTurn(1);true;");
    expect(jsTurn(-1)).toBe("window.__dosyaTurn(-1);true;");
  });

  it("jsApply embeds bg/fg as JSON", () => {
    const s = jsApply({ fontSizePct: 120, bg: "#121212", fg: "#c8c8c8" });
    expect(s).toContain('"bg":"#121212"');
    expect(s).toContain('"fg":"#c8c8c8"');
    expect(s).toContain('"fontSizePct":120');
  });

  it("jsInit embeds bg/fg as JSON instead of a theme name", () => {
    const s = jsInit({ name: "book.epub", format: "book", fontSizePct: 100, bg: "#f4ecd8", fg: "#5b4636", location: null });
    expect(s).toContain('"bg":"#f4ecd8"');
    expect(s).toContain('"fg":"#5b4636"');
  });

  it("jsSearch escapes quotes in the query and embeds it as a JSON string", () => {
    const s = jsSearch('he said "hi"');
    expect(s).toBe(`window.__dosyaSearch(${JSON.stringify('he said "hi"')});true;`);
    expect(s).toContain('\\"hi\\"');
  });

  it("jsSearchClear takes no payload and ends with ;true;", () => {
    expect(jsSearchClear()).toBe("window.__dosyaSearchClear();true;");
  });
});

describe("allowsReaderNavigation", () => {
  it("lets the reader page itself load", () => {
    // The page must be loadable under a real origin: at an opaque origin
    // foliate's blob-URL section iframes kill the WebView renderer.
    expect(allowsReaderNavigation(READER_BASE_URL)).toBe(true);
    expect(allowsReaderNavigation(READER_BASE_URL.replace(/\/$/, ""))).toBe(true);
  });
  it("lets foliate's own section URLs through", () => {
    expect(allowsReaderNavigation("blob:https://reader.invalid/abc-123")).toBe(true);
    expect(allowsReaderNavigation("data:text/html,hi")).toBe(true);
    expect(allowsReaderNavigation("about:blank")).toBe(true);
  });
  it("refuses any other http(s) navigation, including look-alike hosts", () => {
    expect(allowsReaderNavigation("https://example.com/")).toBe(false);
    expect(allowsReaderNavigation("http://reader.invalid.evil.com/")).toBe(false);
    expect(allowsReaderNavigation("https://reader.invalid.evil.com/")).toBe(false);
    expect(allowsReaderNavigation("https://reader.invalid/other")).toBe(false);
  });
});

describe("hold", () => {
  it("parses the hold message", () => {
    expect(parsePageMessage(JSON.stringify({ type: "hold" }))).toEqual({ type: "hold" });
  });
  it("shows the controls wherever the hold landed", () => {
    const hidden = { ...INITIAL_UI, status: "ready" as const, chromeVisible: false };
    expect(readerReducer(hidden, { type: "hold" }).chromeVisible).toBe(true);
  });
  it("leaves the controls showing if they already were", () => {
    const shown = { ...INITIAL_UI, status: "ready" as const, chromeVisible: true };
    expect(readerReducer(shown, { type: "hold" }).chromeVisible).toBe(true);
  });
});
