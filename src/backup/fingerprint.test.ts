const reads: { position: number; length: number }[] = [];
jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  readAsStringAsync: jest.fn(async (_uri: string, opts: { position: number; length: number }) => {
    reads.push({ position: opts.position, length: opts.length });
    return `chunk@${opts.position}`; // deterministic fake chunk
  }),
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async (_alg: string, data: string) => `sha(${data})`),
}));

import { computeFingerprint } from "./fingerprint";

beforeEach(() => { reads.length = 0; });

describe("computeFingerprint", () => {
  it("reads head + tail and hashes size + both chunks", async () => {
    const fp = await computeFingerprint("file://x", 1_000_000);
    // head at 0, tail near the end
    expect(reads[0].position).toBe(0);
    expect(reads[1].position).toBe(1_000_000 - 65536);
    expect(fp).toBe("sha(1000000:chunk@0:chunk@934464)");
  });
  it("handles tiny files (tail position clamped to 0)", async () => {
    const fp = await computeFingerprint("file://x", 10);
    expect(reads[1].position).toBe(0);
    expect(fp).toContain("10:");
  });
});
