import { API_BASE_URL } from "./config";
import { ApiError } from "./errors";
import { DEVICE_ID_HEADER, currentDeviceId } from "@/lib/deviceId";
import { recordApiActivity } from "@/analytics/analytics";
import { t } from "@/lib/i18n";
import { useMaintenanceStore } from "@/ui/maintenanceStore";

/** `ApiError.code` when Cloudflare's edge refused the request with a challenge page. */
export const EDGE_CHALLENGE_CODE = "edge_challenge";

export type TokenProvider = () => string | null;

/**
 * Why a refresh attempt ended. The distinction matters: only "rejected" proves
 * the credential is dead. "unavailable" means we never got an answer, so the
 * 401 that triggered the refresh is unproven and must not be reported as one.
 */
export type RefreshOutcome = "refreshed" | "rejected" | "unavailable";
export type RefreshHandler = () => Promise<RefreshOutcome>;

let tokenProvider: TokenProvider = () => null;
export function setTokenProvider(fn: TokenProvider): void {
  tokenProvider = fn;
}

let refreshHandler: RefreshHandler | null = null;
export function setRefreshHandler(fn: RefreshHandler | null): void {
  refreshHandler = fn;
}

/**
 * Latest D1 bookmark. Module-level and in-memory: it is request state, not a
 * credential, and must never reach SecureStore or AsyncStorage.
 */
let d1Bookmark: string | null = null;

interface RequestOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  skipRefresh?: boolean;
  /** Send no Authorization header. For the refresh call: its credential is the
   * refresh token in the body, and the access token it would otherwise carry is
   * expired by definition - the server used to validate that stale bearer in
   * middleware and answer 401 before the refresh handler ran, ending sessions
   * at exactly access-token expiry. */
  omitAuth?: boolean;
  /** Extra request headers, merged over the computed defaults. */
  headers?: Record<string, string>;
  _isRetry?: boolean;
}

export async function apiRequest<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;

  // Multipart bodies must go through untouched, and the Content-Type must be left
  // unset so React Native adds it *with* the multipart boundary - setting it here
  // produces a boundary-less header and the upload fails to parse server-side.
  const headers: Record<string, string> = isForm ? {} : { "Content-Type": "application/json" };
  const token = opts.omitAuth ? null : tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (d1Bookmark) headers["X-D1-Bookmark"] = d1Bookmark;
  // Which INSTALLATION is talking, not who. Attached here rather than at the
  // one call site that needs it (the backup-pause report), because the header
  // identifies the app rather than the endpoint - and a per-call-site
  // attachment is how the desktop app ended up with two upload paths that omit
  // it. Omitted, never blank, until `ensureDeviceId()` has resolved: the server
  // treats an absent header exactly as it did before the header existed.
  const deviceId = currentDeviceId();
  if (deviceId) headers[DEVICE_ID_HEADER] = deviceId;
  if (opts.headers) Object.assign(headers, opts.headers);

  let body: BodyInit | undefined;
  if (opts.body !== undefined) body = isForm ? (opts.body as FormData) : JSON.stringify(opts.body);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(t("common.error.networkRequestFailed"), 0);
  }

  const bookmark = res.headers.get("x-d1-bookmark");
  if (bookmark) d1Bookmark = bookmark;

  // Transparent refresh on 401 (once), unless this is an auth call or already a retry.
  if (res.status === 401 && refreshHandler && !opts.skipRefresh && !opts._isRetry) {
    const outcome = await refreshHandler();
    if (outcome === "refreshed") {
      return apiRequest<T>(path, { ...opts, _isRetry: true });
    }
    // The refresh never reached the server, so this 401 proves nothing. Surface
    // it as the transport failure it is - callers treat a 401 as "session dead"
    // and would otherwise sign the user out over a dropped packet.
    if (outcome === "unavailable") throw new ApiError(t("common.error.networkRequestFailed"), 0);
  }

  // Cloudflare answered instead of the API: a WAF managed challenge (today the
  // leaked-password rule on the auth doors - QA MOB-REG-014 chose a breached
  // password on the reset screen). The body is Cloudflare's HTML puzzle, which
  // this app cannot solve; parsing it as JSON read as "Malformed server
  // response". Same signal the desktop app keys on (renderer/lib/request-failure.ts).
  if ((res.headers.get("cf-mitigated") ?? "").trim().toLowerCase() === "challenge") {
    throw new ApiError(t("common.error.ourSecurityCheckBlockedThisRequest"), res.status, EDGE_CHALLENGE_CODE);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(t("common.error.malformedServerResponse"), res.status);
  }

  if (!res.ok || json?.ok === false) {
    // The mobile platform switch is off: the server answers every gated
    // request (never /api/auth/*) with this shape regardless of endpoint.
    // Record it so the root layout can swap in MaintenanceScreen - never
    // clear tokens, this is not a credential problem.
    if (res.status === 503 && json?.code === "surface_disabled") {
      useMaintenanceStore.getState().set({
        surface: typeof json.surface === "string" ? json.surface : "mobile",
        message: typeof json.message === "string" ? json.message : null,
      });
    }
    const retryAfter = res.status === 429 ? Number(res.headers.get("retry-after")) : NaN;
    throw new ApiError(
      json?.error ?? t("common.error.requestFailedStatus", { status: String(res.status) }),
      res.status,
      json?.code,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      json && typeof json === "object" ? json : undefined,
    );
  }
  // One place for the activity catalogue: a succeeded call that stands for an
  // action (a share created, a folder deleted) is counted here, by name only,
  // and only if the person agreed to share usage data (analytics/analytics.ts).
  recordApiActivity(opts.method, path);
  return json as T;
}
