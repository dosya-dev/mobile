import {
  addCard, addEmail, addPhone, contactView, matchesQuery, parseVCardFile,
  removeCard, removeLine, serializeVCardFile, setDisplayName, setLineValue,
} from "./vcardFile";

/**
 * A card carrying everything the editor does NOT surface: org, structured
 * address, note with escapes, birthday, url, a vendor extension, and a folded
 * base64 photo. Editing a phone number must not disturb one byte of it.
 */
const RICH = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Lovelace;Ada;;;",
  "FN:Ada Lovelace",
  "ORG:Analytical Engines;Research",
  "TITLE:Mathematician",
  "TEL;TYPE=CELL:+1-555-0100",
  "TEL;TYPE=HOME:+1-555-0142",
  "EMAIL;TYPE=WORK:ada@example.com",
  "ADR;TYPE=HOME:;;12 Baker St;London;;NW1;UK",
  "BDAY:1815-12-10",
  "URL:https://example.com/ada",
  "NOTE:Wrote the first algorithm\\, in 1843\\; see the notes.",
  "X-VENDOR-FLAG:keep-me",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJ",
  " CQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/",
  " 2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy",
  "END:VCARD",
].join("\r\n") + "\r\n";

const TWO_CARDS = [
  "BEGIN:VCARD", "VERSION:3.0", "FN:Ada Lovelace", "TEL;TYPE=CELL:555-0100", "END:VCARD",
  "BEGIN:VCARD", "VERSION:3.0", "FN:Adam Smith", "EMAIL;TYPE=HOME:adam@example.com", "END:VCARD",
].join("\r\n") + "\r\n";

describe("parse / serialize fidelity", () => {
  it("round-trips an untouched file byte for byte", () => {
    expect(serializeVCardFile(parseVCardFile(RICH))).toBe(RICH);
  });

  it("preserves every unsurfaced property when a phone is edited", () => {
    // The reason this module exists. vcard.ts's parser understands only
    // N/FN/TEL/EMAIL, so a parse-edit-serialize through it would delete the
    // org, address, note, birthday, url, vendor flag and photo below - and
    // then save that over the user's file.
    const doc = parseVCardFile(RICH);
    const view = contactView(doc.cards[0]);
    const cell = view.phones.find((p) => p.label === "cell")!;
    const out = serializeVCardFile(setLineValue(doc, 0, cell.lineIndex, "+1-555-0199"));

    expect(out).toContain("TEL;TYPE=CELL:+1-555-0199");
    expect(out).not.toContain("555-0100");
    for (const preserved of [
      "ORG:Analytical Engines;Research",
      "TITLE:Mathematician",
      "ADR;TYPE=HOME:;;12 Baker St;London;;NW1;UK",
      "BDAY:1815-12-10",
      "URL:https://example.com/ada",
      "NOTE:Wrote the first algorithm\\, in 1843\\; see the notes.",
      "X-VENDOR-FLAG:keep-me",
      "TEL;TYPE=HOME:+1-555-0142",
    ]) {
      expect(out).toContain(preserved);
    }
  });

  it("keeps a folded base64 photo folded exactly as it arrived", () => {
    // Re-folding at our own boundaries would still be a valid vCard, but it
    // rewrites bytes we have no business touching - and any deviation here
    // means the "untouched lines are verbatim" guarantee is not real.
    const doc = parseVCardFile(RICH);
    const out = serializeVCardFile(setDisplayName(doc, 0, "Ada B. Lovelace"));
    const photoBlock = RICH.slice(RICH.indexOf("PHOTO;"), RICH.indexOf("END:VCARD"));
    expect(out).toContain(photoBlock.trimEnd());
  });

  it("preserves an LF-only file's line endings", () => {
    const lf = RICH.replace(/\r\n/g, "\n");
    const doc = parseVCardFile(lf);
    expect(doc.eol).toBe("\n");
    const out = serializeVCardFile(setDisplayName(doc, 0, "Ada L"));
    expect(out).not.toContain("\r\n");
    expect(out).toContain("FN:Ada L");
  });

  it("keeps CRLF for a CRLF file", () => {
    expect(parseVCardFile(RICH).eol).toBe("\r\n");
    expect(serializeVCardFile(parseVCardFile(RICH))).toContain("\r\n");
  });

  it("re-escapes separators in an edited value", () => {
    const doc = parseVCardFile(TWO_CARDS);
    const out = serializeVCardFile(setDisplayName(doc, 0, "Lovelace, Ada; the first"));
    expect(out).toContain("FN:Lovelace\\, Ada\\; the first");
  });

  it("unescapes values for display", () => {
    const view = contactView(parseVCardFile(RICH).cards[0]);
    expect(view.displayName).toBe("Ada Lovelace");
    expect(view.org).toBe("Analytical Engines");
  });

  it("folds a long edited value but leaves short ones alone", () => {
    const doc = parseVCardFile(TWO_CARDS);
    const long = "x".repeat(200);
    const out = serializeVCardFile(setDisplayName(doc, 0, long));
    const folded = out.split("\r\n").filter((l) => l.startsWith(" "));
    expect(folded.length).toBeGreaterThan(0);
    // Round-tripping the folded output must give the value back intact.
    expect(contactView(parseVCardFile(out).cards[0]).displayName).toBe(long);
  });

  it("handles an empty file without producing a stray terminator", () => {
    expect(serializeVCardFile(parseVCardFile(""))).toBe("");
  });

  it("closes an unterminated final card rather than dropping its data", () => {
    const truncated = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada\r\n";
    const doc = parseVCardFile(truncated);
    expect(doc.cards).toHaveLength(1);
    expect(serializeVCardFile(doc)).toContain("END:VCARD");
  });
});

describe("contactView", () => {
  it("projects the fields the editor surfaces", () => {
    const view = contactView(parseVCardFile(RICH).cards[0]);
    expect(view.phones.map((p) => [p.label, p.value])).toEqual([
      ["cell", "+1-555-0100"],
      ["home", "+1-555-0142"],
    ]);
    expect(view.emails).toEqual([{ lineIndex: expect.any(Number), label: "work", value: "ada@example.com" }]);
  });

  it("counts preserved-but-hidden properties so the user knows they survive", () => {
    // TITLE, ADR, BDAY, URL, NOTE, X-VENDOR-FLAG, PHOTO
    expect(contactView(parseVCardFile(RICH).cards[0]).hiddenCount).toBe(7);
  });

  it("falls back to N when FN is absent, then to a placeholder", () => {
    const noFn = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Hopper;Grace;;;\r\nEND:VCARD\r\n";
    expect(contactView(parseVCardFile(noFn).cards[0]).displayName).toBe("Grace Hopper");
    const bare = "BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n";
    expect(contactView(parseVCardFile(bare).cards[0]).displayName).toBe("(no name)");
  });

  it("takes the first token of a multi-value TYPE param", () => {
    const multi = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:X\r\nTEL;TYPE=HOME,VOICE:555\r\nEND:VCARD\r\n";
    expect(contactView(parseVCardFile(multi).cards[0]).phones[0].label).toBe("home");
  });
});

describe("matchesQuery", () => {
  const view = contactView(parseVCardFile(RICH).cards[0]);

  it("matches name, org, email and phone, case-insensitively", () => {
    expect(matchesQuery(view, "ada")).toBe(true);
    expect(matchesQuery(view, "LOVELACE")).toBe(true);
    expect(matchesQuery(view, "analytical")).toBe(true);
    expect(matchesQuery(view, "ada@example")).toBe(true);
    expect(matchesQuery(view, "0142")).toBe(true);
  });

  it("matches a phone typed with different punctuation", () => {
    expect(matchesQuery(view, "555 0100")).toBe(true);
    expect(matchesQuery(view, "(555) 0100")).toBe(true);
  });

  it("does not match unrelated text, and an empty query matches everything", () => {
    expect(matchesQuery(view, "babbage")).toBe(false);
    expect(matchesQuery(view, "")).toBe(true);
    expect(matchesQuery(view, "   ")).toBe(true);
  });

  it("does not let a one-digit query match every phone number", () => {
    // Digit-stripped comparison needs a floor, or "1" matches almost anything.
    expect(matchesQuery(view, "9")).toBe(false);
  });
});

describe("editing", () => {
  it("adds a phone and an email to an existing card", () => {
    let doc = parseVCardFile(TWO_CARDS);
    doc = addPhone(doc, 0, "work", "555-0177");
    doc = addEmail(doc, 0, "home", "ada@home.example");
    const out = serializeVCardFile(doc);
    expect(out).toContain("TEL;TYPE=WORK:555-0177");
    expect(out).toContain("EMAIL;TYPE=HOME:ada@home.example");
    // Appended before END, not after it, or the card is malformed.
    expect(out.indexOf("TEL;TYPE=WORK")).toBeLessThan(out.indexOf("END:VCARD"));
  });

  it("removes a single field without touching the rest of the card", () => {
    const doc = parseVCardFile(TWO_CARDS);
    const phone = contactView(doc.cards[0]).phones[0];
    const out = serializeVCardFile(removeLine(doc, 0, phone.lineIndex));
    expect(out).not.toContain("555-0100");
    expect(out).toContain("FN:Ada Lovelace");
    expect(out).toContain("FN:Adam Smith");
  });

  it("removes a whole contact and leaves the others intact", () => {
    const out = serializeVCardFile(removeCard(parseVCardFile(TWO_CARDS), 0));
    expect(out).not.toContain("Ada Lovelace");
    expect(out).toContain("FN:Adam Smith");
    expect(out.match(/BEGIN:VCARD/g)).toHaveLength(1);
  });

  it("adds a new contact as a valid card", () => {
    const out = serializeVCardFile(addCard(parseVCardFile(TWO_CARDS), "Grace Hopper"));
    expect(out.match(/BEGIN:VCARD/g)).toHaveLength(3);
    expect(out).toContain("FN:Grace Hopper");
    const reparsed = parseVCardFile(out);
    expect(contactView(reparsed.cards[2]).displayName).toBe("Grace Hopper");
  });

  it("adds FN to a card that has none rather than silently doing nothing", () => {
    const noFn = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Hopper;Grace;;;\r\nEND:VCARD\r\n";
    const out = serializeVCardFile(setDisplayName(parseVCardFile(noFn), 0, "Grace H"));
    expect(out).toContain("FN:Grace H");
  });

  it("never mutates the input document", () => {
    const doc = parseVCardFile(TWO_CARDS);
    const before = serializeVCardFile(doc);
    setDisplayName(doc, 0, "Changed");
    addPhone(doc, 0, "work", "555");
    removeCard(doc, 0);
    expect(serializeVCardFile(doc)).toBe(before);
  });

  it("ignores an out-of-range card index instead of throwing", () => {
    const doc = parseVCardFile(TWO_CARDS);
    expect(serializeVCardFile(setDisplayName(doc, 99, "X"))).toBe(TWO_CARDS);
  });
});
