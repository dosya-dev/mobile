import { serializeVCards, parseVCards, type NormalizedContact } from "./vcard";

const ada: NormalizedContact = {
  name: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  phones: [{ label: "mobile", number: "+1 555 0100" }],
  emails: [{ label: "home", address: "ada@example.com" }],
};

describe("serializeVCards", () => {
  it("emits a valid vCard 3.0 card with CRLF endings", () => {
    const out = serializeVCards([ada]);
    expect(out).toContain("BEGIN:VCARD\r\nVERSION:3.0\r\n");
    expect(out).toContain("N:Lovelace;Ada;;;\r\n");
    expect(out).toContain("FN:Ada Lovelace\r\n");
    expect(out).toContain("TEL;TYPE=MOBILE:+1 555 0100\r\n");
    expect(out).toContain("EMAIL;TYPE=HOME:ada@example.com\r\n");
    expect(out.trimEnd().endsWith("END:VCARD")).toBe(true);
  });

  it("escapes , ; \\ and newlines in text values", () => {
    const out = serializeVCards([
      { name: "O'Brien, Jr.\\; \"X\"\nSecond", firstName: "Sean", lastName: "O'Brien", phones: [], emails: [] },
    ]);
    expect(out).toContain("FN:O'Brien\\, Jr.\\\\\\; \"X\"\\nSecond\r\n");
  });
});

describe("parseVCards", () => {
  it("round-trips a contact with phones and emails", () => {
    expect(parseVCards(serializeVCards([ada]))).toEqual([ada]);
  });

  it("round-trips escaped punctuation and newlines", () => {
    const tricky: NormalizedContact = {
      name: "O'Brien, Jr.\\; \"X\"\nSecond",
      firstName: "Sean",
      lastName: "O'Brien",
      phones: [],
      emails: [],
    };
    expect(parseVCards(serializeVCards([tricky]))).toEqual([tricky]);
  });

  it("parses multiple cards", () => {
    const bob: NormalizedContact = { name: "Bob", phones: [], emails: [] };
    const parsed = parseVCards(serializeVCards([ada, bob]));
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual(bob);
  });

  it("fills a missing FN from N components", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Turing;Alan;;;\r\nEND:VCARD\r\n";
    expect(parseVCards(vcf)).toEqual([
      { name: "Alan Turing", firstName: "Alan", lastName: "Turing", phones: [], emails: [] },
    ]);
  });

  it("unfolds RFC-2426 folded lines (CRLF + space continuation)", () => {
    const vcf =
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Very Long \r\n Name Here\r\nN:;;;;\r\nEND:VCARD\r\n";
    expect(parseVCards(vcf)[0].name).toBe("Very Long Name Here");
  });

  it("returns [] for input with no cards", () => {
    expect(parseVCards("garbage\r\nno cards here")).toEqual([]);
  });

  it("round-trips a contact with leading/trailing whitespace in values", () => {
    const padded: NormalizedContact = {
      name: "  Padded Name  ",
      phones: [{ label: "mobile", number: "  555 0100  " }],
      emails: [{ label: "home", address: "  padded@example.com  " }],
    };
    expect(parseVCards(serializeVCards([padded]))).toEqual([padded]);
  });
});
