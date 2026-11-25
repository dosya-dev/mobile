import { API_BASE_URL } from "@/api/config";

/**
 * Update checking for the APK downloaded from dosya.dev/mobile.
 *
 * A sideloaded Android app is on its own. Play only updates apps it
 * installed, and it matches them by signing certificate, so a build the user
 * fetched from our site will never be updated by the store - it simply sits
 * at whatever version it was on the day they installed it, forever, including
 * through security fixes. This module is what replaces that.
 *
 * It deliberately does NOT download or install anything. Android has no API
 * for an app to silently replace itself, and driving the package installer
 * would mean REQUEST_INSTALL_PACKAGES - a permission Play treats as
 * high-risk, that needs a declaration form, and that we would be carrying in
 * the STORE build too since both channels ship one manifest. The user is sent
 * to the download page instead: one extra tap, no permission, no review risk.
 */

/** Where the user is sent to get the new build. */
export const DOWNLOAD_PAGE_URL = "https://dosya.dev/mobile/";

export type DistributionChannel = "direct" | "play";

export type UpdateCheck =
  /** Not a sideloaded build, or the platform/version is unknown: do nothing. */
  | { status: "not-applicable"; reason: string }
  | { status: "up-to-date"; versionCode: number }
  | {
      status: "available";
      version: string;
      versionCode: number;
      sizeBytes: number;
      downloadPageUrl: string;
    }
  /** The check itself failed. Never surfaced to the user - see checkForUpdate. */
  | { status: "unavailable"; reason: string };

interface InfoResponse {
  ok?: boolean;
  version?: unknown;
  versionCode?: unknown;
  apk?: { size?: unknown };
}

export interface CheckDeps {
  /** "direct" only for the APK from our site - see app.config.ts. */
  channel: DistributionChannel;
  /** This build's Android versionCode, or null when it cannot be read. */
  installedVersionCode: number | null;
  fetchImpl?: typeof fetch;
  /** Overridden in tests; the real check should not hang a screen. */
  timeoutMs?: number;
  baseUrl?: string;
}

/**
 * Asks the API what the newest published APK is and compares it with this
 * build.
 *
 * Everything that is not a confident "there is a newer build" resolves to a
 * non-actionable status rather than rejecting. A failed update check is not
 * an error the user did anything about, and a toast about it on a plane would
 * be pure noise - the caller renders nothing for every status except
 * "available".
 *
 * The comparison is on `versionCode`, never the marketing string: it is the
 * only value Android guarantees is monotonic, and string comparison gets
 * "1.0.10" < "1.0.9" wrong exactly when a release train gets long enough to
 * matter.
 */
export async function checkForUpdate(deps: CheckDeps): Promise<UpdateCheck> {
  const {
    channel,
    installedVersionCode,
    fetchImpl = fetch,
    timeoutMs = 8000,
    baseUrl = API_BASE_URL,
  } = deps;

  // The store build must never reach the network for this. It would be both
  // useless (Play updates it) and actively harmful (the APK it would point at
  // cannot install over a Play-signed build).
  if (channel !== "direct") {
    return { status: "not-applicable", reason: "not a sideloaded build" };
  }
  if (installedVersionCode == null || !Number.isFinite(installedVersionCode)) {
    // Without a trustworthy local version there is no safe comparison, and
    // guessing would mean prompting every launch forever.
    return { status: "not-applicable", reason: "installed version code unknown" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/android/info`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    // 404 is the normal "nothing published yet" answer, not a fault.
    if (!res.ok) return { status: "unavailable", reason: `http ${res.status}` };

    const body = (await res.json()) as InfoResponse;
    const latest = body?.versionCode;
    const version = body?.version;
    const size = body?.apk?.size;

    if (
      typeof latest !== "number" ||
      !Number.isInteger(latest) ||
      typeof version !== "string" ||
      typeof size !== "number"
    ) {
      return { status: "unavailable", reason: "malformed response" };
    }

    if (latest <= installedVersionCode) {
      return { status: "up-to-date", versionCode: installedVersionCode };
    }

    return {
      status: "available",
      version,
      versionCode: latest,
      sizeBytes: size,
      downloadPageUrl: DOWNLOAD_PAGE_URL,
    };
  } catch (err) {
    // Includes the abort above. Offline is the common case here.
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.name : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}
