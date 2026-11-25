// Jest stand-in for the native face reader. decodeImage is a scriptable
// jest.fn (tests set the pixels they need); sha256File hashes a real file with
// Node's crypto, like the native one.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const actual = jest.requireActual("../index") as typeof import("../index");

export const FaceReaderError = actual.FaceReaderError;
export const MAX_SIDE = actual.MAX_SIDE;
export const MAX_DECODE_PIXELS = actual.MAX_DECODE_PIXELS;
export const YUNET_OUTPUTS = actual.YUNET_OUTPUTS;
export const DETECT_INPUT_FLOATS = actual.DETECT_INPUT_FLOATS;
export const EMBED_INPUT_FLOATS = actual.EMBED_INPUT_FLOATS;
export const EMBED_DIM = actual.EMBED_DIM;
export type { DecodedImage, FaceReaderErrorCode } from "../index";

export function isNativeFaceReaderAvailable(): boolean {
  return true;
}

export const decodeImage = jest.fn(async (_bytes: Uint8Array) => {
  return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
});

export async function sha256File(path: string): Promise<string> {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (err) {
    throw new FaceReaderError("FAILED", `face reader mock: ${String((err as Error).message)}`);
  }
}

export const excludeFromBackup = jest.fn(async (_path: string): Promise<void> => undefined);

// Scriptable like decodeImage. Defaults: no models loaded, so detect/embed
// reject NO_MODELS until a test supplies an implementation.
export const loadModels = jest.fn(async (_detectorPath: string, _embedderPath: string): Promise<void> => undefined);
export const detect = jest.fn(async (_input: Float32Array): Promise<Record<string, Float32Array>> => {
  throw new FaceReaderError("NO_MODELS", "face reader mock: models not loaded");
});
export const embed = jest.fn(async (_input: Float32Array, _n: number): Promise<Float32Array> => {
  throw new FaceReaderError("NO_MODELS", "face reader mock: models not loaded");
});
export const unloadModels = jest.fn(async (): Promise<void> => undefined);
