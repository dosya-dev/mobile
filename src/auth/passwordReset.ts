import { apiRequest, EDGE_CHALLENGE_CODE } from "@/api/client";
import { t } from "@/lib/i18n";
import {
  CODE_LENGTH, normaliseCode, isCompleteCode,
  cooldownRemaining as genericCooldown,
} from "./oneTimeCode";

/**
 * Mirrored from apps/api/src/pages/api/auth/forgot-password-code.ts. If those
 * server constants change, these have to change with them - the countdown is a
 * promise to the user about when Resend will actually work.
 */
export const RESEND_COOLDOWN_SECONDS = 30;
export const CODE_TTL_SECONDS = 10 * 60;

// Re-exported so the reset screens keep a single import. The mechanics live in
// oneTimeCode.ts because account deletion uses the same 6-digit input.
export { CODE_LENGTH, normaliseCode, isCompleteCode };

/** Whole seconds left on the reset resend cooldown. `sentAt` and `now` are epoch ms. */
export function cooldownRemaining(sentAt: number | null, now: number): number {
  return genericCooldown(sentAt, now, RESEND_COOLDOWN_SECONDS);
}

export type ResetFailureKind = "wrong_code" | "rate_limited" | "code_burned" | "password_refused" | "unknown";

export interface ResetFailure {
  kind: ResetFailureKind;
  message: string;
}

/**
 * The API returns 429 for two different situations that need opposite advice:
 * an hourly per-account cap on verification attempts, and a per-code cap that
 * BURNS the code. Retrying the same code after the second one can never
 * succeed, so telling the user to "try again" would be actively wrong. The
 * only thing separating them on the wire is the message text.
 */
/**
 * Read `status` off whatever was thrown without an `instanceof` check. ApiError
 * is a class in one module, and `instanceof` silently returns false whenever
 * that module gets instantiated twice (bundler duplication, a jest transform
 * boundary). Duck-typing the one field that matters cannot fail that way.
 */
function statusOf(err: unknown): number {
  if (typeof err === "object" && err !== null) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return 0;
}

function codeOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return "";
}

function messageOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

export function classifyResetError(err: unknown): ResetFailure {
  const status = statusOf(err);
  const raw = messageOf(err);

  // The edge's leaked-password rule answers with a challenge page before the
  // API sees the request (api/client.ts turns that into this code). The
  // generic "wait and retry" advice would be wrong here: the same password
  // is refused every time, so the only way forward is a different one.
  if (codeOf(err) === EDGE_CHALLENGE_CODE) {
    return {
      kind: "password_refused",
      message: t("reset-password.error.ourSecurityCheckRefusedThatPasswordChooseADifferentStrongerOne"),
    };
  }

  if (status === 429) {
    if (/request a new code/i.test(raw)) {
      return {
        kind: "code_burned",
        message: t("common.error.tooManyTriesOnThatCodeTapResendToGetANewOne"),
      };
    }
    return {
      kind: "rate_limited",
      message: t("common.error.tooManyAttemptsWaitAFewMinutesThenTry"),
    };
  }

  if (status === 400 || status === 404) {
    return {
      kind: "wrong_code",
      message: t("common.error.thatCodeIsNotRightOrItHasExpiredCheckThe6DigitsOr"),
    };
  }

  return {
    kind: "unknown",
    message: raw.trim() || t("common.error.couldNotResetYourPasswordPleaseTryAgain"),
  };
}

/**
 * Ask for a 6-digit code.
 *
 * Always resolves for a well-formed email. The endpoint is enumeration-safe: an
 * unknown address, and a known address that has never verified its email, both
 * return ok with a generic message. The caller must not infer account
 * existence from this resolving, and must not tell the user either way.
 */
export async function requestResetCode(email: string): Promise<void> {
  await apiRequest<{ ok: true; message?: string }>("/api/auth/forgot-password-code", {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
    skipRefresh: true,
  });
}

/**
 * Consume the code and set the new password.
 *
 * On success the server revokes EVERY existing session and issues a fresh one
 * as a Set-Cookie header. Mobile authenticates with tokens from SecureStore,
 * not cookies, so that session is unusable here - the caller must sign in with
 * the new password afterwards to get real mobile credentials.
 */
export async function submitReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await apiRequest<{ ok: true; redirect?: string }>("/api/auth/reset-password-code", {
    method: "POST",
    // `new_password`, not `password`: the API reads the former. The screen
    // shipped sending `password`, so every mobile reset was refused as an
    // empty password (QA MOB-REG-014). The API now also accepts `password`
    // for the installs still sending it.
    body: { email: email.trim().toLowerCase(), code, new_password: newPassword },
    skipRefresh: true,
  });
}
