/**
 * CLDR cardinal plural rules for every language the app ships, used when the
 * JS engine has no working Intl.PluralRules (Hermes on some Android builds).
 *
 * Operands follow UTS 35: n (absolute value), i (integer digits), v (count of
 * visible fraction digits), f (fraction digits as an integer), t (f without
 * trailing zeros). Compact exponent (e) is always 0 for the plain numbers the
 * app formats.
 */

type Category = Intl.LDMLPluralRule;

interface Operands {
  n: number;
  i: number;
  v: number;
  f: number;
  t: number;
}

function operands(value: number): Operands {
  const n = Math.abs(value);
  if (!Number.isFinite(n)) return { n: 0, i: 0, v: 0, f: 0, t: 0 };
  // toFixed(20) would invent digits; the shortest round-trip form is what a
  // user sees. Values this large or small never reach a plural in the app.
  const s = n >= 1e21 || (n > 0 && n < 1e-6) ? n.toFixed(6) : String(n);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return {
    n,
    i: Number(int),
    v: frac.length,
    f: frac ? Number(frac) : 0,
    t: trimmed ? Number(trimmed) : 0,
  };
}

const oneIfI1V0 = ({ i, v }: Operands): Category => (i === 1 && v === 0 ? "one" : "other");
const oneIfN1 = ({ n }: Operands): Category => (n === 1 ? "one" : "other");
const always = (): Category => "other";

/** es, fr, it, pt: "many" for whole millions (CLDR 42+), checked after "one". */
const million = ({ i, v }: Operands): boolean => v === 0 && i !== 0 && i % 1000000 === 0;

const RULES: Record<string, (o: Operands) => Category> = {
  en: oneIfI1V0,
  de: oneIfI1V0,
  nl: oneIfI1V0,
  sv: oneIfI1V0,
  et: oneIfI1V0,
  fi: oneIfI1V0,
  it: (o) => (oneIfI1V0(o) === "one" ? "one" : million(o) ? "many" : "other"),
  es: (o) => (o.n === 1 ? "one" : million(o) ? "many" : "other"),
  fr: (o) => (o.i === 0 || o.i === 1 ? "one" : million(o) ? "many" : "other"),
  pt: (o) => (o.i === 0 || o.i === 1 ? "one" : million(o) ? "many" : "other"),
  tr: oneIfN1,
  hu: oneIfN1,
  el: oneIfN1,
  bg: oneIfN1,
  nb: oneIfN1,
  da: ({ n, i, t }) => (n === 1 || (t !== 0 && (i === 0 || i === 1)) ? "one" : "other"),
  id: always,
  vi: always,
  th: always,
  zh: always,
  pl: ({ i, v }) => {
    if (v !== 0) return "other";
    if (i === 1) return "one";
    const m10 = i % 10;
    const m100 = i % 100;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  },
  cs: ({ i, v }) => {
    if (v !== 0) return "many";
    if (i === 1) return "one";
    return i >= 2 && i <= 4 ? "few" : "other";
  },
  sk: ({ i, v }) => {
    if (v !== 0) return "many";
    if (i === 1) return "one";
    return i >= 2 && i <= 4 ? "few" : "other";
  },
  ro: ({ n, i, v }) => {
    if (i === 1 && v === 0) return "one";
    const m100 = n % 100;
    return v !== 0 || n === 0 || (n !== 1 && m100 >= 1 && m100 <= 19) ? "few" : "other";
  },
  sl: ({ i, v }) => {
    const m100 = i % 100;
    if (v === 0 && m100 === 1) return "one";
    if (v === 0 && m100 === 2) return "two";
    return (v === 0 && (m100 === 3 || m100 === 4)) || v !== 0 ? "few" : "other";
  },
  hr: ({ i, v, f }) => {
    const i10 = i % 10, i100 = i % 100, f10 = f % 10, f100 = f % 100;
    if ((v === 0 && i10 === 1 && i100 !== 11) || (f10 === 1 && f100 !== 11)) return "one";
    if ((v === 0 && i10 >= 2 && i10 <= 4 && !(i100 >= 12 && i100 <= 14)) || (f10 >= 2 && f10 <= 4 && !(f100 >= 12 && f100 <= 14))) return "few";
    return "other";
  },
  lv: ({ n, v, f }) => {
    // CLDR ranges (11..19) only match whole numbers.
    const whole = Number.isInteger(n);
    const n10 = n % 10, n100 = n % 100, f10 = f % 10, f100 = f % 100;
    if (n10 === 0 || (whole && n100 >= 11 && n100 <= 19) || (v === 2 && f100 >= 11 && f100 <= 19)) return "zero";
    if ((n10 === 1 && n100 !== 11) || (v === 2 && f10 === 1 && f100 !== 11) || (v !== 2 && f10 === 1)) return "one";
    return "other";
  },
  ru: ({ i, v }) => {
    const m10 = i % 10;
    const m100 = i % 100;
    if (v !== 0) return "other";
    if (m10 === 1 && m100 !== 11) return "one";
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  },
  lt: ({ n, f }) => {
    const n10 = n % 10, n100 = n % 100;
    if (f !== 0) return "many";
    if (n10 === 1 && !(n100 >= 11 && n100 <= 19)) return "one";
    if (n10 >= 2 && n10 <= 9 && !(n100 >= 11 && n100 <= 19)) return "few";
    return "other";
  },
  ja: always,
  ko: always,
  ar: ({ n }) => {
    // CLDR ranges (3..10, 11..99) only match whole numbers.
    const m100 = n % 100;
    if (n === 0) return "zero";
    if (n === 1) return "one";
    if (n === 2) return "two";
    if (Number.isInteger(n) && m100 >= 3 && m100 <= 10) return "few";
    if (Number.isInteger(n) && m100 >= 11 && m100 <= 99) return "many";
    return "other";
  },
  he: ({ i, v }) => {
    if ((i === 1 && v === 0) || (i === 0 && v !== 0)) return "one";
    return i === 2 && v === 0 ? "two" : "other";
  },
  fa: ({ n, i }) => (i === 0 || n === 1 ? "one" : "other"),
};

RULES.no = RULES.nb;
RULES.nn = RULES.nb;
RULES.uk = RULES.ru;
RULES.sr = RULES.hr;

/**
 * European Portuguese (and the CLDR regions that inherit from it) keeps "one"
 * for exactly 1: zero is "other", unlike Brazilian Portuguese.
 */
const ptPT = (o: Operands): Category => (oneIfI1V0(o) === "one" ? "one" : million(o) ? "many" : "other");
const PT_PT_REGIONS = new Set(["PT", "AO", "CH", "CV", "GQ", "GW", "LU", "MO", "MZ", "ST", "TL"]);

/** The rule key for a locale: the language, or "pt-PT" for European Portuguese regions. */
function ruleKey(locale: string): string {
  const parts = locale.split(/[-_]/);
  const lang = languageOf(locale);
  if (lang === "pt" && parts.slice(1).some((p) => PT_PT_REGIONS.has(p.toUpperCase()))) return "pt-PT";
  return lang;
}
RULES["pt-PT"] = ptPT;

/** The categories each language can produce, in CLDR order. */
const CATEGORIES: Record<string, Category[]> = {
  pl: ["one", "few", "many", "other"],
  cs: ["one", "few", "many", "other"],
  sk: ["one", "few", "many", "other"],
  ro: ["one", "few", "other"],
  sl: ["one", "two", "few", "other"],
  hr: ["one", "few", "other"],
  lv: ["zero", "one", "other"],
  lt: ["one", "few", "many", "other"],
  ru: ["one", "few", "many", "other"],
  uk: ["one", "few", "many", "other"],
  sr: ["one", "few", "other"],
  es: ["one", "many", "other"],
  fr: ["one", "many", "other"],
  it: ["one", "many", "other"],
  pt: ["one", "many", "other"],
  "pt-PT": ["one", "many", "other"],
  da: ["one", "other"],
  id: ["other"],
  vi: ["other"],
  th: ["other"],
  zh: ["other"],
  ja: ["other"],
  ko: ["other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
  he: ["one", "two", "other"],
  fa: ["one", "other"],
};

/** "pt-BR" -> "pt", "zh-Hans" -> "zh", "NB" -> "nb". */
export function languageOf(locale: string): string {
  return locale.split(/[-_]/)[0].toLowerCase();
}

export function pluralCategory(locale: string, n: number): Intl.LDMLPluralRule {
  const rule = RULES[ruleKey(locale)];
  return rule ? rule(operands(n)) : "other";
}

export function pluralCategories(locale: string): Intl.LDMLPluralRule[] {
  const key = ruleKey(locale);
  return CATEGORIES[key] ?? (RULES[key] === oneIfI1V0 || RULES[key] === oneIfN1 ? ["one", "other"] : ["other"]);
}
