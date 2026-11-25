import { codeTokenColors, languageForExtension, tokenizeLine, type CodeLang } from "./codeHighlight";

describe("languageForExtension", () => {
  it("maps known extensions to their language family", () => {
    expect(languageForExtension(".html")).toBe("markup");
    expect(languageForExtension(".xml")).toBe("markup");
    expect(languageForExtension(".sql")).toBe("sql");
    expect(languageForExtension(".ts")).toBe("curly");
    expect(languageForExtension(".tsx")).toBe("curly");
    expect(languageForExtension(".css")).toBe("curly");
    expect(languageForExtension(".json")).toBe("json");
    expect(languageForExtension(".yaml")).toBe("yaml");
    expect(languageForExtension(".yml")).toBe("yaml");
    expect(languageForExtension(".sh")).toBe("shell");
    expect(languageForExtension(".py")).toBe("script");
  });

  it("is case-insensitive and tolerates a missing leading dot", () => {
    expect(languageForExtension("HTML")).toBe("markup");
    expect(languageForExtension("Sql")).toBe("sql");
  });

  it("falls back to plain for anything unrecognized or absent", () => {
    expect(languageForExtension(".foo")).toBe("plain");
    expect(languageForExtension(null)).toBe("plain");
  });
});

/** Every tokenizer must reconstruct its input exactly - no character can be
 * dropped or duplicated by the rule that classifies it. */
function joined(line: string, lang: CodeLang): string {
  return tokenizeLine(line, lang).map((t) => t.text).join("");
}

describe("tokenizeLine", () => {
  it("returns the whole line untouched for plain text, and nothing for an empty line", () => {
    expect(tokenizeLine("just some text", "plain")).toEqual([{ text: "just some text", kind: "plain" }]);
    expect(tokenizeLine("", "plain")).toEqual([]);
    expect(tokenizeLine("", "sql")).toEqual([]);
  });

  it("classifies an HTML tag, its attribute and the attribute's string value", () => {
    const tokens = tokenizeLine('<div class="container">', "markup");
    expect(tokens).toEqual([
      { text: "<div", kind: "tag" },
      { text: " ", kind: "plain" },
      { text: "class", kind: "attr" },
      { text: "=", kind: "plain" },
      { text: '"container"', kind: "string" },
      { text: ">", kind: "tag" },
    ]);
    expect(joined('<div class="container">', "markup")).toBe('<div class="container">');
  });

  it("treats an HTML comment as one comment token", () => {
    const tokens = tokenizeLine("<!-- share-invite-email.html -->", "markup");
    expect(tokens).toEqual([{ text: "<!-- share-invite-email.html -->", kind: "comment" }]);
  });

  it("classifies SQL keywords case-insensitively, a bind param, a string and a trailing comment", () => {
    const tokens = tokenizeLine("select * from files where id = ?1 -- note", "sql");
    expect(tokens.filter((t) => t.kind === "keyword").map((t) => t.text)).toEqual(["select", "from", "where"]);
    expect(tokens.filter((t) => t.kind === "number").map((t) => t.text)).toEqual(["?1"]);
    expect(tokens.at(-1)).toEqual({ text: "-- note", kind: "comment" });
    expect(joined("select * from files where id = ?1 -- note", "sql")).toBe(
      "select * from files where id = ?1 -- note",
    );
  });

  it("classifies a SQL string literal", () => {
    const tokens = tokenizeLine("WHERE mime_type LIKE 'text/%'", "sql");
    expect(tokens).toContainEqual({ text: "'text/%'", kind: "string" });
  });

  it("classifies a JS/TS keyword, a number and a line comment", () => {
    const tokens = tokenizeLine("const x = 1; // hi", "curly");
    expect(tokens[0]).toEqual({ text: "const", kind: "keyword" });
    expect(tokens).toContainEqual({ text: "1", kind: "number" });
    expect(tokens.at(-1)).toEqual({ text: "// hi", kind: "comment" });
  });

  it("does not mistake a keyword-looking substring inside a longer identifier", () => {
    const tokens = tokenizeLine("const gift = 1;", "curly");
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "if")).toBe(false);
    expect(tokens.some((t) => t.text.includes("gift"))).toBe(true);
  });

  it("classifies a function call by the identifier immediately before '('", () => {
    const tokens = tokenizeLine("unixepoch()", "sql");
    expect(tokens[0]).toEqual({ text: "unixepoch", kind: "fn" });
  });

  it("round-trips a representative line for every non-plain language", () => {
    const cases: [string, CodeLang][] = [
      ['  <meta charset="utf-8" />', "markup"],
      ["CREATE INDEX idx_file_tags_file_id ON file_tags(file_id);", "sql"],
      ['  "container": { "max-width": 560 },', "json"],
      ["workspace_id: ${WORKSPACE_ID:-default} # from env", "shell"],
      ["def handler(event, context):", "script"],
      ["retention_days: 30  # how long backups live", "yaml"],
    ];
    for (const [line, lang] of cases) {
      expect(joined(line, lang)).toBe(line);
    }
  });
});

describe("codeTokenColors", () => {
  it("gives every non-plain token kind a distinct-looking colour, for both schemes", () => {
    for (const scheme of ["light", "dark"] as const) {
      const colors = codeTokenColors(scheme);
      const kinds: (keyof typeof colors)[] = ["keyword", "string", "comment", "number", "tag", "attr", "fn"];
      for (const kind of kinds) expect(colors[kind]).toBeTruthy();
    }
  });

  it("does not reuse the same palette for light and dark", () => {
    expect(codeTokenColors("light").keyword).not.toBe(codeTokenColors("dark").keyword);
  });
});
