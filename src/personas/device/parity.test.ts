import type { ReadFace } from "@dosya-dev/personas-engine";
import { comparePersonasParity, type ParityReference } from "./parity";

const W = 1600;
const H = 1000;
const sizes = { "a.jpg": { width: W, height: H } };

function unit(seed: number): number[] {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(seed * 31 + i * 1.7));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

const reference: ParityReference = {
  version: 1,
  files: {
    "a.jpg": {
      width: W,
      height: H,
      faces: [
        { box: [100, 200, 160, 180], score: 0.9, sig: unit(1) },
        { box: [900, 300, 120, 140], score: 0.8, sig: unit(2) },
      ],
    },
  },
};

const toFace = (box: number[], sig: number[]): ReadFace => ({
  box: { x: box[0] / W, y: box[1] / H, w: box[2] / W, h: box[3] / H },
  sig: Float32Array.from(sig),
  score: 0.9,
});

const same = (): Record<string, ReadFace[]> => ({
  "a.jpg": reference.files["a.jpg"].faces.map((f) => toFace(f.box, f.sig)),
});

/** A unit vector at the given cosine to `v` (orthogonal part built by Gram-Schmidt). */
function rotated(v: number[], cos: number): number[] {
  const o = unit(99);
  const d = o.reduce((s, x, i) => s + x * v[i], 0);
  const perp = o.map((x, i) => x - d * v[i]);
  const n = Math.hypot(...perp);
  const sin = Math.sqrt(1 - cos * cos);
  return v.map((x, i) => cos * x + (sin * perp[i]) / n);
}

describe("comparePersonasParity", () => {
  it("passes identical input and reports each face", () => {
    const r = comparePersonasParity(reference, same(), sizes);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatch(/^a\.jpg #0 box 0\.\d+ px cos 1\.0000/);
  });

  it("passes sub-pixel box noise and pairs faces in any order", () => {
    const got = same();
    got["a.jpg"].reverse();
    got["a.jpg"][0].box.x += 1.5 / W;
    expect(comparePersonasParity(reference, got, sizes).ok).toBe(true);
  });

  it("fails when a sig is at cosine 0.998", () => {
    const got = same();
    got["a.jpg"][0].sig = Float32Array.from(rotated(reference.files["a.jpg"].faces[0].sig, 0.998));
    const r = comparePersonasParity(reference, got, sizes);
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => l.includes("FAIL") && l.includes("#0"))).toBe(true);
  });

  it("passes cosine 0.9995", () => {
    const got = same();
    got["a.jpg"][0].sig = Float32Array.from(rotated(reference.files["a.jpg"].faces[0].sig, 0.9995));
    expect(comparePersonasParity(reference, got, sizes).ok).toBe(true);
  });

  it("fails when a box is 3 px off", () => {
    const got = same();
    got["a.jpg"][1].box.y += 3 / H;
    const r = comparePersonasParity(reference, got, sizes);
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => l.includes("FAIL") && l.includes("#1") && l.includes("3.00 px"))).toBe(true);
  });

  it("fails when a face is missing", () => {
    const got = same();
    got["a.jpg"].pop();
    const r = comparePersonasParity(reference, got, sizes);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/a\.jpg: FAIL.*expected 2 faces, got 1/);
  });

  it("fails when an extra face appears or a photo is absent", () => {
    const extra = same();
    extra["a.jpg"].push(toFace([10, 10, 50, 50], unit(5)));
    expect(comparePersonasParity(reference, extra, sizes).ok).toBe(false);
    expect(comparePersonasParity(reference, {}, sizes).ok).toBe(false);
  });

  describe("near ties from the reference", () => {
    const sigAlt = unit(7);
    const tied: ParityReference = {
      version: 1,
      tieMargin: 0.001,
      files: {
        "a.jpg": {
          width: W,
          height: H,
          faces: [
            { box: [100, 200, 160, 180], score: 0.9, sig: unit(1), alts: [{ box: [96, 192, 166, 186], score: 0.8999, sig: sigAlt }] },
            { box: [900, 300, 120, 140], score: 0.8905, sig: unit(2), optional: true },
          ],
        },
      },
    };
    const tiedSame = () => ({ "a.jpg": tied.files["a.jpg"].faces.map((f) => toFace(f.box, f.sig)) });

    it("passes when the phone picks the tied rival, and says so", () => {
      const got = tiedSame();
      got["a.jpg"][0] = toFace([96, 192, 166, 186], sigAlt);
      const r = comparePersonasParity(tied, got, sizes);
      expect(r.ok).toBe(true);
      expect(r.lines[0]).toMatch(/^a\.jpg #0 box 0\.00 px cos 1\.0000 \(near tie: rival 1\)$/);
    });

    it("still fails a face that matches neither the winner nor a rival", () => {
      const got = tiedSame();
      // Half-way between the winner and the rival: 4 px from the winner, 4 px from the rival.
      got["a.jpg"][0] = toFace([98, 196, 163, 183], unit(1));
      const r = comparePersonasParity(tied, got, sizes);
      expect(r.ok).toBe(false);
      expect(r.lines[0]).toMatch(/FAIL$/);
    });

    it("does not let a rival's box excuse the winner's signature", () => {
      const got = tiedSame();
      got["a.jpg"][0] = toFace([96, 192, 166, 186], unit(1));
      expect(comparePersonasParity(tied, got, sizes).ok).toBe(false);
    });

    it("passes when an optional face (score at the floor) is absent", () => {
      const got = tiedSame();
      got["a.jpg"].pop();
      const r = comparePersonasParity(tied, got, sizes);
      expect(r.ok).toBe(true);
      expect(r.lines[1]).toBe("a.jpg #1 absent (optional: score at the floor)");
    });

    it("fails when a required face is absent even though another is optional", () => {
      const got = tiedSame();
      got["a.jpg"].shift();
      const r = comparePersonasParity(tied, got, sizes);
      expect(r.ok).toBe(false);
    });

    it("fails a face nowhere near any reference face", () => {
      const got = tiedSame();
      got["a.jpg"][1] = toFace([10, 10, 50, 50], unit(5));
      const r = comparePersonasParity(tied, got, sizes);
      expect(r.ok).toBe(false);
    });
  });

  it("the committed reference lists crew.jpg #0's tied rival that iOS ImageIO picks", () => {
    const real = require("../../../modules/dosya-face-reader/parity/reference.json") as ParityReference;
    const crew = real.files["crew.jpg"];
    // What the iOS 26 simulator's native reader returned for this face (task 15).
    const ios: [number, number, number, number] = [1209.3, 318.3, 140.2, 179.2];
    const near = (crew.faces[0].alts ?? []).filter((a) => a.box.every((v, k) => Math.abs(v - ios[k]) < 0.5));
    expect(near).toHaveLength(1);
    expect(crew.faces[0].score - near[0].score).toBeLessThan(real.tieMargin!);
  });

  describe("the committed reference", () => {
    const real = require("../../../modules/dosya-face-reader/parity/reference.json") as ParityReference;
    const clone = (): ParityReference => JSON.parse(JSON.stringify(real));
    const sizesOf = (ref: ParityReference) => ref.files;
    /** A reader that returns `pick(face)` for each reference face. */
    const reader = (ref: ParityReference, pick: (f: ParityReference["files"][string]["faces"][number]) => { box: number[]; sig: number[] }) => {
      const got: Record<string, ReadFace[]> = {};
      for (const [name, file] of Object.entries(ref.files)) {
        got[name] = file.faces.map((f) => {
          const c = pick(f);
          return {
            box: { x: c.box[0] / file.width, y: c.box[1] / file.height, w: c.box[2] / file.width, h: c.box[3] / file.height },
            sig: Float32Array.from(c.sig),
            score: 0.9,
          };
        });
      }
      return got;
    };
    const shifted = (f: { box: number[]; sig: number[] }) => ({ box: [f.box[0] + 3, f.box[1], f.box[2], f.box[3]], sig: f.sig });

    it("has a tie margin and at least one face with a rival", () => {
      expect(real.tieMargin).toBe(0.001);
      expect(Object.values(real.files).some((f) => f.faces.some((x) => (x.alts ?? []).length > 0))).toBe(true);
    });

    it("passes a reader that returns each face's top rival where one exists and the winner elsewhere", () => {
      const r = comparePersonasParity(real, reader(real, (f) => f.alts?.[0] ?? f), sizesOf(real));
      expect(r.ok).toBe(true);
    });

    it("fails a reader that returns the rivals but shifts every other winner by 3 px", () => {
      const r = comparePersonasParity(real, reader(real, (f) => f.alts?.[0] ?? shifted(f)), sizesOf(real));
      expect(r.ok).toBe(false);
      const untied = Object.values(real.files).reduce((n, f) => n + f.faces.filter((x) => !(x.alts ?? []).length).length, 0);
      expect(r.lines.filter((l) => l.endsWith("FAIL"))).toHaveLength(untied);
    });

    it("fails the top rival of any face whose gap is above the margin", () => {
      const ref = clone();
      const [name, file] = Object.entries(ref.files).find(([, f]) => f.faces.some((x) => x.alts?.length))!;
      const i = file.faces.findIndex((x) => x.alts?.length);
      // The same rival, scored just outside the margin: no longer a tie.
      file.faces[i].alts![0].score = file.faces[i].score - ref.tieMargin! - 1e-5;
      const r = comparePersonasParity(ref, reader(ref, (f) => f.alts?.[0] ?? f), sizesOf(ref));
      expect(r.ok).toBe(false);
      expect(r.lines.filter((l) => l.endsWith("FAIL")).every((l) => l.startsWith(`${name} #${i} `))).toBe(true);
    });

    it("does not excuse a missing face that is flagged optional but scores above the floor margin", () => {
      const ref = clone();
      const file = ref.files["exp73.jpg"];
      file.faces[0].optional = true;
      const got = reader(ref, (f) => f);
      got["exp73.jpg"].shift();
      expect(comparePersonasParity(ref, got, sizesOf(ref)).ok).toBe(false);
    });
  });
});
