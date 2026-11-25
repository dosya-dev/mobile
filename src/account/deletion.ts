import { apiRequest } from "@/api/client";
import { cooldownRemaining as genericCooldown } from "@/auth/oneTimeCode";
import { formatDateWith } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

/** Mirrors COOLDOWN_SECONDS in apps/api/src/pages/api/me/delete-request.ts. */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface DeletionBlocker {
  kind: "workspace_has_members";
  workspace_id: string;
  workspace_name: string;
  member_count: number;
}

export interface DeletePreview {
  workspaces: { id: string; name: string }[];
  file_count: number;
  total_bytes: number;
  blockers: DeletionBlocker[];
  window_days: number;
  deletion_scheduled_for: number | null;
}

/** Whole seconds left before Resend will actually work. */
export function cooldownRemaining(sentAt: number | null, now: number): number {
  return genericCooldown(sentAt, now, RESEND_COOLDOWN_SECONDS);
}

/**
 * Human sentence for a blocker.
 *
 * Names the workspace and the count, because "you have blockers" tells the user
 * nothing they can act on. The recovery is stated too: they can transfer it or
 * remove people, and both are reachable on this device.
 */
export function describeBlocker(b: DeletionBlocker): string {
  return t("common.description.workspacenameStillHasNOtherNPluralOneMemberOtherMembersTransferItOr", {
    workspaceName: b.workspace_name,
    n: b.member_count,
  });
}

/** The date the account will actually be erased, for the banner and the confirm copy. */
export function formatScheduledDate(scheduledFor: number): string {
  return formatDateWith(scheduledFor, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Whole days left before erasure, floored, never negative.
 *
 * Floored rather than rounded: telling someone they have "1 day" when they have
 * six hours is the wrong direction to be wrong in.
 */
export function daysRemaining(scheduledFor: number, nowSeconds: number): number {
  return Math.max(0, Math.floor((scheduledFor - nowSeconds) / 86400));
}

export type DeleteFailureKind =
  | "wrong_code" | "wrong_password" | "no_password" | "rate_limited" | "code_burned" | "blocked" | "unknown";

export interface DeleteFailure {
  kind: DeleteFailureKind;
  message: string;
}

function statusOf(err: unknown): number {
  if (typeof err === "object" && err !== null) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return 0;
}

function messageOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * Map a failure onto advice the user can act on.
 *
 * The two 429s need opposite advice: an hourly cap means wait, but the per-code
 * cap BURNS the code, so retrying the same digits can never succeed and telling
 * the user to try again would be actively wrong.
 */
export function classifyDeleteError(err: unknown): DeleteFailure {
  const status = statusOf(err);
  const raw = messageOf(err);

  if (status === 429) {
    if (/request a new code/i.test(raw)) {
      return { kind: "code_burned", message: t("common.error.tooManyTriesOnThatCodeTapResendToGetANewOne") };
    }
    return { kind: "rate_limited", message: t("common.error.tooManyAttemptsWaitAFewMinutesThenTry") };
  }

  // A wrong password is a 403: authenticated, but the proof failed. The server
  // deliberately avoids 401, which the client would read as an expired token
  // and retry. The advice is "retype", never "resend": there is no code.
  if (status === 403 && /password/i.test(raw)) {
    return { kind: "wrong_password", message: t("common.error.thatPasswordIsNotRightTryAgain") };
  }

  if (status === 400 && /other members|transfer/i.test(raw)) {
    return { kind: "blocked", message: raw };
  }

  // The server names the recovery itself (the emailed code), so pass it through.
  if (status === 400 && /no password/i.test(raw)) {
    return { kind: "no_password", message: raw };
  }

  if (status === 400) {
    return { kind: "wrong_code", message: t("common.error.thatCodeIsNotRightOrItHasExpiredCheckThe6DigitsOr") };
  }

  return { kind: "unknown", message: raw.trim() || t("common.error.couldNotDeleteYourAccountPleaseTryAgain") };
}

export async function fetchDeletePreview(): Promise<DeletePreview> {
  return apiRequest<{ ok: true } & DeletePreview>("/api/me/delete-preview");
}

export async function requestDeleteCode(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/delete-request", { method: "POST" });
}

/**
 * How the owner proves it is them: the emailed code, or the account password.
 *
 * The password exists because App Review signs in with the demo account and
 * cannot read its mailbox (rejection 2026-10-03, guideline 5.1.1(v)). It is
 * offered only when /api/me says `has_password`; an OAuth sign-up has nothing
 * to type and keeps the code.
 */
export type DeleteProof = { code: string } | { password: string };

/**
 * Consume the proof and schedule the deletion.
 *
 * Returns the date it will run. Nothing is erased at this point - the server
 * schedules it and a cron sweeper does the work once the window elapses.
 */
export async function confirmDelete(proof: DeleteProof): Promise<number> {
  const res = await apiRequest<{ ok: true; deletion_scheduled_for: number }>("/api/me", {
    method: "DELETE",
    body: proof,
  });
  return res.deletion_scheduled_for;
}

export async function cancelDelete(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/me/delete-cancel", { method: "POST" });
}
