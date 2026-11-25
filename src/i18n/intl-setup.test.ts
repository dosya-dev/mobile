import { installIntlFallbacks } from "./intl-setup.ts";
import { makeT } from "./translator.ts";
import type { MessageKey } from "./keys.ts";

const k = (s: string) => s as MessageKey;
const pl = { "common.n": "{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}" };
const intl = globalThis.Intl as unknown as { PluralRules: unknown };
const original = intl.PluralRules;

afterEach(() => {
  intl.PluralRules = original;
});

describe("installIntlFallbacks", () => {
  it("keeps the native implementation when it passes the canaries", () => {
    expect(installIntlFallbacks()).toEqual({ pluralRules: "native" });
    expect(intl.PluralRules).toBe(original);
  });

  it("installs the shim when PluralRules is missing", () => {
    delete intl.PluralRules;
    expect(installIntlFallbacks()).toEqual({ pluralRules: "shim" });
    const t = makeT("pl", pl, pl);
    expect(t(k("common.n"), { count: 5 })).toBe("5 plików");
    expect(t(k("common.n"), { count: 3 })).toBe("3 pliki");
    const r = new Intl.PluralRules("pl");
    expect(r.resolvedOptions().locale).toBe("pl");
    expect(r.resolvedOptions().pluralCategories).toContain("many");
  });

  it("replaces a native PluralRules that ignores the locale", () => {
    intl.PluralRules = class {
      select() {
        return "other";
      }
      resolvedOptions() {
        return { locale: "en" };
      }
    };
    expect(installIntlFallbacks()).toEqual({ pluralRules: "shim" });
    expect(new Intl.PluralRules("pl").select(5)).toBe("many");
  });

  it("never throws at import time, even when the probe itself blows up", () => {
    Object.defineProperty(intl, "PluralRules", {
      configurable: true,
      get() {
        throw new Error("engine broke");
      },
    });
    try {
      jest.isolateModules(() => {
        expect(() => require("./intl-setup.ts")).not.toThrow();
      });
    } finally {
      Object.defineProperty(intl, "PluralRules", { configurable: true, writable: true, value: original });
    }
  });
});
