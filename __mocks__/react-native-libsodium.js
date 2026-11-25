// react-native-libsodium is a JSI module: under jest there is no native side.
// Stand in with libsodium-wrappers-sumo (the same libsodium, as WASM) behind
// the native package's synchronous API. Consumers must `await ready` once -
// the native package exports an already-resolved `ready` for parity, and the
// mobile backend awaits it either way.
//
// The associated-data arguments accept Uint8Array, matching the patched native
// module (patches/react-native-libsodium+1.7.0.patch), not the upstream
// string-only wrapper.
const wrappers = require("libsodium-wrappers-sumo");

let live = null;
const ready = wrappers.ready.then(() => { live = wrappers; });

function s() {
  if (!live) throw new Error("react-native-libsodium mock: await `ready` before use");
  return live;
}

const fresh = (u) => new Uint8Array(u);

module.exports = {
  ready,
  get crypto_pwhash_ALG_ARGON2ID13() { return s().crypto_pwhash_ALG_ARGON2ID13; },
  get crypto_pwhash_OPSLIMIT_INTERACTIVE() { return s().crypto_pwhash_OPSLIMIT_INTERACTIVE; },
  get crypto_pwhash_MEMLIMIT_INTERACTIVE() { return s().crypto_pwhash_MEMLIMIT_INTERACTIVE; },
  get crypto_pwhash_OPSLIMIT_MODERATE() { return s().crypto_pwhash_OPSLIMIT_MODERATE; },
  get crypto_pwhash_MEMLIMIT_MODERATE() { return s().crypto_pwhash_MEMLIMIT_MODERATE; },
  get crypto_pwhash_OPSLIMIT_SENSITIVE() { return s().crypto_pwhash_OPSLIMIT_SENSITIVE; },
  get crypto_pwhash_MEMLIMIT_SENSITIVE() { return s().crypto_pwhash_MEMLIMIT_SENSITIVE; },
  randombytes_buf: (n) => fresh(s().randombytes_buf(n)),
  crypto_pwhash: (outLen, password, salt, ops, mem, alg) => fresh(s().crypto_pwhash(outLen, password, salt, ops, mem, alg)),
  crypto_aead_xchacha20poly1305_ietf_encrypt: (message, ad, _secretNonce, nonce, key) =>
    fresh(s().crypto_aead_xchacha20poly1305_ietf_encrypt(message, ad, null, nonce, key)),
  crypto_aead_xchacha20poly1305_ietf_decrypt: (_secretNonce, ciphertext, ad, nonce, key) =>
    fresh(s().crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad, nonce, key)),
  crypto_sign_keypair: () => { const kp = s().crypto_sign_keypair(); return { publicKey: fresh(kp.publicKey), privateKey: fresh(kp.privateKey), keyType: kp.keyType }; },
  crypto_sign_seed_keypair: (seed) => { const kp = s().crypto_sign_seed_keypair(seed); return { publicKey: fresh(kp.publicKey), privateKey: fresh(kp.privateKey), keyType: kp.keyType }; },
  crypto_sign_detached: (message, privateKey) => fresh(s().crypto_sign_detached(message, privateKey)),
  crypto_sign_verify_detached: (signature, message, publicKey) => s().crypto_sign_verify_detached(signature, message, publicKey),
};
