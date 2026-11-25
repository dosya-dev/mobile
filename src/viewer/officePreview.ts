import { t } from "@/lib/i18n";
/**
 * What a GET /api/files/:id/preview-pdf response means.
 *
 * Office documents are not rendered by a native viewer on any client - the
 * server converts them to PDF on demand and every client shows the PDF. That
 * conversion is asynchronous, so the interesting logic is not the rendering, it
 * is deciding whether a non-200 means "wait", "fall back", or "this failed".
 * Pure, so it can be tested without a network.
 */

/**
 * Derived, not chosen: the server holds a conversion lock for
 * CONVERT_LOCK_TTL_SECONDS = 60 and asks for Retry-After: 3, so 20 attempts
 * covers the longest legitimate conversion. Past that the lock is presumed
 * abandoned. A hand-picked number would either abandon a slow-but-working
 * conversion or spin long after one died.
 */
export const MAX_PREVIEW_ATTEMPTS = 20;

/** Seconds the server asks us to wait between polls. */
export const PREVIEW_RETRY_SECONDS = 3;

export type OfficePreviewState =
  | { kind: "preparing"; attempt: number }
  | { kind: "ready" }
  | { kind: "too-large" }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string };

export function officePreviewPath(fileId: string): string {
  return `/api/files/${fileId}/preview-pdf`;
}

function isTerminal(s: OfficePreviewState): boolean {
  return s.kind === "ready" || s.kind === "too-large" || s.kind === "unsupported";
}

export function nextPreviewState(
  current: OfficePreviewState,
  res: { status: number; code?: string },
): OfficePreviewState {
  // A late response must not drag a settled view backwards.
  if (isTerminal(current)) return current;

  if (res.status === 200) return { kind: "ready" };

  // Still converting. Not an error - rendering it as one would make every large
  // document look broken for the few seconds it takes.
  if (res.status === 503) {
    const attempt = (current.kind === "preparing" ? current.attempt : 0) + 1;
    if (attempt >= MAX_PREVIEW_ATTEMPTS) {
      return { kind: "failed", message: t("common.error.thisPreviewIsTakingTooLongDownloadTheFile") };
    }
    return { kind: "preparing", attempt };
  }

  // 422 with code too_large, NOT 413. Keyed on the code so a future status change
  // does not turn an ordinary large file into "unknown error", and so a 422 that
  // means something else is not mislabelled as a size problem.
  if (res.status === 422 && res.code === "too_large") return { kind: "too-large" };

  // The type genuinely cannot be converted: show the file card, not an error.
  if (res.status === 415) return { kind: "unsupported" };

  // 403 (locked) and 404 (missing or hidden) deliberately fall through to failed
  // rather than being folded into "unsupported" - telling someone their file
  // cannot be previewed when it is actually locked is a lie.
  return { kind: "failed", message: t("common.error.couldNotPrepareAPreviewForThisFile") };
}
