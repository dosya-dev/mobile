import { id3TagSize, parseId3 } from "./id3";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** ID3v2.3 tag with the given frames (id -> body bytes). */
function v23(frames: Record<string, number[]>): Uint8Array {
  const body: number[] = [];
  for (const [id, data] of Object.entries(frames)) body.push(...ascii(id), ...u32(data.length), 0, 0, ...data);
  return new Uint8Array([...ascii("ID3"), 3, 0, 0, ...syncsafe(body.length), ...body]);
}

/** ID3v2.4 tag with the given frames (id -> body bytes). Frame sizes use syncsafe encoding. */
function v24(frames: Record<string, number[]>): Uint8Array {
  const body: number[] = [];
  for (const [id, data] of Object.entries(frames)) body.push(...ascii(id), ...syncsafe(data.length), 0, 0, ...data);
  return new Uint8Array([...ascii("ID3"), 4, 0, 0, ...syncsafe(body.length), ...body]);
}

const latin1Text = (s: string) => [0, ...ascii(s)];
const utf8Text = (s: string) => [3, ...ascii(s)];

describe("parseId3 v2.3", () => {
  it("reads title, artist and album text frames", () => {
    const tag = v23({ TIT2: latin1Text("My Song"), TPE1: utf8Text("The Band"), TALB: latin1Text("The Album") });
    expect(parseId3(tag)).toMatchObject({ title: "My Song", artist: "The Band", album: "The Album" });
  });

  it("extracts APIC artwork with its mime type", () => {
    const img = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
    const apic = [0, ...ascii("image/jpeg"), 0, 3, 0, ...img]; // enc, mime\0, picture type, desc\0, data
    const tag = v23({ TIT2: latin1Text("x"), APIC: apic });
    const art = parseId3(tag).artwork;
    expect(art?.mime).toBe("image/jpeg");
    expect([...(art?.data ?? [])]).toEqual(img);
  });

  it("decodes UTF-16 with BOM", () => {
    const utf16 = [1, 0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]; // "AB" LE
    expect(parseId3(v23({ TIT2: utf16 })).title).toBe("AB");
  });

  it("skips v2.3 extended header correctly", () => {
    // Build a tag with extended header flag + extended header + frame
    const extHeader = [...u32(6), 0, 0, ...u32(0)]; // size=6 (excludes size field), flags, padding size
    const frameBody: number[] = [...ascii("ID3"), 3, 0, 0x40]; // flags = 0x40 (extended header)
    const tagSize = 6 + extHeader.length + 10 + latin1Text("Song").length; // tag size field (syncsafe)
    const frames: Record<string, number[]> = { TIT2: latin1Text("Song") };
    const body: number[] = [...extHeader];
    for (const [id, data] of Object.entries(frames)) body.push(...ascii(id), ...u32(data.length), 0, 0, ...data);
    const tag = new Uint8Array([...ascii("ID3"), 3, 0, 0x40, ...syncsafe(body.length), ...body]);
    expect(parseId3(tag)).toMatchObject({ title: "Song" });
  });

  it("recovers partial results when corrupt UTF-8 is encountered", () => {
    // TIT2 with invalid UTF-8 4-byte sequence that would throw without guard
    const corruptUtf8 = [3, 0xf7, 0xbf, 0xbf, 0xbf]; // invalid code point
    const frames: Record<string, number[]> = { TIT2: corruptUtf8, TPE1: latin1Text("Band") };
    expect(() => parseId3(v23(frames))).not.toThrow();
    // Should skip the corrupt title but still parse artist
    expect(parseId3(v23(frames))).toMatchObject({ artist: "Band" });
  });
});

describe("parseId3 v2.2", () => {
  it("reads 3-char frames (TT2/TP1/TAL)", () => {
    const frame = (id: string, data: number[]) => [...ascii(id), (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff, ...data];
    const body = [...frame("TT2", latin1Text("Old Song")), ...frame("TP1", latin1Text("Old Band"))];
    const tag = new Uint8Array([...ascii("ID3"), 2, 0, 0, ...syncsafe(body.length), ...body]);
    expect(parseId3(tag)).toMatchObject({ title: "Old Song", artist: "Old Band" });
  });
});

describe("parseId3 v2.4", () => {
  it("reads v2.4 frames with syncsafe sizes", () => {
    const tag = v24({ TIT2: latin1Text("New Song"), TPE1: utf8Text("New Band") });
    expect(parseId3(tag)).toMatchObject({ title: "New Song", artist: "New Band" });
  });
});

describe("robustness", () => {
  it("returns empty for non-ID3 bytes and reports zero tag size", () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(parseId3(junk)).toEqual({});
    expect(id3TagSize(junk)).toBe(0);
  });

  it("never throws on a truncated tag or absurd declared frame size", () => {
    const tag = v23({ TIT2: latin1Text("ok") });
    expect(() => parseId3(tag.slice(0, 12))).not.toThrow();
    const evil = v23({ TIT2: latin1Text("ok") });
    evil[14] = 0x7f; evil[15] = 0xff; evil[16] = 0xff; evil[17] = 0xff; // frame size >> buffer
    expect(() => parseId3(evil)).not.toThrow();
  });

  it("id3TagSize covers header + declared size", () => {
    const tag = v23({ TIT2: latin1Text("x") });
    expect(id3TagSize(tag)).toBe(tag.length);
  });
});
