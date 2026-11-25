/**
 * A LOSSLESS vCard document model, for editing a .vcf the user already owns.
 *
 * The existing parser in ./vcard.ts is deliberately lossy: it understands N /
 * FN / TEL / EMAIL and drops everything else, which is fine for its job
 * (turning a phone's address book into a backup file and back). It is NOT
 * fine for an editor. Round-tripping a real address book through it would
 * silently delete ORG, ADR, NOTE, BDAY, URL, embedded PHOTO blobs, and every
 * vendor extension - and then save the result over the user's file.
 *
 * So this module keeps every logical line's ORIGINAL text, still folded,
 * exactly as it arrived. Serialization re-emits that text verbatim for any
 * line the user did not touch; only a line marked dirty is re-encoded. A
 * 200-line base64 PHOTO the UI never exposes therefore comes back byte for
 * byte identical.
 */

/** RFC 6350 §3.2: continuation lines begin with a space or tab. */
const FOLD_AT = 75;

/**
 * Files above this are not parsed. Parsing is synchronous and a vCard export
 * carrying contact photos grows fast - a 20MB address book would block the JS
 * thread for seconds. Callers fall back to a plain-text preview instead.
 */
import { t } from "@/lib/i18n";

export const MAX_VCF_PARSE_BYTES = 5 * 1024 * 1024;

export interface RawLine {
  /** The logical line as it appeared in the file, still folded. Authoritative while `dirty` is false. */
  raw: string;
  /** Property name, upper-cased (FN, TEL, PHOTO, X-VENDOR-THING). */
  name: string;
  /** Everything between the name and the colon, split on ";" (e.g. ["TYPE=CELL"]). */
  params: string[];
  /** Unescaped value. Only meaningful for text properties the UI edits. */
  value: string;
  /** Set once the value has been changed; drives re-encoding on serialize. */
  dirty: boolean;
}

export interface RawCard {
  lines: RawLine[];
}

export interface VCardDoc {
  /** The file's own terminator, preserved so an LF file doesn't silently become CRLF. */
  eol: "\r\n" | "\n";
  cards: RawCard[];
  /** Anything outside a BEGIN/END pair (stray blank lines, junk). Re-emitted after the cards. */
  trailing: string[];
}

export interface ContactField {
  /** Index into the card's `lines`, so an edit targets the exact line it came from. */
  lineIndex: number;
  label: string;
  value: string;
}

export interface ContactView {
  displayName: string;
  org: string;
  phones: ContactField[];
  emails: ContactField[];
  /** How many properties exist that the UI does not surface - shown so the user knows they are preserved. */
  hiddenCount: number;
}

// ── decoding ────────────────────────────────────────────────────────────────

function unescapeText(v: string): string {
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\" && i + 1 < v.length) {
      const n = v[++i];
      out += n === "n" || n === "N" ? "\n" : n;
    } else {
      out += c;
    }
  }
  return out;
}

function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Strip fold continuations to get the logical content of a folded line. */
function unfoldOne(raw: string): string {
  return raw
    .split(/\r\n|\n/)
    .map((part, i) => (i === 0 ? part : part.replace(/^[ \t]/, "")))
    .join("");
}

/**
 * Fold at 75 octets per RFC 6350 §3.2. Only ever applied to lines the user
 * edited - untouched lines keep whatever folding the source file used, even
 * if that folding was unusual.
 */
function fold(line: string, eol: string): string {
  if (line.length <= FOLD_AT) return line;
  const parts: string[] = [line.slice(0, FOLD_AT)];
  for (let i = FOLD_AT; i < line.length; i += FOLD_AT - 1) {
    parts.push(" " + line.slice(i, i + FOLD_AT - 1));
  }
  return parts.join(eol);
}

function decodeLine(raw: string): RawLine {
  const logical = unfoldOne(raw);
  const colon = logical.indexOf(":");
  if (colon < 0) return { raw, name: "", params: [], value: "", dirty: false };
  const segs = logical.slice(0, colon).split(";");
  return {
    raw,
    name: segs[0].toUpperCase(),
    params: segs.slice(1),
    value: unescapeText(logical.slice(colon + 1)),
    dirty: false,
  };
}

/** Re-encode a dirty line from its decoded parts, preserving name and params. */
function encodeLine(line: RawLine, eol: string): string {
  const prefix = [line.name, ...line.params].join(";");
  return fold(`${prefix}:${escapeText(line.value)}`, eol);
}

/**
 * Group physical lines into logical ones, keeping the fold characters in
 * place. A continuation is any line starting with a space or tab.
 */
function toLogicalLines(text: string, eol: string): string[] {
  const physical = text.split(/\r\n|\n/);
  const out: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += eol + line;
    } else {
      out.push(line);
    }
  }
  return out;
}

export function parseVCardFile(text: string): VCardDoc {
  // A single CRLF anywhere is enough to call the file CRLF: mixed terminators
  // are malformed either way, and CRLF is what the spec requires, so it is the
  // safer guess to normalize an edited line to.
  const eol: "\r\n" | "\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const doc: VCardDoc = { eol, cards: [], trailing: [] };

  let cur: RawCard | null = null;
  for (const raw of toLogicalLines(text, eol)) {
    const upper = unfoldOne(raw).trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      cur = { lines: [decodeLine(raw)] };
      continue;
    }
    if (upper === "END:VCARD") {
      if (cur) {
        cur.lines.push(decodeLine(raw));
        doc.cards.push(cur);
      }
      cur = null;
      continue;
    }
    if (cur) {
      // Blank lines inside a card carry no information and would otherwise
      // come back as empty properties.
      if (raw.trim() !== "") cur.lines.push(decodeLine(raw));
      continue;
    }
    if (raw.trim() !== "") doc.trailing.push(raw);
  }
  // An unterminated final card (truncated file) is still worth showing and
  // editing; give it the END it is missing rather than discarding its data.
  if (cur) {
    cur.lines.push(decodeLine("END:VCARD"));
    doc.cards.push(cur);
  }
  return doc;
}

export function serializeVCardFile(doc: VCardDoc): string {
  const out: string[] = [];
  for (const card of doc.cards) {
    for (const line of card.lines) {
      out.push(line.dirty ? encodeLine(line, doc.eol) : line.raw);
    }
  }
  out.push(...doc.trailing);
  return out.length ? out.join(doc.eol) + doc.eol : "";
}

// ── reading ─────────────────────────────────────────────────────────────────

/** The TYPE param, lower-cased, for display next to a phone or email. */
function labelOf(line: RawLine): string {
  for (const p of line.params) {
    const eq = p.indexOf("=");
    const k = (eq < 0 ? p : p.slice(0, eq)).toUpperCase();
    const v = eq < 0 ? "" : p.slice(eq + 1);
    // TYPE=HOME,VOICE is common; the first token is the useful one.
    if (k === "TYPE" && v) return v.split(",")[0].toLowerCase();
  }
  return "other";
}

/** Properties the editor surfaces. Everything else is preserved but not shown. */
const SHOWN = new Set(["BEGIN", "END", "VERSION", "FN", "N", "TEL", "EMAIL", "ORG"]);

function nameFromN(value: string): string {
  // N is structured: Family;Given;Middle;Prefix;Suffix
  const [family = "", given = ""] = value.split(";");
  return [given, family].filter(Boolean).join(" ").trim();
}

export function contactView(card: RawCard): ContactView {
  let fn = "";
  let n = "";
  let org = "";
  const phones: ContactField[] = [];
  const emails: ContactField[] = [];
  let hiddenCount = 0;

  card.lines.forEach((line, lineIndex) => {
    switch (line.name) {
      case "FN": fn = line.value; break;
      case "N": n = nameFromN(line.value); break;
      case "ORG": org = line.value.split(";")[0] ?? ""; break;
      case "TEL": phones.push({ lineIndex, label: labelOf(line), value: line.value }); break;
      case "EMAIL": emails.push({ lineIndex, label: labelOf(line), value: line.value }); break;
      default:
        if (line.name && !SHOWN.has(line.name)) hiddenCount++;
    }
  });

  return { displayName: fn || n || t("common.label.noName"), org, phones, emails, hiddenCount };
}

/** Case-insensitive substring match across the fields a user would search by. */
export function matchesQuery(view: ContactView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (view.displayName.toLowerCase().includes(q)) return true;
  if (view.org.toLowerCase().includes(q)) return true;
  // Digits-only comparison for phones, so "555 0100" finds "+1-555-0100".
  const qDigits = q.replace(/\D/g, "");
  for (const p of view.phones) {
    if (p.value.toLowerCase().includes(q)) return true;
    if (qDigits.length >= 3 && p.value.replace(/\D/g, "").includes(qDigits)) return true;
  }
  return view.emails.some((e) => e.value.toLowerCase().includes(q));
}

// ── editing ─────────────────────────────────────────────────────────────────
//
// All of these return a NEW document; nothing mutates in place, so React state
// updates behave and an unsaved edit can be discarded by dropping the value.

function mapCard(doc: VCardDoc, cardIndex: number, fn: (card: RawCard) => RawCard): VCardDoc {
  return { ...doc, cards: doc.cards.map((c, i) => (i === cardIndex ? fn(c) : c)) };
}

/** Change one line's value. The line keeps its name and params. */
export function setLineValue(doc: VCardDoc, cardIndex: number, lineIndex: number, value: string): VCardDoc {
  return mapCard(doc, cardIndex, (card) => ({
    lines: card.lines.map((l, i) => (i === lineIndex ? { ...l, value, dirty: true } : l)),
  }));
}

/**
 * Rename a contact. FN is the display name and is what gets written; an N line,
 * if present, is left alone - it is structured (family/given/middle), and
 * splitting a free-text name back into components guesses wrong often enough
 * (compound surnames, non-Western orders) that leaving the original intact is
 * the better failure mode.
 */
export function setDisplayName(doc: VCardDoc, cardIndex: number, name: string): VCardDoc {
  const card = doc.cards[cardIndex];
  if (!card) return doc;
  const fnIndex = card.lines.findIndex((l) => l.name === "FN");
  if (fnIndex >= 0) return setLineValue(doc, cardIndex, fnIndex, name);
  return addLine(doc, cardIndex, "FN", [], name);
}

/** Append a property before END:VCARD. */
export function addLine(doc: VCardDoc, cardIndex: number, name: string, params: string[], value: string): VCardDoc {
  return mapCard(doc, cardIndex, (card) => {
    const line: RawLine = { raw: "", name, params, value, dirty: true };
    const endIndex = card.lines.findIndex((l) => l.name === "END");
    const at = endIndex >= 0 ? endIndex : card.lines.length;
    return { lines: [...card.lines.slice(0, at), line, ...card.lines.slice(at)] };
  });
}

export function removeLine(doc: VCardDoc, cardIndex: number, lineIndex: number): VCardDoc {
  return mapCard(doc, cardIndex, (card) => ({ lines: card.lines.filter((_, i) => i !== lineIndex) }));
}

/** A TYPE token derived from a free-form label, matching vcard.ts's serializer. */
export function typeToken(label: string): string {
  const t = (label || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  return t || "OTHER";
}

export function addPhone(doc: VCardDoc, cardIndex: number, label: string, value: string): VCardDoc {
  return addLine(doc, cardIndex, "TEL", [`TYPE=${typeToken(label)}`], value);
}

export function addEmail(doc: VCardDoc, cardIndex: number, label: string, value: string): VCardDoc {
  return addLine(doc, cardIndex, "EMAIL", [`TYPE=${typeToken(label)}`], value);
}

export function removeCard(doc: VCardDoc, cardIndex: number): VCardDoc {
  return { ...doc, cards: doc.cards.filter((_, i) => i !== cardIndex) };
}

/** A minimal, valid new card. Version 3.0 matches what vcard.ts writes. */
export function addCard(doc: VCardDoc, name: string): VCardDoc {
  const line = (n: string, value: string, params: string[] = []): RawLine =>
    ({ raw: "", name: n, params, value, dirty: true });
  const card: RawCard = {
    lines: [
      { raw: "BEGIN:VCARD", name: "BEGIN", params: [], value: "VCARD", dirty: false },
      line("VERSION", "3.0"),
      line("FN", name),
      { raw: "END:VCARD", name: "END", params: [], value: "VCARD", dirty: false },
    ],
  };
  return { ...doc, cards: [...doc.cards, card] };
}
