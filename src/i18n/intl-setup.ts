/**
 * Installs Intl fallbacks the app depends on. Imported from index.js right
 * after the crypto globals, before any message is formatted.
 *
 * Hermes ships Intl.PluralRules on current builds, but some Android builds
 * have it missing or return `other` for every locale. A silent wrong plural
 * ("5 plik") is worse than a few lines of code, so the native implementation
 * is probed with canaries and replaced when it is absent or wrong.
 */

import { pluralCategories, pluralCategory } from "./plural-fallback.ts";

type Canary = readonly [locale: string, n: number, expected: Intl.LDMLPluralRule];

const CANARIES: readonly Canary[] = [
  ["pl", 5, "many"],
  ["cs", 3, "few"],
  ["fr", 0, "one"],
  ["ro", 2, "few"],
  ["sl", 2, "two"],
  ["ru", 5, "many"],
  ["pt-PT", 0, "other"],
];

class PluralRulesShim {
  private readonly locale: string;

  constructor(locales?: string | readonly string[]) {
    const first = Array.isArray(locales) ? locales[0] : (locales as string | undefined);
    this.locale = first ?? "en";
  }

  select(n: number): Intl.LDMLPluralRule {
    return pluralCategory(this.locale, n);
  }

  resolvedOptions(): { locale: string; pluralCategories: Intl.LDMLPluralRule[] } {
    return { locale: this.locale, pluralCategories: pluralCategories(this.locale) };
  }

  static supportedLocalesOf(locales: string | readonly string[]): string[] {
    return Array.isArray(locales) ? [...locales] : [locales as string];
  }
}

function nativePasses(): boolean {
  const Ctor = (globalThis.Intl as { PluralRules?: typeof Intl.PluralRules } | undefined)?.PluralRules;
  if (typeof Ctor !== "function") return false;
  try {
    return CANARIES.every(([locale, n, want]) => new Ctor(locale).select(n) === want);
  } catch {
    return false;
  }
}

export function installIntlFallbacks(): { pluralRules: "native" | "shim" } {
  if (nativePasses()) return { pluralRules: "native" };
  const g = globalThis as { Intl?: Record<string, unknown> };
  if (!g.Intl) g.Intl = {};
  g.Intl.PluralRules = PluralRulesShim;
  return { pluralRules: "shim" };
}

// Boot must never fail because of a fallback: if the probe or the install
// itself throws, the app starts with whatever Intl the engine has.
try {
  installIntlFallbacks();
} catch {
  // Intentionally ignored.
}
