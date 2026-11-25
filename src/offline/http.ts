import { apiRequest } from "@/api/client";
import { ApiError } from "@/api/errors";
import { t } from "@/lib/i18n";

/**
 * The offline module's requests, each with its own time limit.
 *
 * apiRequest has none, and a request that never answers (a captive portal, a
 * half-open socket) would hold a sync run - and with it every later trigger,
 * which joins the running one - forever. Past the limit the request is
 * aborted and reported as a transport failure (status 0), which every caller
 * here already reads as "unknown, change nothing".
 *
 * The timer also rejects on its own, in case an abort does not reach a
 * response body that is still being read.
 */

let limitMs = 30_000;
/** Test hook. */
export function __setRequestTimeoutForTests(ms: number | null): void {
  limitMs = ms ?? 30_000;
}

export async function offlineRequest<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new ApiError(t("common.error.networkRequestFailed"), 0));
    }, limitMs);
  });
  try {
    return await Promise.race([apiRequest<T>(path, { ...opts, signal: ctl.signal }), timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
