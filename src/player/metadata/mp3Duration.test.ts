import { parseMp3Duration } from "./mp3Duration";

// MPEG1 Layer3, 128kbps, 44100Hz, no padding, stereo: FF FB 90 00
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];

function cbrFixture(totalBytes: number): Uint8Array {
  const b = new Uint8Array(totalBytes);
  b.set(FRAME_HEADER, 0);
  return b;
}

function xingFixture(frames: number): Uint8Array {
  const b = new Uint8Array(1024);
  b.set(FRAME_HEADER, 0);
  const off = 4 + 32; // MPEG1 stereo side info
  b.set([0x58, 0x69, 0x6e, 0x67], off); // "Xing"
  b.set([0, 0, 0, 1], off + 4); // flags: frames present
  b.set([(frames >>> 24) & 0xff, (frames >>> 16) & 0xff, (frames >>> 8) & 0xff, frames & 0xff], off + 8);
  return b;
}

describe("parseMp3Duration", () => {
  it("uses the Xing frame count when present (VBR-exact)", () => {
    const r = parseMp3Duration(xingFixture(3830)); // 3830 * 1152 / 44100 ~= 100.04s
    expect(r.sampleRateHz).toBe(44100);
    expect(Math.round(r.durationSec ?? 0)).toBe(100);
  });

  it("estimates from bitrate for CBR without Xing", () => {
    const r = parseMp3Duration(cbrFixture(160_000)); // 160000*8 / 128000 = 10s
    expect(r.bitrateKbps).toBe(128);
    expect(Math.round(r.durationSec ?? 0)).toBe(10);
  });

  it("takes the whole file's size when it was handed only the start of it", () => {
    const r = parseMp3Duration(cbrFixture(1024), 160_000);
    expect(Math.round(r.durationSec ?? 0)).toBe(10);
  });

  it("returns empty and never throws on junk", () => {
    expect(parseMp3Duration(new Uint8Array([0, 1, 2]))).toEqual({});
  });
});
