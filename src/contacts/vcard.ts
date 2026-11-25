export interface ContactPhone { label: string; number: string }
export interface ContactEmail { label: string; address: string }

export interface NormalizedContact {
  name: string;
  firstName?: string;
  lastName?: string;
  phones: ContactPhone[];
  emails: ContactEmail[];
}

const CRLF = "\r\n";

/** Escape a vCard 3.0 text value (RFC 2426 §5). Backslash MUST be escaped first. */
function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function unescapeText(v: string): string {
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\" && i + 1 < v.length) {
      const n = v[++i];
      out += n === "n" || n === "N" ? "\n" : n; // \\ -> \, \, -> ,, \; -> ;, \n -> newline
    } else {
      out += c;
    }
  }
  return out;
}

/** A TYPE param token derived from a free-form label. */
function typeToken(label: string): string {
  const t = (label || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  return t || "OTHER";
}

function serializeOne(c: NormalizedContact): string {
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeText(c.lastName ?? "")};${escapeText(c.firstName ?? "")};;;`,
    `FN:${escapeText(c.name)}`,
  ];
  for (const p of c.phones) lines.push(`TEL;TYPE=${typeToken(p.label)}:${escapeText(p.number)}`);
  for (const e of c.emails) lines.push(`EMAIL;TYPE=${typeToken(e.label)}:${escapeText(e.address)}`);
  lines.push("END:VCARD");
  return lines.join(CRLF);
}

export function serializeVCards(contacts: NormalizedContact[]): string {
  return contacts.map(serializeOne).join(CRLF) + CRLF;
}

/** Unfold folded lines: a line starting with SPACE or TAB continues the previous one. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Split on an UNescaped separator (a preceding backslash escapes it). */
function splitUnescaped(value: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) { cur += c + value[++i]; continue; }
    if (c === sep) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

interface ParsedLine { name: string; params: string[]; value: string }

function parseLine(line: string): ParsedLine | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const segs = line.slice(0, colon).split(";");
  return { name: segs[0].toUpperCase(), params: segs.slice(1), value: line.slice(colon + 1) };
}

function labelFromParams(params: string[]): string {
  for (const p of params) {
    const eq = p.indexOf("=");
    const k = (eq < 0 ? p : p.slice(0, eq)).toUpperCase();
    const v = eq < 0 ? "" : p.slice(eq + 1);
    if (k === "TYPE" && v) return v.toLowerCase();
  }
  return "other";
}

export function parseVCards(vcf: string): NormalizedContact[] {
  const contacts: NormalizedContact[] = [];
  let cur: NormalizedContact | null = null;
  for (const raw of unfold(vcf)) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") { cur = { name: "", phones: [], emails: [] }; continue; }
    if (upper === "END:VCARD") { if (cur) contacts.push(cur); cur = null; continue; }
    if (!cur) continue;
    const pl = parseLine(line);
    if (!pl) continue;
    switch (pl.name) {
      case "N": {
        const comps = splitUnescaped(pl.value, ";").map(unescapeText);
        if (comps[0]) cur.lastName = comps[0];
        if (comps[1]) cur.firstName = comps[1];
        break;
      }
      case "FN":
        cur.name = unescapeText(pl.value);
        break;
      case "TEL":
        cur.phones.push({ label: labelFromParams(pl.params), number: unescapeText(pl.value) });
        break;
      case "EMAIL":
        cur.emails.push({ label: labelFromParams(pl.params), address: unescapeText(pl.value) });
        break;
    }
  }
  for (const c of contacts) {
    if (!c.name) c.name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  }
  return contacts;
}
