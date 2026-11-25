import { normalizeExt } from "@/files/format";

/**
 * Lightweight, line-at-a-time syntax classification for the text stage.
 *
 * This is not a real parser - it has no notion of what line it is on, so a
 * comment or string that spans multiple lines will only look right on the
 * line where it opens. That trade is deliberate: the alternative is carrying
 * lexer state across a `FlatList`-style render of hundreds of lines, for a
 * file preview that exists to be glanced at, not compiled.
 */
export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "tag" | "attr" | "fn";

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

export type CodeLang = "markup" | "curly" | "json" | "sql" | "yaml" | "shell" | "script" | "plain";

const LANG_BY_EXT: Record<string, CodeLang> = {
  html: "markup", htm: "markup", xml: "markup", vue: "markup", svelte: "markup",
  js: "curly", jsx: "curly", ts: "curly", tsx: "curly", mjs: "curly", cjs: "curly",
  css: "curly", scss: "curly", less: "curly",
  java: "curly", kt: "curly", kts: "curly", swift: "curly", c: "curly", h: "curly",
  cpp: "curly", hpp: "curly", cc: "curly", cs: "curly", php: "curly", dart: "curly",
  go: "curly", rs: "curly", gradle: "curly",
  json: "json",
  sql: "sql",
  yml: "yaml", yaml: "yaml", toml: "yaml", ini: "yaml", conf: "yaml", env: "yaml", properties: "yaml",
  sh: "shell", bash: "shell", ps1: "shell", bat: "shell", cmd: "shell",
  py: "script", rb: "script", lua: "script",
};

export function languageForExtension(ext: string | null): CodeLang {
  return LANG_BY_EXT[normalizeExt(ext)] ?? "plain";
}

interface TokenRule {
  kind: TokenKind;
  re: RegExp;
}

/** Every pattern is sticky (`y`): it is only allowed to match starting exactly at the cursor. */
function rule(kind: TokenKind, source: string, flags = ""): TokenRule {
  return { kind, re: new RegExp(source, flags + "y") };
}

const CURLY_STRING = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`(?:[^\`\\]|\\.)*\``;

function curlyRules(keywords: string[]): TokenRule[] {
  return [
    rule("comment", String.raw`//.*`),
    rule("comment", String.raw`/\*.*?\*/`),
    rule("string", CURLY_STRING),
    rule("number", String.raw`\d+(\.\d+)?`),
    rule("keyword", String.raw`\b(?:${keywords.join("|")})\b`),
    rule("fn", String.raw`[a-zA-Z_$][\w$]*(?=\()`),
  ];
}

const JS_KEYWORDS = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case",
  "break", "continue", "class", "extends", "new", "this", "super", "import", "export", "default",
  "from", "as", "async", "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "in",
  "of", "void", "delete", "yield", "static", "get", "set", "true", "false", "null", "undefined",
  "interface", "type", "enum", "implements", "public", "private", "protected", "readonly", "namespace",
];
const CSS_KEYWORDS = ["important", "inherit", "initial", "unset", "auto", "none", "solid", "flex", "grid"];
const GENERIC_CURLY_KEYWORDS = [
  ...JS_KEYWORDS, "public", "private", "protected", "static", "final", "void", "int", "string", "bool",
  "struct", "package", "func", "fn", "impl", "pub", "mod", "use", "match",
];
const JSON_KEYWORDS = ["true", "false", "null"];

const MARKUP_RULES: TokenRule[] = [
  rule("comment", String.raw`<!--[\s\S]*?-->`),
  rule("tag", String.raw`<\/?[a-zA-Z][\w:-]*`),
  rule("tag", String.raw`\/?>`),
  rule("string", String.raw`"[^"]*"|'[^']*'`),
  rule("attr", String.raw`[a-zA-Z_:][\w:.-]*(?=\s*=)`),
];

const SQL_RULES: TokenRule[] = [
  rule("comment", String.raw`--.*`),
  rule("string", String.raw`'(?:[^'\\]|\\.)*'`),
  rule("number", String.raw`\?\d+|\d+(\.\d+)?`),
  rule(
    "keyword",
    String.raw`\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|VIEW|TRIGGER|ALTER|DROP|PRIMARY|KEY|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|UNIQUE|CHECK|CONSTRAINT|AUTOINCREMENT|AND|OR|IN|IS|LIKE|BETWEEN|AS|DISTINCT|CASCADE|ASC|DESC|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END|BEGIN|COMMIT|ROLLBACK|TRANSACTION)\b`,
    "i",
  ),
  rule("fn", String.raw`[a-zA-Z_]\w*(?=\()`),
];

const YAML_RULES: TokenRule[] = [
  rule("comment", String.raw`#.*`),
  rule("string", String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`),
  rule("attr", String.raw`^[ \t]*[\w.-]+(?=[ \t]*[:=])`),
  rule("number", String.raw`\d+(\.\d+)?`),
];

const SHELL_RULES: TokenRule[] = [
  rule("comment", String.raw`#.*`),
  rule("string", String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`),
  rule("fn", String.raw`\$\{[^}]*\}|\$[A-Za-z_]\w*|%[A-Za-z_]\w*%`),
  rule(
    "keyword",
    String.raw`\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|echo|exit|break|continue|in|until|select)\b`,
  ),
];

const SCRIPT_RULES: TokenRule[] = [
  rule("comment", String.raw`#.*`),
  rule("string", String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`),
  rule("number", String.raw`\d+(\.\d+)?`),
  rule(
    "keyword",
    String.raw`\b(?:def|class|import|from|as|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|self|try|except|finally|with|lambda|yield|pass|break|continue|end|then|do|nil|require|module|function|local|until|raise|global)\b`,
  ),
  rule("fn", String.raw`[a-zA-Z_]\w*(?=\()`),
];

const RULES_BY_LANG: Record<Exclude<CodeLang, "plain">, TokenRule[]> = {
  markup: MARKUP_RULES,
  curly: curlyRules(GENERIC_CURLY_KEYWORDS.concat(CSS_KEYWORDS)),
  json: curlyRules(JSON_KEYWORDS),
  sql: SQL_RULES,
  yaml: YAML_RULES,
  shell: SHELL_RULES,
  script: SCRIPT_RULES,
};

/**
 * Splits one line into typed runs. The runs concatenate back to the exact
 * input line - every character lands in some token, so a caller can trust
 * `tokens.map(t => t.text).join("")` round-trips.
 */
export function tokenizeLine(line: string, lang: CodeLang): CodeToken[] {
  if (lang === "plain" || line === "") return line ? [{ text: line, kind: "plain" }] : [];

  const rules = RULES_BY_LANG[lang];
  const tokens: CodeToken[] = [];
  let plain = "";
  let i = 0;

  const flushPlain = () => {
    if (plain) {
      tokens.push({ text: plain, kind: "plain" });
      plain = "";
    }
  };

  while (i < line.length) {
    let matchedLength = 0;
    for (const r of rules) {
      r.re.lastIndex = i;
      const m = r.re.exec(line);
      if (m && m[0].length > 0) {
        flushPlain();
        tokens.push({ text: m[0], kind: r.kind });
        matchedLength = m[0].length;
        break;
      }
    }
    if (matchedLength > 0) {
      i += matchedLength;
    } else {
      plain += line[i];
      i += 1;
    }
  }
  flushPlain();
  return tokens;
}

/**
 * Colours for each token kind, tuned separately for a light and a dark
 * `bg-card` - the code surface follows the app theme rather than pinning to
 * one dark "editor" background (see TextStage), so these have to hold up
 * against both a white and a near-black card.
 */
const LIGHT_TOKEN_COLORS: Record<TokenKind, string> = {
  plain: "",
  keyword: "#1a56c4",
  tag: "#b02559",
  attr: "#8a6200",
  string: "#0f7938",
  number: "#8a6200",
  fn: "#b02559",
  comment: "rgba(9,19,26,0.42)",
};

const DARK_TOKEN_COLORS: Record<TokenKind, string> = {
  plain: "",
  keyword: "#7fb0ff",
  tag: "#ff90ab",
  attr: "#f0c766",
  string: "#5ed99b",
  number: "#f0c766",
  fn: "#ff90ab",
  comment: "rgba(233,240,245,0.42)",
};

export function codeTokenColors(scheme: "light" | "dark"): Record<TokenKind, string> {
  return scheme === "dark" ? DARK_TOKEN_COLORS : LIGHT_TOKEN_COLORS;
}
