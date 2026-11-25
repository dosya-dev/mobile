import { runBackendSelfTest, setCryptoBackend, getCryptoBackend, sha256, aeadEncrypt, aeadDecrypt } from "@dosya-dev/e2ee-core";
import { createMobileBackend, exactBytes } from "./backend";

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

// The core's registry is install-once per process and the vendored bundle
// exports no reset seam; jest gives each test FILE its own module registry,
// so this file installs the mobile backend exactly once, up front.
describe("mobile CryptoBackend (react-native-libsodium + expo-crypto)", () => {
  beforeAll(async () => {
    setCryptoBackend(await createMobileBackend());
    expect((await getCryptoBackend()).name).toBe("react-native-libsodium");
  });

  it("passes the whole backend self-test, including the offset-view cases", async () => {
    const results = await runBackendSelfTest();
    const failures = results.filter((r) => !r.ok);
    // Jest's `expect()` (unlike Vitest's) takes no message argument; on
    // failure, `toEqual`'s own diff already prints each failing case's
    // `name`/`detail`, which is the diagnostic the message would have added.
    expect(failures).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(expect.arrayContaining(["sha256.offsetView", "aead.badAd", "ed25519.verify.tampered", "kdf.tiers", "vectors.argon2id"]));
  });

  it("reports its name and libsodium's Argon2id tiers", async () => {
    const b = await createMobileBackend();
    expect(b.name).toBe("react-native-libsodium");
    expect(b.argon2Tiers).toEqual({
      interactive: { opslimit: 2, memlimit: 64 * 1024 * 1024 },
      moderate: { opslimit: 3, memlimit: 256 * 1024 * 1024 },
      sensitive: { opslimit: 4, memlimit: 1024 * 1024 * 1024 },
    });
  });

  it("copies views to exact buffers before native calls (the expo-crypto mock hashes `.buffer` on purpose)", async () => {
    const pool = new Uint8Array(96).fill(0x5a);
    pool.set(utf8("abc"), 32);
    const view = pool.subarray(32, 35);
    expect(hex(await sha256(view))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(exactBytes(view)).not.toBe(view);
    expect(exactBytes(view).buffer.byteLength).toBe(3);
    const whole = new Uint8Array(4);
    expect(exactBytes(whole)).toBe(whole);
  });

  it("returns fresh arrays the caller owns, and fails closed on a bad tag", async () => {
    const key = new Uint8Array(32).fill(1);
    const { nonce, ciphertext } = await aeadEncrypt(key, utf8("m"), utf8("ad"));
    const pt = await aeadDecrypt(key, nonce, ciphertext, utf8("ad"));
    expect(pt).toBeInstanceOf(Uint8Array);
    expect(pt.buffer.byteLength).toBe(pt.byteLength);
    ciphertext[0] ^= 0xff;
    await expect(aeadDecrypt(key, nonce, ciphertext, utf8("ad"))).rejects.toThrow("aead: decryption failed");
  });
});
