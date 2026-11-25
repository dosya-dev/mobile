// expo-crypto's native module does not exist under jest. Back the functions
// the Vault and App lock use with Node's own crypto so tests exercise real
// bytes: `digest` deliberately hashes `data.buffer` rather than the view, the
// way a careless native adapter would, so the mobile backend's view-copying
// is proven by the self-test instead of hidden by the mock.
const { createHash, webcrypto } = require("node:crypto");

const CryptoDigestAlgorithm = { SHA256: "SHA-256", SHA512: "SHA-512", SHA1: "SHA-1", MD5: "MD5" };

function getRandomValues(typedArray) {
  return webcrypto.getRandomValues(typedArray);
}

function randomUUID() {
  return webcrypto.randomUUID();
}

async function digest(algorithm, data) {
  const alg = algorithm === "SHA-256" ? "sha256" : algorithm === "SHA-512" ? "sha512" : algorithm === "SHA-1" ? "sha1" : "md5";
  const whole = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer) : new Uint8Array(data);
  const out = createHash(alg).update(whole).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const CryptoEncoding = { HEX: "hex", BASE64: "base64" };

function getRandomBytes(n) {
  return webcrypto.getRandomValues(new Uint8Array(n));
}

async function digestStringAsync(algorithm, data, options) {
  const alg = algorithm === "SHA-256" ? "sha256" : algorithm === "SHA-512" ? "sha512" : algorithm === "SHA-1" ? "sha1" : "md5";
  return createHash(alg).update(data, "utf8").digest(options?.encoding === "base64" ? "base64" : "hex");
}

module.exports = { CryptoDigestAlgorithm, CryptoEncoding, getRandomValues, getRandomBytes, randomUUID, digest, digestStringAsync };
