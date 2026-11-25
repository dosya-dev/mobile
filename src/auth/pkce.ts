import * as Crypto from "expo-crypto";

/**
 * PKCE pair generation for the mobile OAuth handshake, S256 only.
 *
 * The verifier never leaves the device; only its hash travels, and only on the
 * way OUT. So the one-time code that comes back in the dosya:// deep link is
 * useless to anything that merely intercepts the link - which, on a custom
 * scheme any installed app may claim, is not a hypothetical.
 *
 * Server counterpart: apps/api/src/lib/pkce.ts. The two must agree exactly on
 * the encoding, so both produce unpadded base64url and nothing else.
 */

/** 32 bytes, per RFC 7636's recommendation - 43 chars once base64url-encoded. */
const VERIFIER_BYTES = 32;

/** The nonce the app requires the callback to echo. Distinct from the verifier. */
const NONCE_BYTES = 12;

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode bytes as unpadded base64url, without `btoa`.
 *
 * `btoa` is a browser global. React Native does not polyfill it, and nothing
 * else in this app relies on it - but Node DOES have it, so a `btoa` here would
 * pass every jest run and then throw on a real device, taking OAuth sign-in
 * with it. Twelve lines of explicit encoding is the cheaper end of that trade.
 *
 * Unpadded and URL-safe because the server refuses anything else: its challenge
 * pattern is /^[A-Za-z0-9\-_]{43}$/, so a single "=" would make every code
 * unredeemable rather than merely ugly.
 *
 * Exported only so the tests can check it against Node's Buffer at every input
 * remainder - a hand-rolled encoder with an untested tail branch is precisely
 * where a silent one-character bug would live.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;            // 1 byte left: 2 chars, no padding
    out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;            // 2 bytes left: 3 chars, no padding
    out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  nonce: string;
}

/**
 * Fresh verifier, its S256 challenge, and a callback nonce.
 *
 * `digestStringAsync` is asked for BASE64 and converted rather than hex-decoded:
 * the hex round-trip is more code for the same bytes and one more place for the
 * two implementations to disagree.
 */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = toBase64Url(Crypto.getRandomBytes(VERIFIER_BYTES));
  const nonce = toBase64Url(Crypto.getRandomBytes(NONCE_BYTES));

  const digestBase64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digestBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return { verifier, challenge, nonce };
}
