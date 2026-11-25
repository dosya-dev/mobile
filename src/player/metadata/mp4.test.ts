import { locateMoov, parseMp4 } from "./mp4";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const atom = (type: string, body: number[]): number[] => [...u32(8 + body.length), ...ascii(type), ...body];
const dataAtom = (flags: number, payload: number[]) => atom("data", [0, 0, 0, flags, 0, 0, 0, 0, ...payload]);

function fixture(): Uint8Array {
  const mvhd = atom("mvhd", [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(1000), ...u32(185000)]); // v0: timescale 1000, duration 185000 -> 185s
  const ilst = atom("ilst", [
    ...atom("©nam", dataAtom(1, ascii("M4 Song"))),
    ...atom("©ART", dataAtom(1, ascii("M4 Artist"))),
    ...atom("covr", dataAtom(13, [0xff, 0xd8, 9, 9])),
  ]);
  const meta = atom("meta", [0, 0, 0, 0, ...ilst]); // meta carries version+flags before children
  const moov = atom("moov", [...mvhd, ...atom("udta", meta)]);
  return new Uint8Array([...atom("ftyp", ascii("M4A ")), ...moov]);
}

describe("parseMp4", () => {
  it("reads ilst tags, cover art and mvhd duration", () => {
    const r = parseMp4(fixture());
    expect(r).toMatchObject({ title: "M4 Song", artist: "M4 Artist", durationSec: 185 });
    expect(r.artwork?.mime).toBe("image/jpeg");
  });

  it("returns empty for junk and never throws on truncation", () => {
    expect(parseMp4(new Uint8Array([1, 2, 3]))).toEqual({});
    expect(() => parseMp4(fixture().slice(0, 30))).not.toThrow();
  });
});

describe("locateMoov", () => {
  const reader = (b: Uint8Array) => async (pos: number, len: number) => b.slice(pos, pos + len);

  it("steps over boxes by their header without reading their bodies", async () => {
    const file = new Uint8Array([...atom("ftyp", [1, 2, 3, 4]), ...atom("mdat", new Array(5000).fill(0)), ...atom("moov", [9, 9])]);
    const read = jest.fn(reader(file));
    expect(await locateMoov(read, file.length)).toEqual({ offset: 12 + 5008, size: 10 });
    for (const [, len] of read.mock.calls) expect(len).toBeLessThanOrEqual(16);
  });

  it("follows a 64-bit box size", async () => {
    const big = [...u32(1), ...ascii("mdat"), ...u32(0), ...u32(116), ...new Array(100).fill(0)];
    const file = new Uint8Array([...big, ...atom("moov", [])]);
    expect(await locateMoov(reader(file), file.length)).toEqual({ offset: 116, size: 8 });
  });

  it("returns null when there is no moov or a box size is nonsense", async () => {
    const noMoov = new Uint8Array(atom("ftyp", [1]));
    expect(await locateMoov(reader(noMoov), noMoov.length)).toBeNull();
    const zero = new Uint8Array([...u32(4), ...ascii("junk"), ...atom("moov", [])]);
    expect(await locateMoov(reader(zero), zero.length)).toBeNull();
  });
});
