/**
 * A stand-in cover for a book, derived from its id.
 *
 * The real cover is inside the epub, and reaching it means unzipping the
 * container, reading the OPF manifest and pulling out an image - work that
 * belongs in the reader's book cache, not in a preview that has to paint
 * immediately. Until that exists, a book gets a typographic cover instead of
 * the grey outline glyph it had before.
 *
 * The palette is chosen by hashing the file id, so a given book always looks
 * the same. That is the whole point: a shelf of books becomes recognisable by
 * colour even though none of the covers are real.
 */
export interface CoverPalette {
  /** Top of the cover wash. */
  from: string;
  /** Bottom of the cover wash. */
  to: string;
}

const PALETTES: CoverPalette[] = [
  { from: "#1d3a5c", to: "#5b8f8a" },
  { from: "#3b2340", to: "#d97b62" },
  { from: "#123033", to: "#84a86d" },
  { from: "#40332a", to: "#cfa878" },
  { from: "#2a2f52", to: "#8f7bb5" },
  { from: "#4a1f2b", to: "#c98a7a" },
  { from: "#14343f", to: "#6fa0b8" },
  { from: "#33301a", to: "#b8a76a" },
];

/** djb2, kept tiny and deterministic - the same id must always pick the same cover. */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function coverPalette(fileId: string): CoverPalette {
  if (!fileId) return PALETTES[0];
  return PALETTES[hash(fileId) % PALETTES.length];
}
