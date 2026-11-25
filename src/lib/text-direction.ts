/**
 * The direction a piece of text reads in, decided the way the Unicode
 * bidirectional algorithm's first-strong rule does: the first character with a
 * strong direction wins. Isolate-wrapped runs (FSI/LRI/RLI ... PDI) are skipped,
 * because they hold a value the sentence quotes, not the sentence itself.
 *
 * Used by the document stages (text, code, CSV, Markdown): a file's content
 * follows its own language, not the app's.
 */

const RTL_RANGES: [number, number][] = [
  [0x0590, 0x08ff], // Hebrew, Arabic, Syriac, Arabic Supplement, Thaana, NKo, Samaritan, Mandaic, Arabic Extended
  [0xfb1d, 0xfdff], // Hebrew and Arabic presentation forms A
  [0xfe70, 0xfeff], // Arabic presentation forms B
  [0x10800, 0x10fff], // right-to-left historic scripts
  [0x1e800, 0x1efff], // Mende Kikakui, Adlam, Arabic Mathematical
];

const isRtlCode = (cp: number): boolean => RTL_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** Letters of any script (a strong character); digits, marks, punctuation and space are not. */
const LETTER = /\p{L}/u;
const RTL_MARKS = new Set([0x200f, 0x061c]);

export function firstStrongDir(text: string): "ltr" | "rtl" | null {
  let isolates = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x2066 || cp === 0x2067 || cp === 0x2068) {
      isolates++;
      continue;
    }
    if (cp === 0x2069) {
      if (isolates > 0) isolates--;
      continue;
    }
    if (isolates > 0) continue;
    if (cp === 0x200e) return "ltr";
    if (RTL_MARKS.has(cp)) return "rtl";
    if (isRtlCode(cp) && LETTER.test(ch)) return "rtl";
    if (LETTER.test(ch)) return "ltr";
  }
  return null;
}

/** `firstStrongDir` over the first 4 KB of a document, left to right when it has no strong character. */
export function documentDir(text: string): "ltr" | "rtl" {
  return firstStrongDir(text.slice(0, 4096)) ?? "ltr";
}

/** Right-to-left mark (U+200F). */
export const RLM = "\u200F";
/**
 * Every Unicode bidi control: marks, embeddings, overrides and isolates. Global,
 * for String.replace only (a global regex keeps state across .test calls).
 */
export const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Gives a line a right-to-left base: a leading RLM (U+200F) unless the line
 * already reads right to left. Without it, a line in an RTL language whose
 * first strong letter is Latin ("193 B · 22 أكتوبر", "iOS ...") becomes a
 * left-to-right paragraph and its Arabic or Hebrew runs come out reordered.
 *
 * The line counts as right to left only when both readings agree: with
 * isolated values skipped (the Unicode rule) and with them read through (what
 * iOS was seen doing with "{used} من {total}"). The mark is display only; every
 * sink strips it (stripBidi in lib/i18n.tsx). Callers decide the language.
 */
export function rtlBase(text: string): string {
  if (text === "" || text.startsWith(RLM)) return text;
  if (firstStrongDir(text) === "rtl" && firstStrongDir(text.replace(BIDI_CONTROLS, "")) === "rtl") return text;
  return RLM + text;
}
