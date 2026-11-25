import { translateExternal } from "@/lib/external-text";
/**
 * Share request bodies for mobile.
 *
 * Mobile-local rather than @dosya-dev/shared: mobile is decoupled from that
 * package (see src/lib/format.ts). The shared copy at
 * packages/shared/src/share/payload.ts serves web and desktop and normalises on
 * absolute `expires_at`; this one keeps `expires_in_days`, which is what the
 * mobile picker produces. The API accepts both forms.
 */

import {
  validateEmail, validateSharePassword, validateShareExpiryDays,
} from "@/lib/validationPolicy.generated";
import type { ShareUpdateInput as ShareUpdateOpts, ShareLockMode } from "./types";
import { t } from "@/lib/i18n";

/**
 * Refuse a share the server would refuse, with the server's own sentence.
 *
 * Mobile sent the password and the expiry straight through, so a 6-character
 * password came back as a 400 after the round trip and an expiry past the
 * 3650-day ceiling did too. Web checked the password floor; nothing else did.
 * These run in the payload builders because both the link and the email flow
 * pass through them, so neither can be missed.
 *
 * The workspace's own `share_max_expiry_days` is deliberately NOT checked: it
 * clamps silently on the server rather than refusing, so there is nothing to
 * pre-empt and a client guess would be wrong.
 */
function assertShareOpts(opts: { password?: string | null; expiresInDays?: number | null }): void {
  const pwProblem = validateSharePassword(opts.password);
  if (pwProblem) throw new Error(translateExternal(pwProblem));
  const expiryProblem = validateShareExpiryDays(opts.expiresInDays);
  if (expiryProblem) throw new Error(translateExternal(expiryProblem));
}

export interface LinkShareOpts {
  expiresInDays?: number | null;
  /**
   * An absolute instant, for a date the user picked. Takes precedence over
   * `expiresInDays` - the API reads `expires_at` first (lib/share/expiry.ts),
   * so sending both and expecting the days to win would be a silent mismatch.
   */
  expiresAt?: number | null;
  password?: string | null;
  /**
   * "view_only" creates a link that opens but never downloads.
   *
   * The API has accepted this since migration 0019 and validates it in
   * lib/share/create.ts. The CLI sends it as `--lock`. No GUI ever did, so a
   * feature that shipped years ago was reachable only from a terminal.
   */
  lockMode?: ShareLockMode;
  /** Download ceiling. `null`/absent = unlimited. */
  maxDownloads?: number | null;
  /**
   * "Remove photo metadata" (API migration 0183): photos served through the
   * link lose their EXIF/XMP/IPTC - location, camera, capture time. The
   * stored original is untouched. Sent only when true.
   */
  stripMetadata?: boolean;
}

export interface EmailShareOpts extends LinkShareOpts {
  emails: string[];
  message?: string;
  /** When true the link only opens for the named recipients. */
  restrictToRecipients: boolean;
}

/**
 * A blank password must not reach the API. Sending password: "" produces a link
 * flagged as protected that opens for anyone, which is worse than no protection
 * because the UI then claims a guarantee that is not there.
 */
function cleanPassword(password: string | null | undefined): string | null {
  const trimmed = (password ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function applyCommon(body: Record<string, unknown>, opts: LinkShareOpts): Record<string, unknown> {
  // Both builders funnel through here, so neither flow can skip the checks.
  assertShareOpts(opts);
  const pw = cleanPassword(opts.password);
  if (pw) body.password = pw;
  // "Never" has to be SAID. createShareLink applies the workspace's
  // default_share_expiry_days only when a payload names no expiry AT ALL, so
  // omitting the field made the workspace default override the one choice that
  // means "no expiry" - a link the user set to never expire dying after N days.
  // `expires_in_days: 0` is the API's own spelling of never (lib/share/expiry.ts).
  if (opts.expiresAt != null) {
    // Absolute wins: the API resolves expires_at before expires_in_days, so
    // sending both would make the picked date silently authoritative anyway.
    body.expires_at = opts.expiresAt;
  } else if (opts.expiresInDays != null) {
    body.expires_in_days = opts.expiresInDays;
  }
  // Omitted rather than sent as "none": the server already defaults to none,
  // and an explicit value on every call would make the field look meaningful
  // in logs for the overwhelming majority of links that do not use it.
  if (opts.lockMode && opts.lockMode !== "none") {
    body.lock_mode = opts.lockMode;
  }
  // Omitted when unset: the column already defaults to NULL (unlimited), and a
  // cap of "no cap" is not a value worth sending on every link.
  if (opts.maxDownloads != null) {
    if (!Number.isInteger(opts.maxDownloads) || opts.maxDownloads < 1) {
      throw new Error(t("common.description.downloadLimitMustBeAWholeNumberOfAtLeast1"));
    }
    body.max_downloads = opts.maxDownloads;
  }
  if (opts.stripMetadata === true) body.strip_metadata = true;
  return body;
}

export function buildLinkShareBody(opts: LinkShareOpts): Record<string, unknown> {
  return applyCommon({}, opts);
}

export function buildEmailShareBody(opts: EmailShareOpts): Record<string, unknown> {
  const emails = opts.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
  if (emails.length === 0) {
    throw new Error(t("common.label.buildemailsharebodyAtLeastOneRecipientIsRequired"));
  }
  // The server runs isValidEmail over every recipient and refuses the whole
  // request on the first bad one. Name it here instead, so the user is told
  // WHICH address is wrong rather than being handed a blanket refusal.
  for (const email of emails) {
    if (validateEmail(email)) throw new Error(t("common.label.emailIsNotAValidEmailAddress", { email }));
  }
  return applyCommon(
    {
      emails,
      message: (opts.message ?? "").trim(),
      restrict_to_recipients: opts.restrictToRecipients,
    },
    opts,
  );
}

/**
 * Body of PATCH /api/shares/:id.
 *
 * Absence is the whole contract: a key left out of the returned object is a
 * column the server will not write. So this builder must never "helpfully"
 * fill in the link's current values - doing so would turn every edit into a
 * full overwrite and let a stale form clobber a change made elsewhere.
 *
 * `password: null` is therefore NOT the same as omitting it. Null is an
 * instruction to remove the password; omitting it leaves the existing one in
 * place. Same for `expiresAt: null`.
 */
export function buildShareUpdateBody(input: ShareUpdateOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if ("expiresInDays" in input && input.expiresInDays !== undefined) {
    const problem = validateShareExpiryDays(input.expiresInDays);
    if (problem) throw new Error(translateExternal(problem));
    body.expires_in_days = input.expiresInDays;
  }
  if ("expiresAt" in input && input.expiresAt !== undefined) {
    body.expires_at = input.expiresAt;
  }
  if ("password" in input && input.password !== undefined) {
    const pw = cleanPassword(input.password);
    // A blank string is the user clearing the field, which is a removal - the
    // same reading cleanPassword gives it everywhere else. Only a real string
    // is validated, because null has no length to check.
    if (pw !== null) {
      const problem = validateSharePassword(pw);
      if (problem) throw new Error(translateExternal(problem));
    }
    body.password = pw;
  }
  if (input.lockMode !== undefined) body.lock_mode = input.lockMode;
  if ("maxDownloads" in input && input.maxDownloads !== undefined) {
    if (input.maxDownloads !== null && (!Number.isInteger(input.maxDownloads) || input.maxDownloads < 1)) {
      throw new Error(t("common.description.downloadLimitMustBeAWholeNumberOfAtLeast1"));
    }
    body.max_downloads = input.maxDownloads;
  }
  if (input.accessMode !== undefined) body.access_mode = input.accessMode;
  if (input.recipientEmails !== undefined) {
    const emails = input.recipientEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);
    for (const email of emails) {
      if (validateEmail(email)) throw new Error(t("common.label.emailIsNotAValidEmailAddress", { email }));
    }
    body.recipient_emails = emails;
  }

  if (Object.keys(body).length === 0) {
    throw new Error(t("common.label.buildshareupdatebodyNothingToUpdate"));
  }
  return body;
}
