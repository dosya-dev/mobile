/**
 * Android Motion Photos (Pixel, Samsung): a JPEG with an MP4 appended after
 * the image. The JPEG's XMP packet says how long that tail is, in one of two
 * dialects. This module only parses; copying the tail out is the native
 * module's job (modules/dosya-media-extras, `copyTail`).
 *
 * Returns the number of bytes, counted from the END of the file, where the
 * video begins - or null for anything that is not a Motion Photo, on any
 * parse failure, or for an offset that cannot be right.
 */
export const MOTION_PHOTO_HEADER_BYTES = 256 * 1024;

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

export function parseMotionPhotoOffset(header: Uint8Array): number | null {
  if (header.length < 4 || header[0] !== 0xff || header[1] !== 0xd8) return null;
  const xmp = findXmpPacket(header);
  if (!xmp) return null;
  const legacy = /GCamera:MicroVideoOffset="(\d+)"/.exec(xmp);
  if (legacy) return positive(Number(legacy[1]));
  const items = xmp.match(/<Container:Item\b[^>]*>/g) ?? [];
  for (const item of items) {
    if (!/Item:Semantic="MotionPhoto"/.test(item)) continue;
    const len = /Item:Length="(\d+)"/.exec(item);
    if (!len) return null;
    const pad = /Item:Padding="(\d+)"/.exec(item);
    return positive(Number(len[1]) + (pad ? Number(pad[1]) : 0));
  }
  return null;
}

function positive(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Walk JPEG segments from SOI until the first APP1 that carries the XMP namespace. */
function findXmpPacket(bytes: Uint8Array): string | null {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end: no XMP ahead
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    const start = i + 4;
    const end = i + 2 + len;
    if (end > bytes.length) return null; // truncated inside this segment
    if (marker === 0xe1 && end - start > XMP_NS.length && ascii(bytes, start, start + XMP_NS.length) === XMP_NS) {
      return ascii(bytes, start + XMP_NS.length, end);
    }
    i = end;
  }
  return null;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let k = from; k < to; k++) s += String.fromCharCode(bytes[k]);
  return s;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Hermes has no atob in every runtime we target; expo-file-system hands base64 back. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]), b = i + 1 < clean.length ? B64.indexOf(clean[i + 1]) : -1;
    if (b < 0) break;
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.slice(0, o);
}
