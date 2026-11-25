import * as sodium from "react-native-libsodium";
import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import type { CryptoBackend } from "@dosya-dev/e2ee-core";

/**
 * e2ee-core's `CryptoBackend` on native code: react-native-libsodium (JSI)
 * for Argon2id, XChaCha20-Poly1305, Ed25519 and randomness, expo-crypto's
 * native digest for SHA-256 (the libsodium binding has no sha256).
 *
 * Buffer contract (packages/e2ee-core/src/backend.ts): callers hand us
 * `subarray` views into larger buffers. JSI hands the NATIVE side the whole
 * `ArrayBuffer`, so every input is first reduced to an exact, unshared buffer
 * with `exactBytes` (a copy only when the view is not already the whole
 * buffer). Every result is wrapped in a fresh `Uint8Array` so nothing the
 * caller keeps aliases native memory. Failure is signalled only by throwing
 * (`aeadDecrypt`) or returning `false` (`verify`).
 *
 * Argon2id runs synchronously on the JS thread inside the JSI call (about
 * 0.3 s at the interactive tier on a mid-range phone); the store shows a busy
 * state before calling it.
 */
export function exactBytes(u: Uint8Array): Uint8Array {
  return u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u : u.slice();
}

const fresh = (x: Uint8Array | ArrayBuffer): Uint8Array => new Uint8Array(x instanceof Uint8Array ? x : new Uint8Array(x));

export async function createMobileBackend(): Promise<CryptoBackend> {
  await sodium.ready;
  return {
    name: "react-native-libsodium",
    argon2Tiers: {
      interactive: { opslimit: 2, memlimit: 64 * 1024 * 1024 },
      moderate: { opslimit: 3, memlimit: 256 * 1024 * 1024 },
      sensitive: { opslimit: 4, memlimit: 1024 * 1024 * 1024 },
    },
    randomBytes: (n) => fresh(sodium.randombytes_buf(n)),
    // expo-crypto's `digest` types its parameter as `BufferSource`, which TS
    // narrows to a Uint8Array backed specifically by ArrayBuffer (not
    // SharedArrayBuffer); `exactBytes` never returns a shared buffer, so this
    // cast just satisfies that narrower type (same pattern as
    // apps/api/src/lib/upload/content-hash.ts).
    sha256: async (data) => fresh(await digest(CryptoDigestAlgorithm.SHA256, exactBytes(data) as BufferSource)),
    aeadEncrypt: (key, nonce, plaintext, ad) =>
      fresh(sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(exactBytes(plaintext), exactBytes(ad), null, exactBytes(nonce), exactBytes(key))),
    aeadDecrypt: (key, nonce, ciphertext, ad) =>
      fresh(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, exactBytes(ciphertext), exactBytes(ad), exactBytes(nonce), exactBytes(key))),
    pwhash: async (outLen, password, salt, opslimit, memlimit) =>
      fresh(sodium.crypto_pwhash(outLen, exactBytes(password), exactBytes(salt), opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13)),
    signKeyPair: () => {
      const kp = sodium.crypto_sign_keypair();
      return { publicKey: fresh(kp.publicKey), privateKey: fresh(kp.privateKey) };
    },
    signKeyPairFromSeed: (seed32) => {
      const kp = sodium.crypto_sign_seed_keypair(exactBytes(seed32));
      return { publicKey: fresh(kp.publicKey), privateKey: fresh(kp.privateKey) };
    },
    sign: (message, privateKey) => fresh(sodium.crypto_sign_detached(exactBytes(message), exactBytes(privateKey))),
    verify: (signature, message, publicKey) =>
      sodium.crypto_sign_verify_detached(exactBytes(signature), exactBytes(message), exactBytes(publicKey)),
  };
}
