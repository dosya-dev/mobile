import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * Content-defined chunk boundaries computed natively over a file.
 *
 * A port of e2ee-core's `chunkBoundaries` (packages/e2ee-core/src/chunker.ts,
 * FastCDC with a fixed gear table) to Swift and Kotlin. It exists because the
 * TypeScript loop runs at ~6 MB/s on Hermes (no JIT) and ~120 MB/s natively:
 * a 100 MB video would otherwise spend 15 s of CPU before any crypto. The
 * module reads the file itself and returns offsets only - no file byte ever
 * crosses into JavaScript for boundary detection, and it never sees a key.
 *
 * Both ports are pinned to the same frozen vectors as the TypeScript
 * (`CHUNKER_VECTORS`) by the diagnostics screen, and each checks its copied
 * gear table against `CHUNKER_GEAR_SHA256_HEX`.
 *
 * Only `file://` URIs are accepted: the pickers used by the Vault copy into
 * the cache first (`copyToCacheDirectory: true`), and a `content://` stream
 * cannot be memory-mapped.
 */
export type ChunkParams = { min: number; avg: number; max: number };
export type ChunkBoundary = { offset: number; size: number };

export const DEFAULT_CHUNK_PARAMS: ChunkParams = { min: 256 * 1024, avg: 1024 * 1024, max: 4 * 1024 * 1024 };

export type ChunkerErrorCode = "ENOENT" | "EACCES" | "EINVAL" | "EUNAVAILABLE";

export class ChunkerError extends Error {
  readonly code: ChunkerErrorCode;
  constructor(code: ChunkerErrorCode, message: string) {
    super(message);
    this.name = "ChunkerError";
    this.code = code;
  }
}

interface NativeChunker {
  chunkBoundaries(path: string, min: number, avg: number, max: number): Promise<ChunkBoundary[]>;
  gearTableSha256Hex(): string;
}

const native = requireOptionalNativeModule<NativeChunker>("DosyaVaultChunker");

export function isNativeChunkerAvailable(): boolean {
  return native !== null;
}

/** `file:///a/b.bin` → `/a/b.bin`; anything else is EINVAL. */
export function filePathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) throw new ChunkerError("EINVAL", `chunker: only file:// URIs are supported, got "${uri.slice(0, 32)}"`);
  const path = decodeURIComponent(uri.slice("file://".length));
  if (!path.startsWith("/")) throw new ChunkerError("EINVAL", "chunker: file URI must be absolute");
  return path;
}

function fromNativeError(err: unknown): ChunkerError {
  const code = (err as { code?: string })?.code ?? "";
  const message = (err as { message?: string })?.message ?? String(err);
  if (code === "ENOENT" || code === "EACCES" || code === "EINVAL") return new ChunkerError(code, message);
  return new ChunkerError("EINVAL", message);
}

export async function chunkBoundaries(fileUri: string, params: ChunkParams = DEFAULT_CHUNK_PARAMS): Promise<ChunkBoundary[]> {
  const path = filePathFromUri(fileUri);
  if (!native) throw new ChunkerError("EUNAVAILABLE", "chunker: native module unavailable (Expo Go, or a build without dosya-vault-chunker)");
  if (!(params.min > 0 && params.avg >= params.min && params.max >= params.avg)) {
    throw new ChunkerError("EINVAL", "chunker: params must satisfy 0 < min <= avg <= max");
  }
  try {
    return await native.chunkBoundaries(path, params.min, params.avg, params.max);
  } catch (err) {
    throw fromNativeError(err);
  }
}

export function gearTableSha256Hex(): string {
  if (!native) throw new ChunkerError("EUNAVAILABLE", "chunker: native module unavailable");
  return native.gearTableSha256Hex();
}
