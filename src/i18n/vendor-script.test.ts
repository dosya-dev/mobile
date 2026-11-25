import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mobileRoot = resolve(__dirname, "../..");
const desktopRoot = resolve(mobileRoot, "../desktop");
const realCatalogDir = resolve(mobileRoot, "../../packages/i18n/mobile");
const script = resolve(mobileRoot, "scripts/vendor-i18n.mjs");

// Monorepo-only: when apps/mobile is built alone there is no packages/ or apps/desktop to read.
const inMonorepo = existsSync(realCatalogDir) && existsSync(desktopRoot);
const maybe = inMonorepo ? describe : describe.skip;

type Result = { ok: true; shipped: string[]; skipped: Record<string, string[]>; files: Record<string, string> } | { ok: false; error: string };

// The script is a plain ESM module (import.meta, top-level await), so run it in node, not through babel.
function build(catalogDir: string, root = freshRoot(), allowDrop: string[] = []): Result {
  const code = `
    import { buildOutputs } from ${JSON.stringify(script)};
    try {
      const r = await buildOutputs(${JSON.stringify({ mobileRoot: root, desktopRoot, catalogDir, allowDrop })});
      process.stdout.write(JSON.stringify({ ok: true, shipped: r.shipped, skipped: r.skipped, files: r.files }));
    } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e.message })); }
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
}

// A root with no committed shipped.json, so the drop guard does not see the real one.
function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "mobile-root-"));
}

function tempCatalog(): string {
  const dir = mkdtempSync(join(tmpdir(), "mobile-i18n-"));
  for (const f of readdirSync(realCatalogDir)) if (/^[A-Za-z0-9-]+(\.catalog)?\.json$/.test(f)) cpSync(join(realCatalogDir, f), join(dir, f));
  return dir;
}
function edit(dir: string, lang: string, fn: (m: Record<string, string>) => void) {
  const p = join(dir, `${lang}.json`);
  const m = JSON.parse(readFileSync(p, "utf8"));
  fn(m);
  writeFileSync(p, JSON.stringify(m));
}
function ok(r: Result) {
  if (!r.ok) throw new Error(r.error);
  return r;
}

// Evaluate the generated locales.ts (types stripped by the TypeScript compiler).
function loadLocales(src: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require("typescript");
  const js: string = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} as Record<string, any> };
  new Function("module", "exports", js)(m, m.exports);
  return m.exports;
}

maybe("vendor-i18n buildOutputs", () => {
  const baseline = () => ok(build(realCatalogDir));

  it("builds the outputs from the real catalog without writing files", () => {
    const r = baseline();
    expect(Object.keys(r.files)).toContain("src/i18n/keys.ts");
    expect(Object.keys(r.files)).toContain("src/i18n/messages/en.json");
    expect(Object.keys(r.files)).toContain("src/i18n/shipped.json");
  });

  it("rejects, naming the key, a language file with a key the catalog lacks", () => {
    const dir = tempCatalog();
    edit(dir, "tr", (m) => (m["bogus.extra.key"] = "x"));
    const r = build(dir);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/bogus\.extra\.key/);
  });

  it("leaves out a language missing one key", () => {
    const dir = tempCatalog();
    edit(dir, "sk", (m) => delete m[Object.keys(m)[0]]);
    const r = ok(build(dir));
    expect(r.shipped).not.toContain("sk");
    expect(r.skipped.sk.join(" ")).toMatch(/missing 1 keys/);
    expect(r.files["src/i18n/loaders.ts"]).not.toContain("sk:");
    expect(r.files["src/i18n/messages/sk.json"]).toBeUndefined();
  });

  it("ships ar, he and fa when complete", () => {
    const r = baseline();
    for (const l of ["ar", "he", "fa"]) expect(r.shipped).toContain(l);
    const locales = r.files["src/i18n/locales.ts"];
    expect(locales).toContain("export function localeDir");
    const mod = loadLocales(locales);
    expect(mod.localeDir("he")).toBe("rtl");
    expect(mod.localeDir("de")).toBe("ltr");
    expect(mod.RTL_LOCALES).toEqual(["ar", "he", "fa"]);
    expect(mod.intlTag("ar")).toBe("ar-u-nu-latn");
    expect(mod.intlTag("th")).toBe("th");
    expect(mod.intlTag("en")).toBeUndefined();
    expect(mod.LOCALE_LABELS.ar).toBe("العربية");
    expect(mod.LOCALE_LABELS.he).toBe("עברית");
    expect(mod.LOCALE_LABELS.fa).toBe("فارسی");
  });

  it("never ships ur", () => {
    const dir = tempCatalog();
    cpSync(join(dir, "tr.json"), join(dir, "ur.json"));
    const r = ok(build(dir));
    expect(r.shipped).not.toContain("ur");
    expect(r.skipped.ur.join(" ")).toMatch(/right-to-left/);
  });

  it("leaves the 36 existing messages files unchanged", () => {
    const r = baseline();
    const old = r.shipped.filter((l) => !["ar", "he", "fa"].includes(l));
    expect(old).toHaveLength(36);
    for (const l of old) {
      const rel = `src/i18n/messages/${l}.json`;
      expect(r.files[rel]).toBe(readFileSync(join(mobileRoot, rel), "utf8"));
    }
  });

  it("rejects a message that does not parse, naming the key", () => {
    const dir = tempCatalog();
    const cat = JSON.parse(readFileSync(join(dir, "en.catalog.json"), "utf8"));
    const key: string = cat.strings.find((s: { translate?: boolean }) => s.translate !== false).key;
    edit(dir, "fr", (m) => (m[key] = "{unclosed, plural, one {x"));
    const r = ok(build(dir));
    expect(r.shipped).not.toContain("fr");
    expect(r.skipped.fr.join(" ")).toContain(`${key} (does not parse)`);
  });

  it("exempts a translate:false key from completeness", () => {
    const dir = tempCatalog();
    const cat = JSON.parse(readFileSync(join(dir, "en.catalog.json"), "utf8"));
    const key: string = cat.strings.find((s: { translate?: boolean }) => s.translate !== false).key;
    // Same gap, two catalogs: the key is required, then flagged translate:false.
    edit(dir, "de", (m) => delete m[key]);
    const required = ok(build(dir));
    expect(required.shipped).not.toContain("de");
    expect(required.skipped.de.join(" ")).toContain(key);
    for (const s of cat.strings) if (s.key === key) s.translate = false;
    writeFileSync(join(dir, "en.catalog.json"), JSON.stringify(cat));
    const exempt = ok(build(dir));
    expect(exempt.shipped).toContain("de");
    expect(exempt.skipped.de).toBeUndefined();
  });

  it("refuses to drop a shipped language without --allow-drop", () => {
    const shipped = baseline().shipped;
    const root = mkdtempSync(join(tmpdir(), "mobile-root-"));
    mkdirSync(join(root, "src/i18n"), { recursive: true });
    writeFileSync(join(root, "src/i18n/shipped.json"), JSON.stringify(shipped));
    const dir = tempCatalog();
    edit(dir, "sk", (m) => delete m[Object.keys(m)[0]]);
    const refused = build(dir, root);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/sk/);
    const allowed = ok(build(dir, root, ["sk"]));
    expect(allowed.shipped).not.toContain("sk");
  });

  it("rejects a translation whose argument names differ from English", () => {
    const dir = tempCatalog();
    const cat = JSON.parse(readFileSync(join(dir, "en.catalog.json"), "utf8"));
    const withArg = cat.strings.find((s: { key: string; source: string }) => /\{[a-zA-Z]+\}/.test(s.source));
    edit(dir, "de", (m) => (m[withArg.key] = withArg.source.replace(/\{[a-zA-Z]+\}/, "{wrongName}")));
    const r = ok(build(dir));
    expect(r.shipped).not.toContain("de");
    expect(r.skipped.de.join(" ")).toContain(withArg.key);
  });

  it("rejects a plural branch the language does not use", () => {
    const dir = tempCatalog();
    edit(dir, "ja", (m) => (m["zz.fake"] = "x"));
    expect(build(dir).ok).toBe(false); // extra key still fatal
    const dir2 = tempCatalog();
    const cat = JSON.parse(readFileSync(join(dir2, "en.catalog.json"), "utf8"));
    const plural = cat.strings.find((s: { source: string }) => /plural, one/.test(s.source));
    edit(dir2, "ja", (m) => (m[plural.key] = plural.source));
    const r = ok(build(dir2));
    expect(r.shipped).not.toContain("ja");
    expect(r.skipped.ja.join(" ")).toMatch(/plural branch "one"/);
  });
});

// Catalog hygiene (Task 5). Every language inherits a defect in an English source, so these fail
// on the source, not on a translation.
type CatalogEntry = { key: string; source: string; uses?: string[]; translate?: boolean };

function readCatalog(): CatalogEntry[] {
  return JSON.parse(readFileSync(join(realCatalogDir, "en.catalog.json"), "utf8")).strings;
}

maybe("catalog hygiene", () => {
  it("no English source holds an HTML entity, **, a doubled space, '{ or a $ inside braces", () => {
    const bad: string[] = [];
    for (const e of readCatalog()) {
      const s = e.source;
      if (/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(s)) bad.push(`${e.key}: entity`);
      if (s.includes("**")) bad.push(`${e.key}: **`);
      if (/ {2,}/.test(s)) bad.push(`${e.key}: doubled space`);
      if (s.includes("'{")) bad.push(`${e.key}: '{`);
      if (/\{[^{}]*\$[^{}]*\}/.test(s) || s.includes("$}")) bad.push(`${e.key}: $ inside braces`);
    }
    expect(bad).toEqual([]);
  });

  // Line numbers drift as soon as screens are wired (literals become t() calls a few lines away), so the
  // gate only requires that every "uses" file still exists. Task 5 refreshed the line numbers once.
  it("every uses entry is file:line and names a file that exists", () => {
    const bad: string[] = [];
    for (const e of readCatalog()) {
      for (const u of e.uses ?? []) {
        const m = /^(.*):(\d+)$/.exec(u);
        if (!m) bad.push(`${e.key}: ${u} (not file:line)`);
        else if (!existsSync(join(mobileRoot, m[1]))) bad.push(`${e.key}: ${u} (no such file)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("identifier and brand-only entries are translate:false and carry no translations", () => {
    const names = [
      "map.label.openstreetmap",
      "common.label.csv",
      "common.label.json",
      "common.label.xml",
      "common.label.yaml",
      "common.label.sql",
      "common.label.tsv",
      "common.label.pdf",
      "common.label.epub",
      "common.label.mobi",
      "files.label.httpStatus",
    ];
    const catalog = readCatalog();
    for (const k of names) expect(catalog.find((e) => e.key === k)?.translate).toBe(false);
    for (const f of readdirSync(realCatalogDir)) {
      if (!/^[A-Za-z-]+\.json$/.test(f)) continue;
      const m = JSON.parse(readFileSync(join(realCatalogDir, f), "utf8"));
      for (const k of names) expect(`${f} ${k} ${k in m}`).toBe(`${f} ${k} false`);
    }
  });
});
