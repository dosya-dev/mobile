import * as sodium from "react-native-libsodium";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const utf8 = (s: string) => new TextEncoder().encode(s);

// Frozen values from packages/e2ee-core/src/vectors-data.ts (never regenerated).
const AEAD_KEY = fromHex("0707070707070707070707070707070707070707070707070707070707070707");
const AEAD_NONCE = fromHex("090909090909090909090909090909090909090909090909");
const AEAD_EXPECTED = "c81781fe13d85412987361521c167f9fa1f991e15c8257c463ec83bfe6fe501c";
const ARGON_SALT = fromHex("11111111111111111111111111111111");
const ARGON_EXPECTED = "9df000103aca06f0b0c745a33d1451a60d24f3ce3263862f9ec148cc169a29a0";
const ED_SEED = fromHex("4242424242424242424242424242424242424242424242424242424242424242");
const ED_PUB = "2152f8d19b791d24453242e15f2eab6cb7cffa7b6a5ed30097960e069881db12";

describe("react-native-libsodium jest mock (libsodium-wrappers-sumo behind the native API)", () => {
  beforeAll(async () => { await sodium.ready; });

  it("AEAD with a Uint8Array associated data reproduces the interop vector", () => {
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8("vector-plaintext"), utf8("dosya.chunk.v1"), null, AEAD_NONCE, AEAD_KEY);
    expect(hex(ct)).toBe(AEAD_EXPECTED);
    const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, utf8("dosya.chunk.v1"), AEAD_NONCE, AEAD_KEY);
    expect(new TextDecoder().decode(pt)).toBe("vector-plaintext");
  });

  it("binary associated data (bytes 0x00..0xff) round-trips and a one-byte change is rejected", () => {
    const ad = new Uint8Array(256).map((_, i) => i);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8("m"), ad, null, AEAD_NONCE, AEAD_KEY);
    expect(new TextDecoder().decode(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, ad, AEAD_NONCE, AEAD_KEY))).toBe("m");
    const bad = ad.slice(); bad[200] ^= 1;
    expect(() => sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, bad, AEAD_NONCE, AEAD_KEY)).toThrow();
  });

  it("Argon2id interactive reproduces the interop vector and exposes libsodium's tier constants", () => {
    const key = sodium.crypto_pwhash(32, utf8("correct horse battery staple"), ARGON_SALT, sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13);
    expect(hex(key)).toBe(ARGON_EXPECTED);
    expect([sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE]).toEqual([2, 64 * 1024 * 1024]);
    expect([sodium.crypto_pwhash_OPSLIMIT_MODERATE, sodium.crypto_pwhash_MEMLIMIT_MODERATE]).toEqual([3, 256 * 1024 * 1024]);
    expect([sodium.crypto_pwhash_OPSLIMIT_SENSITIVE, sodium.crypto_pwhash_MEMLIMIT_SENSITIVE]).toEqual([4, 1024 * 1024 * 1024]);
  });

  it("Ed25519 from seed reproduces the interop public key and verifies its own signature", () => {
    const kp = sodium.crypto_sign_seed_keypair(ED_SEED);
    expect(hex(kp.publicKey)).toBe(ED_PUB);
    const sig = sodium.crypto_sign_detached(utf8("dosya.mlog.v1|add|subject"), kp.privateKey);
    expect(sodium.crypto_sign_verify_detached(sig, utf8("dosya.mlog.v1|add|subject"), kp.publicKey)).toBe(true);
    expect(sodium.crypto_sign_verify_detached(sig, utf8("other"), kp.publicKey)).toBe(false);
    const fresh = sodium.crypto_sign_keypair();
    expect(fresh.publicKey.length).toBe(32);
    expect(fresh.privateKey.length).toBe(64);
  });

  it("randombytes_buf returns fresh bytes of the requested length", () => {
    const a = sodium.randombytes_buf(32);
    const b = sodium.randombytes_buf(32);
    expect(a.length).toBe(32);
    expect(hex(a)).not.toBe(hex(b));
  });
});
