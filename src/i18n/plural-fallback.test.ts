import { LOCALES } from "./locales.ts";
import { pluralCategories, pluralCategory } from "./plural-fallback.ts";

const NS: number[] = [];
for (let n = 0; n <= 1200; n++) NS.push(n);
NS.push(1e4, 1e5, 1e6, 2e6, 0.5, 1.5, 2.5, 1.25, 0.01, 0.1, 1.001, 1.01, 2.02, 10.5);

describe("pluralCategory", () => {
  it("matches Node ICU for every shipped language", () => {
    const bad: string[] = [];
    for (const lang of LOCALES) {
      const oracle = new Intl.PluralRules(lang);
      for (const n of NS) {
        const got = pluralCategory(lang, n);
        const want = oracle.select(n);
        if (got !== want) bad.push(`${lang} ${n}: got ${got}, want ${want}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("lists the same categories as Node ICU for every shipped language", () => {
    const bad: string[] = [];
    for (const lang of LOCALES) {
      const want = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const got = pluralCategories(lang);
      if ([...got].sort().join() !== [...want].sort().join()) bad.push(`${lang}: got ${got}, want ${want}`);
    }
    expect(bad).toEqual([]);
  });

  it("shares rules between nb, no and nn, and uses other for zh-*", () => {
    expect(pluralCategory("no", 1)).toBe("one");
    expect(pluralCategory("nn", 2)).toBe("other");
    expect(pluralCategory("zh-Hant", 1)).toBe("other");
  });

  it("gives European Portuguese (and its CLDR regions) its own rule: zero is other, unlike pt-BR", () => {
    expect(pluralCategory("pt-BR", 0)).toBe("one");
    expect(pluralCategory("pt", 0)).toBe("one");
    expect(pluralCategory("pt-PT", 0)).toBe("other");
    expect(pluralCategory("pt-AO", 0)).toBe("other");
    expect(pluralCategory("pt_PT", 1)).toBe("one");
    expect(pluralCategories("pt-PT")).toEqual(["one", "many", "other"]);
  });

  it("uses one/few/many for Russian and Ukrainian, one/few for Serbian", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => pluralCategory("ru", n))).toEqual(["one", "few", "many", "many", "one", "few", "many"]);
    expect(pluralCategory("uk", 1.5)).toBe("other");
    expect([1, 2, 5, 21].map((n) => pluralCategory("sr", n))).toEqual(["one", "few", "other", "one"]);
  });

  it("falls back to other for an unknown language", () => {
    expect(pluralCategory("xx", 1)).toBe("other");
  });
});
