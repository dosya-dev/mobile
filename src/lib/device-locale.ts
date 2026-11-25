import { getLocales } from "expo-localization";
import type { Locale } from "@/i18n/locales";

/** The phone's language tags, most preferred first. Empty when they cannot be read. */
export function deviceLanguageTags(): string[] {
  try {
    return getLocales()
      .map((l) => l.languageTag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
  } catch {
    return [];
  }
}

// Regions whose Spanish is Latin American (CLDR es-419 and its children, es-US included).
const LATIN_AMERICA = new Set(
  "419 MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR US BR BZ".split(" "),
);
// Regions whose Portuguese follows European usage (CLDR pt-PT and its children).
const EUROPEAN_PORTUGUESE = new Set("PT AO MZ CV GW ST TL MO GQ LU CH".split(" "));
const TRADITIONAL_REGIONS = new Set(["TW", "HK", "MO"]);

interface Parsed {
  canon: string;
  lang: string;
  script: string | null;
  region: string | null;
}

/** Case-normalises a BCP 47 tag ("zh-hant-tw" to "zh-Hant-TW") and splits it. */
function parse(tag: string): Parsed | null {
  const parts = tag.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (parts.length === 0) return null;
  const lang = parts[0].toLowerCase();
  let script: string | null = null;
  let region: string | null = null;
  for (const p of parts.slice(1)) {
    if (script === null && region === null && /^[A-Za-z]{4}$/.test(p)) {
      script = p[0].toUpperCase() + p.slice(1).toLowerCase();
    } else if (region === null && /^([A-Za-z]{2}|\d{3})$/.test(p)) {
      region = p.toUpperCase();
    }
  }
  return { canon: [lang, script, region].filter(Boolean).join("-"), lang, script, region };
}

/**
 * The shipped language for the first device tag that has one; English when none
 * does. Per tag, in order: exact match; Chinese by script, else by region;
 * regional variants (es-419, fr-CA, pt-PT) only when shipped; then the language
 * subtag (nn and no to nb, Portuguese outside the pt-PT regions and plain "pt"
 * to pt-BR, sr-Latn and sr-Cyrl to sr), preferring the bare language code.
 */
export function matchDeviceLocale(tags: readonly string[], shipped: readonly Locale[]): Locale {
  const has = (l: string): boolean => (shipped as readonly string[]).includes(l);
  for (const tag of tags) {
    const p = parse(tag);
    if (!p) continue;
    const { canon, lang, script, region } = p;
    if (canon === "en" || lang === "en") return "en";
    if (has(canon)) return canon as Locale;

    if (lang === "zh") {
      const traditional = script !== null ? script === "Hant" : region !== null && TRADITIONAL_REGIONS.has(region);
      const zh = traditional ? "zh-Hant" : "zh-Hans";
      if (has(zh)) return zh as Locale;
    }
    if (lang === "es" && region !== null && LATIN_AMERICA.has(region) && has("es-419")) return "es-419" as Locale;
    if (lang === "fr" && region === "CA" && has("fr-CA")) return "fr-CA" as Locale;
    if ((lang === "no" || lang === "nn" || lang === "nb") && has("nb")) return "nb";
    if (lang === "pt") {
      const european = region !== null && EUROPEAN_PORTUGUESE.has(region);
      if (european && has("pt-PT")) return "pt-PT" as Locale;
      if (!european && has("pt-BR")) return "pt-BR";
    }
    if (has(lang)) return lang as Locale;

    const same = shipped.find((s) => s.split("-")[0].toLowerCase() === lang);
    if (same) return same;
  }
  return "en";
}
