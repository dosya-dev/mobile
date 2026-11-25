import { createFetchApiClient, createFetchChunkTransport, type ApiClient, type ChunkTransport } from "@dosya-dev/e2ee-client";
import { API_BASE_URL } from "@/api/config";
import { getAccessToken, refreshSession } from "@/auth/authStore";
import { DEVICE_ID_HEADER, currentDeviceId } from "@/lib/deviceId";
import { t } from "@/lib/i18n";

/**
 * The two network doors the Vault engine uses, mirroring apps/web's
 * `buildE2eeClient`: an API client for /api/e2ee/* that carries the mobile
 * bearer token (and the device header every other request carries) with the
 * same one-shot refresh-on-401 as `apiRequest`, and a chunk transport for the
 * presigned R2 URLs that carries NO auth (the URL is the credential) but
 * retries the transient failures a phone on the move sees.
 */
let fetchOverride: typeof fetch | null = null;
export function __setVaultFetchForTests(fn: typeof fetch | null): void {
  fetchOverride = fn;
}
const baseFetch: typeof fetch = (input, init) => (fetchOverride ?? fetch)(input, init);

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  const device = currentDeviceId();
  if (device) h[DEVICE_ID_HEADER] = device;
  return h;
}

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const send = () => baseFetch(input, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...authHeaders() } });
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new Error(t("common.error.networkRequestFailed"));
  }
  if (res.status !== 401) return res;
  const outcome = await refreshSession();
  if (outcome === "refreshed") return send();
  // The refresh never reached the server, so this 401 proves nothing about
  // the session - report the transport failure it is (same rule as apiRequest).
  if (outcome === "unavailable") throw new Error(t("common.error.networkRequestFailed"));
  return res;
}

export const CHUNK_RETRY_DELAYS_MS = [500, 1500, 4000] as const;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Android's networking module REFUSES a request that carries a binary body
 * with no Content-Type: React Native converts a Uint8Array body to base64 and
 * `NetworkingModule.kt` answers `"Payload is set but no content-type header
 * specified"` before the request ever leaves the phone, which reaches
 * JavaScript as a bare `TypeError: Network request failed`. Browsers and Node
 * require no such header, so every unit test, the web app and the desktop app
 * upload chunks happily without one - this is a phone-only contract, and it
 * cost a device gate to find.
 *
 * The presigned URL does not sign this header (nothing has ever sent one), so
 * declaring it changes no signature: an unsigned header is ignored by R2.
 */
const CHUNK_CONTENT_TYPE = "application/octet-stream";

const asRecord = (h: RequestInit["headers"]): Record<string, string> =>
  h && !(h instanceof Headers) && !Array.isArray(h) ? { ...(h as Record<string, string>) } : {};

function bodyNeedsContentType(init: RequestInit): boolean {
  if (init.body === undefined || init.body === null) return false;
  const headers = init.headers;
  if (headers instanceof Headers) return !headers.has("content-type");
  if (Array.isArray(headers)) return !headers.some(([k]) => k.toLowerCase() === "content-type");
  if (headers) return !Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
  return true;
}

/** Plain fetch for presigned chunk URLs: retried on network errors and 5xx, never on 4xx. */
export async function chunkFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Response> {
  const withType = bodyNeedsContentType(init) ? { ...init, headers: { ...asRecord(init.headers), "Content-Type": CHUNK_CONTENT_TYPE } } : init;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await baseFetch(input, withType);
      if (res.status < 500) return res;
      lastError = new Error(`chunk request failed (${res.status})`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < CHUNK_RETRY_DELAYS_MS.length) await sleep(CHUNK_RETRY_DELAYS_MS[attempt]!);
  }
  throw lastError instanceof Error ? lastError : new Error(t("common.error.networkRequestFailed"));
}

export function buildVaultClient(): { api: ApiClient; transport: ChunkTransport } {
  const api = createFetchApiClient({ baseUrl: API_BASE_URL, fetchFn: (input, init) => authedFetch(input, init) });
  const transport = createFetchChunkTransport((input, init) => chunkFetch(input, init));
  return { api, transport };
}
