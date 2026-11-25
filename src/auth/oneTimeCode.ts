/**
 * Shared mechanics for the 6-digit codes the server mails.
 *
 * Two flows use these now - password reset and account deletion - and both are
 * gated on a code with the same width, the same paste-friendly input handling,
 * and a resend cooldown. Extracted from passwordReset.ts rather than copied, so
 * a change to the code width cannot land in one flow and not the other.
 *
 * The TTL and cooldown differ per flow because the server's differ, so they are
 * arguments here rather than constants.
 */

export const CODE_LENGTH = 6;

const DIGITS_ONLY = /\D/g;
const COMPLETE_CODE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

/** Digits only, capped at CODE_LENGTH, so pasting "12 34-56" from an email works. */
export function normaliseCode(raw: string): string {
  return raw.replace(DIGITS_ONLY, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return COMPLETE_CODE.test(code);
}

/**
 * Whole seconds left on a resend cooldown. `sentAt` and `now` are epoch ms.
 *
 * The countdown is a promise about when Resend will actually work, so the
 * cooldown passed in has to match the server's or the button lies.
 */
export function cooldownRemaining(
  sentAt: number | null,
  now: number,
  cooldownSeconds: number,
): number {
  if (sentAt == null) return 0;
  const elapsed = Math.floor((now - sentAt) / 1000);
  return Math.max(0, cooldownSeconds - elapsed);
}
