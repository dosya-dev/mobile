import { File } from "expo-file-system";
import type { PlainChunkSource } from "@dosya-dev/e2ee-core";
import { chunkBoundaries as nativeChunkBoundaries, filePathFromUri, DEFAULT_CHUNK_PARAMS, ChunkerError } from "../../modules/dosya-vault-chunker";

/**
 * A `PlainChunkSource` over a file on disk: boundaries from the native
 * chunker (no byte crosses the bridge for that), bytes read one chunk at a
 * time through a file handle. Every read carries an explicit offset, so a
 * reader only needs to honour it; the engine reads in order anyway.
 */
export type ByteReader = { size: number; read(offset: number, length: number): Promise<Uint8Array>; close(): void };
export type OpenReader = (fileUri: string) => Promise<ByteReader>;

/** expo-file-system 19: `File.open()` gives a handle with `readBytes` and a settable `offset`. */
export const expoOpenReader: OpenReader = async (fileUri) => {
  const file = new File(fileUri);
  const handle = file.open();
  return {
    size: handle.size ?? file.size ?? 0,
    async read(offset, length) {
      if (handle.offset !== offset) handle.offset = offset;
      return handle.readBytes(length);
    },
    close() { handle.close(); },
  };
};

export async function fileSourceFromUri(
  fileUri: string,
  opts: { openReader?: OpenReader; boundaries?: typeof nativeChunkBoundaries } = {},
): Promise<PlainChunkSource & { close(): void }> {
  try {
    filePathFromUri(fileUri); // throws ChunkerError EINVAL for anything but file://
  } catch (err) {
    // `filePathFromUri` decodes the URI with `decodeURIComponent`, which
    // throws a bare `URIError` for a malformed percent-escape (e.g.
    // "file:///a%"). Everyone downstream expects a `ChunkerError`.
    if (err instanceof URIError) throw new ChunkerError("EINVAL", `chunker: malformed file URI: ${err.message}`);
    throw err;
  }
  const boundaries = await (opts.boundaries ?? nativeChunkBoundaries)(fileUri, DEFAULT_CHUNK_PARAMS);
  const reader = await (opts.openReader ?? expoOpenReader)(fileUri);
  let closed = false;
  return {
    totalSize: reader.size,
    boundaries,
    async read(offset, size) {
      const got = await reader.read(offset, size);
      if (got.length !== size) throw new Error(`vault: short read at ${offset}: got ${got.length} of ${size} bytes`);
      return got;
    },
    // Idempotent: a second call must not hit a closed fd/handle again (the
    // node test reader throws EBADF on a repeat `closeSync`; a real handle
    // may do the same on device).
    close() {
      if (closed) return;
      closed = true;
      reader.close();
    },
  };
}
