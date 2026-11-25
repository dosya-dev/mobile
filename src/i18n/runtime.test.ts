import { makeT } from "./translator.ts";
import { isLocale, LOCALE_LABELS, LOCALES } from "./locales.ts";
import { LOADERS } from "./loaders.ts";
import type { MessageKey } from "./keys.ts";

const k = (s: string) => s as MessageKey;

describe("vendored i18n runtime", () => {
  it("falls back to English for a key missing in tr", () => {
    const t = makeT("tr", {}, { "common.cancel": "Cancel" });
    expect(t(k("common.cancel"))).toBe("Cancel");
  });

  it("returns the key, without throwing, when it is missing everywhere", () => {
    const t = makeT("tr", {}, {});
    expect(t(k("nowhere.at.all"))).toBe("nowhere.at.all");
  });

  it("substitutes values literally, never parsing them", () => {
    const en = { "common.x": "Delete {name}?" };
    const t = makeT("en", en, en);
    expect(t(k("common.x"), { name: "{a} it's #1 <b>" })).toBe("Delete {a} it's #1 <b>?");
  });

  it("picks English plural forms: 0 files, 1 file, 2 files", () => {
    const en = { "common.n": "{count, plural, one {# file} other {# files}}" };
    const t = makeT("en", en, en);
    expect(t(k("common.n"), { count: 0 })).toBe("0 files");
    expect(t(k("common.n"), { count: 1 })).toBe("1 file");
    expect(t(k("common.n"), { count: 2 })).toBe("2 files");
  });

  it("picks Polish few for 3 and many for 5", () => {
    const pl = { "common.n": "{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}" };
    const t = makeT("pl", pl, pl);
    expect(t(k("common.n"), { count: 3 })).toBe("3 pliki");
    expect(t(k("common.n"), { count: 5 })).toBe("5 plików");
  });

  it("uses other for 1 in Chinese", () => {
    const zh = { "common.n": "{count, plural, other {# 个文件}}" };
    const t = makeT("zh-Hans", zh, zh);
    expect(t(k("common.n"), { count: 1 })).toBe("1 个文件");
  });

  it("lists English first and labels every locale", () => {
    expect(LOCALES[0]).toBe("en");
    for (const l of LOCALES) expect(LOCALE_LABELS[l]).toBeTruthy();
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("ur")).toBe(false);
  });

  it("has a loader for every non-English language, and each loads its messages", async () => {
    expect(Object.keys(LOADERS).sort()).toEqual(LOCALES.filter((l) => l !== "en").sort());
    const tr = await LOADERS.tr();
    expect(typeof tr.default).toBe("object");
    expect(Object.keys(tr.default).length).toBeGreaterThan(1000);
  });
});
