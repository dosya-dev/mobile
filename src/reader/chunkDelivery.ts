import * as FileSystem from "expo-file-system/legacy";
import { jsChunk, jsOpen } from "./bridge";

export const CHUNK_BYTES = 2 * 1024 * 1024;

export function chunkOffsets(total: number, chunk = CHUNK_BYTES): Array<{ position: number; length: number }> {
  const out: Array<{ position: number; length: number }> = [];
  for (let position = 0; position < total; position += chunk) {
    out.push({ position, length: Math.min(chunk, total - position) });
  }
  return out;
}

const defaultReadChunk = (uri: string, position: number, length: number) =>
  FileSystem.readAsStringAsync(uri, { encoding: "base64", position, length });

/** Stream the cached book into the WebView as ordered base64 chunks, then open. */
export async function deliverBook(opts: {
  uri: string;
  size: number;
  inject: (js: string) => void;
  readChunk?: (uri: string, position: number, length: number) => Promise<string>;
  onProgress?: (fraction: number) => void;
  chunk?: number;
}): Promise<void> {
  const read = opts.readChunk ?? defaultReadChunk;
  const offsets = chunkOffsets(opts.size, opts.chunk);
  let done = 0;
  for (const { position, length } of offsets) {
    const b64 = await read(opts.uri, position, length);
    opts.inject(jsChunk(b64));
    done += length;
    opts.onProgress?.(opts.size === 0 ? 1 : done / opts.size);
  }
  opts.onProgress?.(1);
  opts.inject(jsOpen());
}
