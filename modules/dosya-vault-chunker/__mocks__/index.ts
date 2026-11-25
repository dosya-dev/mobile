// Jest stand-in for the native chunker: the TypeScript chunker from the
// vendored e2ee-core over a real file read with Node's fs. Same boundaries as
// the native ports (all three are pinned to CHUNKER_VECTORS), so streaming
// tests in src/vault stay byte-exact without a device.
import { readFileSync } from "node:fs";
import { chunkBoundaries as tsChunkBoundaries, CHUNKER_GEAR_SHA256_HEX } from "@dosya-dev/e2ee-core";

const actual = jest.requireActual("../index") as typeof import("../index");

export const DEFAULT_CHUNK_PARAMS = actual.DEFAULT_CHUNK_PARAMS;
export const ChunkerError = actual.ChunkerError;
export const filePathFromUri = actual.filePathFromUri;
export type { ChunkParams, ChunkBoundary, ChunkerErrorCode } from "../index";

export function isNativeChunkerAvailable(): boolean {
  return true;
}

export async function chunkBoundaries(fileUri: string, params = DEFAULT_CHUNK_PARAMS) {
  const path = filePathFromUri(fileUri);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    const code = (err as { code?: string }).code === "ENOENT" ? "ENOENT" : "EACCES";
    throw new ChunkerError(code, `chunker mock: ${String((err as Error).message)}`);
  }
  return tsChunkBoundaries(bytes, params);
}

export function gearTableSha256Hex(): string {
  return CHUNKER_GEAR_SHA256_HEX;
}
