import fs from "fs";
import path from "path";
import { documentDir, firstStrongDir, rtlBase } from "./text-direction";
import * as TD from "./text-direction";
import { stripBidi } from "./i18n";

describe("firstStrongDir", () => {
  it("reads the first strong character", () => {
    expect(firstStrongDir("hello")).toBe("ltr");
    expect(firstStrongDir("שלום")).toBe("rtl");
    expect(firstStrongDir("مرحبا")).toBe("rtl");
    expect(firstStrongDir("ܫܠܡܐ")).toBe("rtl"); // Syriac
    expect(firstStrongDir("ބަސް")).toBe("rtl"); // Thaana
    expect(firstStrongDir("ߒߞߏ")).toBe("rtl"); // NKo
    expect(firstStrongDir("привет")).toBe("ltr");
    expect(firstStrongDir("γειά")).toBe("ltr");
    expect(firstStrongDir("你好")).toBe("ltr");
  });
  it("skips digits, punctuation and space", () => {
    expect(firstStrongDir("  123 - (שלום)")).toBe("rtl");
  });
  it("is null with no strong character", () => {
    expect(firstStrongDir("")).toBeNull();
    expect(firstStrongDir("123 ... !?")).toBeNull();
  });
  it("skips isolate-wrapped runs", () => {
    expect(firstStrongDir("\u2068abc\u2069 مرحبا")).toBe("rtl");
    expect(firstStrongDir("\u2068abc \u2068x\u2069 y\u2069 שלום")).toBe("rtl");
  });
});

describe("documentDir", () => {
  it("follows the first strong character", () => {
    expect(documentDir("שלום world")).toBe("rtl");
    expect(documentDir("\u2068abc\u2069 مرحبا")).toBe("rtl");
    expect(documentDir("hello שלום")).toBe("ltr");
  });
  it("defaults to ltr", () => {
    expect(documentDir("")).toBe("ltr");
    expect(documentDir("1234")).toBe("ltr");
  });
  it("looks only at the first 4 KB", () => {
    expect(documentDir(" ".repeat(5000) + "שלום")).toBe("ltr");
    expect(documentDir(" ".repeat(4000) + "שלום")).toBe("rtl");
  });
});

describe("rtlBase", () => {
  const RLM = "\u200F";
  it("prefixes RLM when the first strong letter is not right-to-left", () => {
    expect(rtlBase("iOS يحتاج")).toBe(`${RLM}iOS يحتاج`);
    expect(rtlBase("193 B · 22 أكتوبر")).toBe(`${RLM}193 B · 22 أكتوبر`);
    expect(rtlBase("42")).toBe(`${RLM}42`);
  });
  it("counts isolated values too, since iOS reads through them", () => {
    expect(rtlBase("\u2068194 MB\u2069 من")).toBe(`${RLM}\u2068194 MB\u2069 من`);
  });
  it("leaves right-to-left lines, empty strings and marked lines alone", () => {
    expect(rtlBase("مرحبا report.pdf")).toBe("مرحبا report.pdf");
    expect(rtlBase("")).toBe("");
    expect(rtlBase(`${RLM}abc`)).toBe(`${RLM}abc`);
  });
});

describe("bidi characters in source", () => {
  const LITERAL = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

  it("exports one RLM and one control class, which stripBidi uses", () => {
    expect(TD.RLM).toBe("\u200F");
    expect("a\u2066b\u202Ec\u200Ed".replace(TD.BIDI_CONTROLS, "")).toBe("abcd");
    expect(stripBidi(`${TD.RLM}x\u2068y\u2069`)).toBe("xy");
  });

  it("are written as \\u escapes, never as the invisible characters themselves", () => {
    const root = path.join(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && LITERAL.test(fs.readFileSync(p, "utf8"))) {
          offenders.push(path.relative(root, p));
        }
      }
    };
    for (const d of ["app", "src", "scripts"]) walk(path.join(root, d));
    expect(offenders).toEqual([]);
  });
});
