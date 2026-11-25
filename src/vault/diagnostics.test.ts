import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { CHUNKER_GEAR_SHA256_HEX } from "@dosya-dev/e2ee-core";
import { runVaultDiagnostics, summarize, type DiagnosticsFs, type DiagnosticsChunker } from "./diagnostics";

jest.mock("../../modules/dosya-vault-chunker");
import * as chunkerMock from "../../modules/dosya-vault-chunker";

function nodeFs(dir: string): DiagnosticsFs {
  return {
    async writeTemp(name, bytes) { const p = join(dir, name); writeFileSync(p, bytes); return pathToFileURL(p).href; },
    async remove(uri) { unlinkSync(fileURLToPath(uri)); },
  };
}

describe("runVaultDiagnostics", () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "vault-diag-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports PASS for the self-test, binary AD and the chunker against the frozen vectors", async () => {
    const report = await runVaultDiagnostics({ fs: nodeFs(dir), chunker: chunkerMock, maxVectorSize: 4 * 1024 * 1024 + 1 });
    expect(report.backendName).toBe("react-native-libsodium");
    expect(report.selfTest.failures).toEqual([]);
    expect(report.selfTest.ok).toBe(true);
    expect(report.selfTest.total).toBeGreaterThan(20);
    expect(report.binaryAd.ok).toBe(true);
    expect(report.chunker.ok).toBe(true);
    expect(report.chunker.checkedSizes).toEqual([0, 1, 255 * 1024, 256 * 1024, 1024 * 1024 + 1, 4 * 1024 * 1024, 4 * 1024 * 1024 + 1]);
    expect(report.timings.argon2InteractiveMs).toBeGreaterThan(0);
    expect(report.timings.encryptMBps).toBeGreaterThan(0);
    expect(report.timings.sha256MBps).toBeGreaterThan(0);
    const lines = summarize(report);
    expect(lines[0]).toBe("Self-test: PASS");
    expect(lines).toContain("Chunker: PASS");
    expect(lines).toContain("Binary AD: PASS");
    expect(lines.some((l) => l.startsWith("Backend: react-native-libsodium"))).toBe(true);
  });

  it("fails the chunker check, naming the size, when a port disagrees with the frozen boundaries", async () => {
    const lying: DiagnosticsChunker = {
      gearTableSha256Hex: () => CHUNKER_GEAR_SHA256_HEX,
      chunkBoundaries: async (uri, params) => {
        const real = await chunkerMock.chunkBoundaries(uri, params);
        return real.length > 1 ? [{ offset: 0, size: real[0].size + real[1].size }, ...real.slice(2)] : real;
      },
    };
    // The 1 MiB+1 vector (and everything smaller) is a single chunk - no cut,
    // so a merge-first-two-chunks lie is a no-op there. Only the 4 MiB vector
    // (and larger) has a real cut for the lie to disturb, hence maxVectorSize
    // reaching past it and the mismatch naming that vector's size.
    const report = await runVaultDiagnostics({ fs: nodeFs(dir), chunker: lying, maxVectorSize: 4 * 1024 * 1024 + 1 });
    expect(report.chunker.ok).toBe(false);
    expect(report.chunker.detail).toContain("4194304");
    expect(summarize(report)).toContain("Chunker: FAIL");
  });

  it("fails the chunker check when the gear table hash differs, before writing any file", async () => {
    const fs: DiagnosticsFs = { writeTemp: jest.fn(async () => { throw new Error("must not write"); }), remove: jest.fn() };
    const report = await runVaultDiagnostics({ fs, chunker: { ...chunkerMock, gearTableSha256Hex: () => "00" } });
    expect(report.chunker.ok).toBe(false);
    expect(report.chunker.detail).toContain("gear table");
    expect(fs.writeTemp).not.toHaveBeenCalled();
  });

  it("removes every temp file it wrote, even when a comparison fails", async () => {
    const written: string[] = [];
    const removed: string[] = [];
    const base = nodeFs(dir);
    const fs: DiagnosticsFs = {
      writeTemp: async (n, b) => { const u = await base.writeTemp(n, b); written.push(u); return u; },
      remove: async (u) => { removed.push(u); await base.remove(u); },
    };
    await runVaultDiagnostics({ fs, chunker: chunkerMock, maxVectorSize: 256 * 1024 });
    expect(removed.sort()).toEqual(written.sort());
    expect(written.length).toBe(4);
  });
});
