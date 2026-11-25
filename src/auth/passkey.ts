import { NativeModules } from "react-native";
import {
  Passkey,
  type PasskeyCreateRequest,
  type PasskeyCreateResult,
  type PasskeyGetRequest,
  type PasskeyGetResult,
} from "react-native-passkey";
import type { MessageKey } from "@/i18n/keys";

/** The WebAuthn JSON POST /api/auth/mobile/passkey/verify expects. */
export interface PasskeyAssertionJson {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment?: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: Record<string, unknown>;
}

/** The WebAuthn JSON POST /api/me/passkeys expects. */
export interface PasskeyAttestationJson {
  id: string;
  rawId: string;
  type: "public-key";
  authenticatorAttachment?: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData?: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  clientExtensionResults: Record<string, unknown>;
}

/**
 * Both the module and the OS must be there. The library only checks the OS
 * version, so a binary built before this module was added (a stale dev client)
 * would offer a button that throws on the first tap.
 */
export function isPasskeySupported(): boolean {
  return Boolean(NativeModules.Passkey) && Passkey.isSupported();
}

/**
 * iOS already returns base64url, but on Android the JSON is written by whichever
 * credential provider the user has, and not all of them follow the spec. The
 * server compares ids as exact strings, so one padded value fails the sign-in.
 */
export function toBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function assertionToJson(result: PasskeyGetResult): PasskeyAssertionJson {
  const id = toBase64Url(result.id);
  const { clientDataJSON, authenticatorData, signature, userHandle } = result.response;
  return {
    id,
    // Optional in the library's type; the server refuses a response without it.
    rawId: result.rawId ? toBase64Url(result.rawId) : id,
    type: "public-key",
    ...(result.authenticatorAttachment ? { authenticatorAttachment: result.authenticatorAttachment } : {}),
    response: {
      clientDataJSON: toBase64Url(clientDataJSON),
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(signature),
      ...(userHandle ? { userHandle: toBase64Url(userHandle) } : {}),
    },
    clientExtensionResults: result.clientExtensionResults ?? {},
  };
}

export function attestationToJson(result: PasskeyCreateResult): PasskeyAttestationJson {
  const id = toBase64Url(result.id);
  const { clientDataJSON, attestationObject, authenticatorData, transports, publicKeyAlgorithm, publicKey } = result.response;
  return {
    id,
    rawId: result.rawId ? toBase64Url(result.rawId) : id,
    type: "public-key",
    ...(result.authenticatorAttachment ? { authenticatorAttachment: result.authenticatorAttachment } : {}),
    response: {
      clientDataJSON: toBase64Url(clientDataJSON),
      attestationObject: toBase64Url(attestationObject),
      ...(authenticatorData ? { authenticatorData: toBase64Url(authenticatorData) } : {}),
      ...(transports ? { transports: transports.map(String) } : {}),
      ...(publicKeyAlgorithm !== undefined ? { publicKeyAlgorithm } : {}),
      ...(publicKey ? { publicKey: toBase64Url(publicKey) } : {}),
    },
    clientExtensionResults: result.clientExtensionResults ?? {},
  };
}

/** Show the native sheet to sign in. A security key enrolled on the web works here too. */
export async function getPasskeyAssertion(options: PasskeyGetRequest): Promise<PasskeyAssertionJson> {
  return assertionToJson(await Passkey.get(options));
}

/**
 * Show the native sheet to create a passkey.
 *
 * Platform key on purpose: the library's combined request also offers a security
 * key on iOS and turns the server's `attestation: "none"` into `direct` for it,
 * which asks the key for an attestation the server has no use for. Android
 * ignores the flag.
 */
export async function createPasskeyCredential(options: PasskeyCreateRequest): Promise<PasskeyAttestationJson> {
  return attestationToJson(await Passkey.createPlatformKey(options));
}

/** The library rejects with a plain `{ error, message }`, not an Error. */
function passkeyErrorCode(e: unknown): string | null {
  const code = (e as { error?: unknown } | null | undefined)?.error;
  return typeof code === "string" ? code : null;
}

/** The user closed the sheet, which is a choice and never an error to report. */
export function isPasskeyCancelled(e: unknown): boolean {
  return passkeyErrorCode(e) === "UserCancelled";
}

const FAILURE_COPY: Record<string, MessageKey> = {
  NoCredentials: "sign-in.error.weCouldNotFindADosyaPasskeyOnThisDevice",
  CredentialAlreadyExists: "security.error.thisDeviceAlreadyHasAPasskeyForYourAccount",
  NoCreateOption: "security.error.turnOnAPasswordManagerOnThisDeviceToSaveAPasskey",
};

/**
 * What to tell the user. API failures carry a server sentence and are shown as
 * they are; the library's own messages are developer text, so those map to copy.
 */
export function passkeyFailureMessage(
  e: unknown,
  fallback: MessageKey,
  t: (key: MessageKey) => string,
): string {
  if (e instanceof Error) return e.message;
  const known = FAILURE_COPY[passkeyErrorCode(e) ?? ""];
  return t(known ?? fallback);
}
