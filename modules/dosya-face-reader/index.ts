import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Platform photo decode and file hash for the Personas face reader.
 *
 * `decodeImage` matches apps/web/src/lib/personas-device/ort/decode.ts: the
 * platform decoder, no EXIF orientation applied, 8-bit sRGB RGBA out, the long
 * side capped at 1600 by area averaging, and a photo above 36,000,000 pixels
 * refused as unsupported (it would need 144 MB+ decoded). Face boxes are
 * stored as fractions of the encoded image, so a rotated decode would put
 * every box in the wrong place.
 *
 * The work runs off the JS thread; bytes cross JSI as typed arrays.
 */
export interface DecodedImage { width: number; height: number; rgba: Uint8Array }

export type FaceReaderErrorCode = "UNSUPPORTED" | "FAILED" | "NO_MODELS" | "EUNAVAILABLE";

export class FaceReaderError extends Error {
  readonly code: FaceReaderErrorCode;
  constructor(code: FaceReaderErrorCode, message: string) {
    super(message);
    this.name = "FaceReaderError";
    this.code = code;
  }
}

/** Long side of the image the reader works on (decode.ts MAX_SIDE). */
export const MAX_SIDE = 1600;
/** Largest photo, in pixels, that is decoded (decode.ts MAX_DECODE_PIXELS). */
export const MAX_DECODE_PIXELS = 36_000_000;

interface NativeFaceReader {
  decode(bytes: Uint8Array, maxSide: number, maxPixels: number): Promise<DecodedImage>;
  sha256File(path: string): Promise<string>;
  /** iOS only (Android has no such flag; its files dir is fine). */
  excludeFromBackup?(path: string): Promise<void>;
  loadModels(detectorPath: string, embedderPath: string): Promise<void>;
  detect(input: Uint8Array): Promise<Record<string, Uint8Array>>;
  embed(input: Uint8Array, n: number): Promise<Uint8Array>;
  unloadModels(): Promise<void>;
}

const native = requireOptionalNativeModule<NativeFaceReader>("DosyaFaceReader");

export function isNativeFaceReaderAvailable(): boolean {
  return native !== null;
}

function fromNativeError(err: unknown): FaceReaderError {
  const code = (err as { code?: string })?.code ?? "";
  const message = (err as { message?: string })?.message ?? String(err);
  if (code === "ERR_UNSUPPORTED") return new FaceReaderError("UNSUPPORTED", message);
  if (code === "ERR_NO_MODELS") return new FaceReaderError("NO_MODELS", message);
  return new FaceReaderError("FAILED", message);
}

function requireNative(): NativeFaceReader {
  if (!native) throw new FaceReaderError("EUNAVAILABLE", "face reader: native module unavailable (Expo Go, or a build without dosya-face-reader)");
  return native;
}

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  const n = requireNative();
  try {
    return await n.decode(bytes, MAX_SIDE, MAX_DECODE_PIXELS);
  } catch (err) {
    throw fromNativeError(err);
  }
}

/** SHA-256 of the file at `path` (a plain path, not a URI), lowercase hex. */
export async function sha256File(path: string): Promise<string> {
  const n = requireNative();
  try {
    return (await n.sha256File(path)).toLowerCase();
  } catch (err) {
    throw fromNativeError(err);
  }
}

/**
 * Keep the file or folder at `path` (a plain path) out of iCloud and device
 * backups (iOS URLResourceValues.isExcludedFromBackup). A no-op where the
 * native side has no such call (Android, Expo Go).
 */
export async function excludeFromBackup(path: string): Promise<void> {
  if (!native || typeof native.excludeFromBackup !== "function") return;
  try {
    await native.excludeFromBackup(path);
  } catch (err) {
    throw fromNativeError(err);
  }
}

/**
 * ONNX Runtime 1.29.0 sessions for YuNet (detector) and SFace (embedder), CPU
 * execution provider, graph optimisation "all", 2 intra-op threads; mirrors
 * apps/web/src/lib/personas-device/ort/models.ts. One session pair per
 * process. Tensors cross the bridge as the bytes of a Float32Array.
 */
// Keep in step with yunetOutputs in ios/Sessions.swift and YUNET_OUTPUTS in android/.../Sessions.kt.
export const YUNET_OUTPUTS = ["cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32"] as const;
/** Floats in the YuNet input, [1,3,320,320]. */
export const DETECT_INPUT_FLOATS = 3 * 320 * 320;
/** Floats per face in the SFace input, [n,3,112,112]. */
export const EMBED_INPUT_FLOATS = 3 * 112 * 112;
/** Floats per SFace embedding. */
export const EMBED_DIM = 128;

const bytesOf = (f: Float32Array) => new Uint8Array(f.buffer, f.byteOffset, f.byteLength);

function floatsOf(b: Uint8Array): Float32Array {
  if (b.byteLength % 4 !== 0) throw new FaceReaderError("FAILED", `face reader: tensor of ${b.byteLength} bytes is not float32`);
  // Copy: the native buffer need not be 4-byte aligned.
  return new Float32Array(b.slice().buffer);
}

/** Load both models; idempotent for the same two paths (plain paths, not URIs). */
export async function loadModels(detectorPath: string, embedderPath: string): Promise<void> {
  const n = requireNative();
  try {
    await n.loadModels(detectorPath, embedderPath);
  } catch (err) {
    throw fromNativeError(err);
  }
}

/** YuNet on a [1,3,320,320] float32 input; the 12 outputs by YUNET_OUTPUTS name. */
export async function detect(input: Float32Array): Promise<Record<string, Float32Array>> {
  const n = requireNative();
  if (input.length !== DETECT_INPUT_FLOATS) throw new FaceReaderError("FAILED", `face reader: detect needs ${DETECT_INPUT_FLOATS} floats, got ${input.length}`);
  try {
    const raw = await n.detect(bytesOf(input));
    const out: Record<string, Float32Array> = {};
    for (const k of Object.keys(raw)) out[k] = floatsOf(raw[k]);
    return out;
  } catch (err) {
    if (err instanceof FaceReaderError) throw err;
    throw fromNativeError(err);
  }
}

/** SFace on [n,3,112,112] float32; returns n*128 floats. */
export async function embed(input: Float32Array, count: number): Promise<Float32Array> {
  const n = requireNative();
  if (!Number.isInteger(count) || count < 1) throw new FaceReaderError("FAILED", `face reader: embed needs a whole face count of at least 1, got ${count}`);
  if (input.length !== count * EMBED_INPUT_FLOATS) throw new FaceReaderError("FAILED", `face reader: embed of ${count} needs ${count * EMBED_INPUT_FLOATS} floats, got ${input.length}`);
  try {
    const out = floatsOf(await n.embed(bytesOf(input), count));
    if (out.length !== count * EMBED_DIM) throw new FaceReaderError("FAILED", `face reader: embed returned ${out.length} floats, expected ${count * EMBED_DIM}`);
    return out;
  } catch (err) {
    if (err instanceof FaceReaderError) throw err;
    throw fromNativeError(err);
  }
}

/** Release both sessions. Safe when nothing is loaded. */
export async function unloadModels(): Promise<void> {
  const n = requireNative();
  try {
    await n.unloadModels();
  } catch (err) {
    throw fromNativeError(err);
  }
}
