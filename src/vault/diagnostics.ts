import {
  runBackendSelfTest,
  getCryptoBackend,
  chunkerVectorBytes,
  CHUNKER_VECTORS,
  CHUNKER_GEAR_SHA256_HEX,
  encryptFileStreaming,
  chunkBoundaries as tsChunkBoundaries,
  aeadEncrypt,
  aeadDecrypt,
  sha256,
} from "@dosya-dev/e2ee-core";
import type { ChunkBoundary, ChunkParams } from "../../modules/dosya-vault-chunker";
import { DEFAULT_CHUNK_PARAMS } from "../../modules/dosya-vault-chunker";
import { ensureVaultRuntime } from "./runtime";

/**
 * The phase-2 device gate (spec §10): proves the native crypto backend and
 * the native chunker on THIS phone before any Vault UI exists. Pure
 * orchestration over injected file and chunker dependencies so it runs under
 * jest with Node's fs and the chunker's manual mock; app/vault-diagnostics.tsx
 * supplies the expo-file-system adapter and the real module.
 *
 * No network, no user data: every input is generated, every temp file is
 * removed, nothing is persisted.
 */
export type DiagnosticsFs = {
  writeTemp(name: string, bytes: Uint8Array): Promise<string>;
  remove(uri: string): Promise<void>;
};
export type DiagnosticsChunker = {
  chunkBoundaries(uri: string, params: ChunkParams): Promise<ChunkBoundary[]>;
  gearTableSha256Hex(): string;
};
export type DiagnosticsReport = {
  backendName: string;
  selfTest: { ok: boolean; total: number; failures: string[] };
  binaryAd: { ok: boolean; detail: string };
  chunker: { ok: boolean; checkedSizes: number[]; detail: string };
  timings: { argon2InteractiveMs: number; encryptMBps: number; sha256MBps: number };
};

const MiB = 1024 * 1024;
const DEFAULT_MAX_VECTOR = 10 * MiB;
const TIMING_BYTES = 8 * MiB;

async function checkBinaryAd(): Promise<{ ok: boolean; detail: string }> {
  try {
    const key = new Uint8Array(32).fill(3);
    const ad = new Uint8Array(256).map((_, i) => i);
    const plain = new TextEncoder().encode("binary-ad-probe");
    const { nonce, ciphertext } = await aeadEncrypt(key, plain, ad);
    const back = await aeadDecrypt(key, nonce, ciphertext, ad);
    if (new TextDecoder().decode(back) !== "binary-ad-probe") return { ok: false, detail: "round-trip changed the plaintext" };
    const bad = ad.slice();
    bad[200] ^= 1;
    try {
      await aeadDecrypt(key, nonce, ciphertext, bad);
      return { ok: false, detail: "decrypt accepted a modified associated data" };
    } catch {
      return { ok: true, detail: "256-byte AD round-trips; a one-byte change is rejected" };
    }
  } catch (err) {
    return { ok: false, detail: String((err as Error).message ?? err) };
  }
}

async function checkChunker(fs: DiagnosticsFs, chunker: DiagnosticsChunker, maxVectorSize: number): Promise<DiagnosticsReport["chunker"]> {
  const checkedSizes: number[] = [];
  let gear: string;
  try {
    gear = chunker.gearTableSha256Hex();
  } catch (err) {
    return { ok: false, checkedSizes, detail: `gear table unavailable: ${String((err as Error).message ?? err)}` };
  }
  if (gear !== CHUNKER_GEAR_SHA256_HEX) return { ok: false, checkedSizes, detail: `gear table hash ${gear} != ${CHUNKER_GEAR_SHA256_HEX}` };

  for (const v of CHUNKER_VECTORS) {
    if (v.size > maxVectorSize) continue;
    const uri = await fs.writeTemp(`vault-diag-${v.size}.bin`, chunkerVectorBytes(v.size));
    try {
      const got = await chunker.chunkBoundaries(uri, DEFAULT_CHUNK_PARAMS);
      const want = v.boundaries;
      const same = got.length === want.length && got.every((b, i) => b.offset === want[i]!.offset && b.size === want[i]!.size);
      if (!same) {
        return { ok: false, checkedSizes, detail: `size ${v.size}: native ${JSON.stringify(got.slice(0, 4))}... != frozen ${JSON.stringify(want.slice(0, 4))}...` };
      }
      checkedSizes.push(v.size);
    } catch (err) {
      return { ok: false, checkedSizes, detail: `size ${v.size}: ${String((err as Error).message ?? err)}` };
    } finally {
      await fs.remove(uri);
    }
  }
  return { ok: true, checkedSizes, detail: `${checkedSizes.length} vectors match` };
}

async function measure(now: () => number): Promise<DiagnosticsReport["timings"]> {
  const backend = await getCryptoBackend();
  const t0 = now();
  await backend.pwhash(32, new Uint8Array(32).fill(7), new Uint8Array(16).fill(1), backend.argon2Tiers.interactive.opslimit, backend.argon2Tiers.interactive.memlimit);
  const argon2InteractiveMs = now() - t0;

  const bytes = chunkerVectorBytes(TIMING_BYTES);
  const t1 = now();
  await sha256(bytes);
  const sha256MBps = (TIMING_BYTES / MiB) / Math.max(1e-3, (now() - t1) / 1000);

  const dek = new Uint8Array(32).fill(9);
  const t2 = now();
  await encryptFileStreaming({
    dek,
    dekId: "diag",
    fmt: 1,
    workspaceId: "diag",
    fileId: "diag",
    version: 1,
    source: { totalSize: bytes.length, boundaries: tsChunkBoundaries(bytes), read: async (o, s) => bytes.subarray(o, o + s) },
    sink: async () => {},
  });
  const encryptMBps = (TIMING_BYTES / MiB) / Math.max(1e-3, (now() - t2) / 1000);
  return { argon2InteractiveMs, encryptMBps, sha256MBps };
}

export async function runVaultDiagnostics(deps: {
  fs: DiagnosticsFs;
  chunker: DiagnosticsChunker;
  maxVectorSize?: number;
  now?: () => number;
}): Promise<DiagnosticsReport> {
  const now = deps.now ?? (() => Date.now());
  await ensureVaultRuntime();
  const backendName = (await getCryptoBackend()).name;

  const results = await runBackendSelfTest();
  const failures = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);
  const selfTest = { ok: failures.length === 0, total: results.length, failures };

  const binaryAd = await checkBinaryAd();
  const chunker = await checkChunker(deps.fs, deps.chunker, deps.maxVectorSize ?? DEFAULT_MAX_VECTOR);
  const timings = await measure(now);
  return { backendName, selfTest, binaryAd, chunker, timings };
}

/** The screen's lines, in order; Maestro asserts on the first three. */
export function summarize(r: DiagnosticsReport): string[] {
  return [
    `Self-test: ${r.selfTest.ok ? "PASS" : "FAIL"}`,
    `Chunker: ${r.chunker.ok ? "PASS" : "FAIL"}`,
    `Binary AD: ${r.binaryAd.ok ? "PASS" : "FAIL"}`,
    `Backend: ${r.backendName}`,
    `Self-test cases: ${r.selfTest.total}${r.selfTest.failures.length ? ` (failed: ${r.selfTest.failures.join("; ")})` : ""}`,
    `Chunker detail: ${r.chunker.detail}`,
    `Binary AD detail: ${r.binaryAd.detail}`,
    `Argon2id interactive: ${Math.round(r.timings.argon2InteractiveMs)} ms`,
    `SHA-256: ${r.timings.sha256MBps.toFixed(1)} MB/s`,
    `Chunk+hash+encrypt: ${r.timings.encryptMBps.toFixed(1)} MB/s`,
  ];
}
