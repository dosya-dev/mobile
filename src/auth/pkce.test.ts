/**
 * The encoding contract with apps/api/src/lib/pkce.ts. Both sides produce
 * UNPADDED base64url, and the server's challenge regex is
 * /^[A-Za-z0-9\-_]{43}$/ - so a stray "=", "+" or "/" here does not degrade
 * the binding, it makes every OAuth sign-in fail to redeem.
 */
let mockByteSeed = 0;

jest.mock("expo-crypto", () => ({
  // Deterministic, and deliberately full of bytes whose base64 alphabet lands
  // on "+" and "/" before the URL-safe swap - the exact characters that must
  // not survive.
  getRandomBytes: jest.fn((n: number) =>
    Uint8Array.from({ length: n }, (_, i) => (mockByteSeed + i * 7 + 250) % 256),
  ),
  digestStringAsync: jest.fn(async () => "q83v/+7dzLuqmYh3ZlVEMyIRAP/+7dzLuqmYh3ZlVEM="),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
}));

import * as Crypto from "expo-crypto";
import { createPkcePair, toBase64Url } from "./pkce";

const URL_SAFE = /^[A-Za-z0-9\-_]+$/;

/**
 * The encoder is hand-rolled because React Native has no `btoa` - and Node
 * does, so a `btoa` implementation would have passed this whole file and then
 * thrown on a device. Node's Buffer is the independent oracle it is checked
 * against, at every input length remainder so the two tail branches are real.
 */
describe("base64url encoding", () => {
  it("agrees with Node's Buffer at every remainder", () => {
    for (let length = 0; length <= 34; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 211) % 256);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  it("emits no padding and no non-url-safe characters", () => {
    // 0xFF/0xFE/0xFD encode to the "+" and "/" of standard base64.
    const bytes = Uint8Array.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);
    const encoded = toBase64Url(bytes);
    expect(encoded).toMatch(URL_SAFE);
    expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
  });
});

beforeEach(() => {
  mockByteSeed = 0;
  (Crypto.digestStringAsync as jest.Mock).mockClear();
});

it("produces a 43-character verifier - RFC 7636's minimum, from 32 bytes", async () => {
  const { verifier } = await createPkcePair();
  expect(verifier).toHaveLength(43);
  expect(verifier).toMatch(URL_SAFE);
});

it("emits url-safe, unpadded values the server's regexes accept", async () => {
  const { verifier, challenge, nonce } = await createPkcePair();
  for (const value of [verifier, challenge, nonce]) {
    expect(value).toMatch(URL_SAFE);
    expect(value).not.toContain("=");
    expect(value).not.toContain("+");
    expect(value).not.toContain("/");
  }
  // 43 chars is exactly what the server's challenge pattern demands.
  expect(challenge).toHaveLength(43);
});

it("derives the challenge from the verifier with SHA-256", async () => {
  const { verifier } = await createPkcePair();
  expect(Crypto.digestStringAsync).toHaveBeenCalledWith(
    "SHA-256",
    verifier,
    { encoding: "base64" },
  );
});

it("gives the nonce its own entropy rather than reusing the verifier", async () => {
  const { verifier, nonce } = await createPkcePair();
  expect(nonce).not.toBe(verifier);
  expect(nonce.length).toBeLessThan(verifier.length);
});

it("does not repeat itself across sign-ins", async () => {
  const first = await createPkcePair();
  mockByteSeed = 99;
  const second = await createPkcePair();
  expect(second.verifier).not.toBe(first.verifier);
  expect(second.nonce).not.toBe(first.nonce);
});
