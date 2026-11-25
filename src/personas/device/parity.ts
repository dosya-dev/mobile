// The Personas reader parity check: the native reader's output on three fixed
// photos against the web reader's reference (modules/dosya-face-reader/parity).
// Boxes in the reference are pixels; the native reader returns fractions.
//
// Near ties: the phone's decoder rounds a few pixels differently from the
// reference's (libjpeg-turbo via sharp), which moves YuNet scores by ~1e-4.
// Where the web winner beat an overlapping candidate by less than the
// reference's tieMargin, NMS may keep that candidate on the phone instead, so
// a face may match its `alts` (each checked with the same box and cosine bar).
// A face within tieMargin of the score floor is `optional`: it may be absent.
// See apps/web/src/lib/personas-device/ort/mobile-parity-reference.test.ts.
import type { ReadFace } from "@dosya-dev/personas-engine";
import { MIN_SCORE } from "./ort/pipeline";

export interface ParityCandidate { box: [number, number, number, number]; score: number; sig: number[] }
export interface ParityFace extends ParityCandidate {
  /** Overlapping candidates that could win NMS instead (near tie). */
  alts?: ParityCandidate[];
  /** Score within the tie margin of the floor: another decoder may not find it. */
  optional?: boolean;
}
export interface ParityReference {
  version: number;
  tieMargin?: number;
  files: Record<string, { width: number; height: number; faces: ParityFace[] }>;
}

export const MAX_BOX_PX = 2;
export const MIN_COSINE = 0.999;

type Px = [number, number, number, number];

function iou(a: Px, b: Px): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function comparePersonasParity(
  reference: ParityReference,
  got: Record<string, ReadFace[]>,
  sizes: Record<string, { width: number; height: number }>,
): { ok: boolean; lines: string[] } {
  let ok = true;
  const lines: string[] = [];
  for (const name of Object.keys(reference.files)) {
    const want = reference.files[name].faces;
    const faces = got[name];
    if (!faces) {
      ok = false;
      lines.push(`${name}: FAIL no result`);
      continue;
    }
    // The scores decide: a rival counts only within tieMargin of its winner, and
    // a face may be absent only within tieMargin of the floor.
    const margin = reference.tieMargin ?? 0;
    const optional = want.map((w) => w.optional === true && w.score - MIN_SCORE <= margin);
    const required = optional.filter((o) => !o).length;
    if (faces.length < required || faces.length > want.length) {
      ok = false;
      const expected = required === want.length ? `${want.length}` : `${required}-${want.length}`;
      lines.push(`${name}: FAIL expected ${expected} faces, got ${faces.length}`);
      continue;
    }
    const { width, height } = sizes[name] ?? reference.files[name];
    const px: Px[] = faces.map((f) => [f.box.x * width, f.box.y * height, f.box.w * width, f.box.h * height]);
    // The winner first, then its near-tie rivals.
    const options = want.map((w) => [w, ...(w.alts ?? []).filter((a) => w.score - a.score <= margin)]);
    // Greedy pairing: highest IoU pair first (against the winner or any rival), each face used once.
    const pairs: { r: number; g: number; v: number }[] = [];
    for (let r = 0; r < want.length; r++) {
      for (let g = 0; g < px.length; g++) pairs.push({ r, g, v: Math.max(...options[r].map((c) => iou(c.box, px[g]))) });
    }
    pairs.sort((a, b) => b.v - a.v);
    const match = new Map<number, number>();
    const used = new Set<number>();
    for (const p of pairs) {
      if (p.v <= 0 || match.has(p.r) || used.has(p.g)) continue;
      match.set(p.r, p.g);
      used.add(p.g);
    }
    // Left, top, right and bottom edges.
    const edges = (box: Px) => [box[0], box[1], box[0] + box[2], box[1] + box[3]];
    for (let r = 0; r < want.length; r++) {
      const g = match.get(r);
      if (g === undefined) {
        if (optional[r]) {
          lines.push(`${name} #${r} absent (optional: score at the floor)`);
        } else {
          ok = false;
          lines.push(`${name} #${r} FAIL not found`);
        }
        continue;
      }
      const ge = edges(px[g]);
      // The candidate that passes, the winner preferred; else the closest one, to report.
      let best: { k: number; worst: number; cos: number; pass: boolean } | null = null;
      options[r].forEach((c, k) => {
        const we = edges(c.box);
        let worst = 0;
        for (let e = 0; e < 4; e++) worst = Math.max(worst, Math.abs(we[e] - ge[e]));
        const cos = cosine(c.sig, faces[g].sig);
        const pass = worst <= MAX_BOX_PX && cos >= MIN_COSINE;
        if (!best || (pass && !best.pass) || (pass === best.pass && !best.pass && worst < best.worst)) best = { k, worst, cos, pass };
      });
      const b = best!;
      if (!b.pass) ok = false;
      const tie = b.pass && b.k > 0 ? ` (near tie: rival ${b.k})` : "";
      lines.push(`${name} #${r} box ${b.worst.toFixed(2)} px cos ${b.cos.toFixed(4)}${tie}${b.pass ? "" : " FAIL"}`);
    }
    for (let g = 0; g < px.length; g++) {
      if (used.has(g)) continue;
      ok = false;
      lines.push(`${name}: FAIL face at ${px[g].map((v) => v.toFixed(0)).join(",")} matches no reference face`);
    }
  }
  return { ok, lines };
}
