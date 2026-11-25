import type { MyShare, ShareStatus, ShareAnalytics } from "./types";
import { defaultSwatch } from "@/theme/palette";
import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

/**
 * Display logic for the share screens, kept out of the components so it can be
 * tested without rendering anything - and so the list row and the detail header
 * cannot drift into describing the same link two different ways.
 */

/** Seconds inside which a link counts as "expiring soon". Matches the API's own threshold. */
export const EXPIRING_WINDOW_SECONDS = 3 * 86400;

export type StatusTone = "live" | "warn" | "dead" | "revoked";

export function statusTone(status: ShareStatus): StatusTone {
  switch (status) {
    case "active": return "live";
    case "expiring": return "warn";
    case "revoked": return "revoked";
    default: return "dead";
  }
}

export function statusLabel(status: ShareStatus): string {
  switch (status) {
    case "active": return t("shared-links.label.active");
    case "expiring": return t("shared-links.label.expiring");
    case "expired": return t("shared-links.label.expired");
    case "revoked": return t("shared-links.label.revoked");
    default: {
      // A status the API adds later still reads as a word, not as a blank.
      const raw = String(status);
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }
}

/**
 * How long this link has left, in the fewest words that stay honest.
 *
 * Revoked beats expiry: a revoked link's `expires_at` may still be in the
 * future, and "6 days left" on a link that stopped working is a lie.
 */
export function expiryLabel(
  link: Pick<MyShare, "is_revoked" | "expires_at" | "revoked_at">,
  now: number = Math.floor(Date.now() / 1000),
): string {
  if (link.is_revoked) return t("common.status.revoked");
  if (link.expires_at == null) return t("common.label.neverExpires");
  const left = link.expires_at - now;
  if (left <= 0) return t("common.status.expired");
  if (left < 3600) return t("common.label.underAnHourLeft");
  if (left < 86400) {
    const hours = Math.round(left / 3600);
    return t("common.label.hoursPluralOneHourLeftOtherHoursLeft", { hours });
  }
  // Floor, not ceil, and no "Tomorrow".
  //
  // `Math.ceil` overstated: 30 hours became "2 days left", on exactly the links
  // a countdown exists to warn about. "Tomorrow" was worse - a calendar claim
  // this function cannot make, since it only knows a duration, so 47 hours read
  // as "Tomorrow" when it is usually the day after.
  //
  // Flooring is always true ("at least N days remain") and degrades safely:
  // it can only ever tell the user they have LESS time than they do.
  const days = Math.floor(left / 86400);
  return t("common.label.daysPluralOneDayLeftOtherDaysLeft", { days });
}

/** The same value as a chip: short enough for a row that already carries a name. */
export function expiryShort(
  link: Pick<MyShare, "is_revoked" | "expires_at" | "revoked_at">,
  now: number = Math.floor(Date.now() / 1000),
): string {
  if (link.is_revoked) return t("common.status.revoked");
  if (link.expires_at == null) return t("common.label.never");
  const left = link.expires_at - now;
  if (left <= 0) return t("common.status.expired");
  if (left < 86400) return t("common.label.1d");
  // Floored to match expiryLabel, so the chip and the sentence never disagree
  // about whether a link has one day left or two.
  return t("common.label.daysD", { days: localDigits(Math.floor(left / 86400)) });
}

/**
 * What the row shows about how protected a link is.
 *
 * The API has always returned all four of these and no client rendered them, so
 * a password-protected link looked exactly like an open one. Ordered
 * strongest-signal first, because a narrow row may only fit the first two.
 */
export type ShareBadge = { key: string; icon: string; label: string; count?: number };

export function badgesFor(link: Pick<MyShare, "is_password_protected" | "lock_mode" | "access_mode" | "recipient_count">): ShareBadge[] {
  const out: ShareBadge[] = [];
  if (link.access_mode === "restricted") {
    out.push({ key: "restricted", icon: "people", label: t("common.label.onlyInvitedPeople"), count: link.recipient_count });
  }
  if (link.is_password_protected) {
    out.push({ key: "password", icon: "lock-closed", label: t("common.label.passwordRequired") });
  }
  if (link.lock_mode === "view_only") {
    out.push({ key: "view_only", icon: "eye", label: t("common.action.viewOnlyNoDownloads") });
  }
  if (link.lock_mode === "full_lock") {
    out.push({ key: "full_lock", icon: "lock-closed", label: t("common.label.fullyLocked") });
  }
  return out;
}

/** Short uppercase tag for a file tile: the extension, or initials for a name without one. */
export function avatarLabel(name: string, extension?: string | null): string {
  const ext = (extension ?? "").replace(/^\./, "").trim();
  if (ext) return ext.slice(0, 4).toUpperCase();
  const fromName = /\.([a-z0-9]{1,4})$/i.exec(name.trim());
  if (fromName) return fromName[1].toUpperCase();
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/**
 * A stable colour per name, so the same file keeps the same tile between sessions.
 *
 * Draws from the shared identity swatches rather than a private ten-hue set. The old
 * palette here was desaturated and unrelated to the one the web app used for the same
 * job, so the same person could have two different avatar colours across clients.
 */
export function avatarColor(name: string, scheme: "light" | "dark" = "light"): string {
  return defaultSwatch(name)[scheme];
}

/**
 * The reading of the numbers that goes above the chart.
 *
 * A sentence carries further than a 54-pixel bar chart on a phone, and it is
 * the only place that can say what the counters deliberately do NOT know -
 * that a public link's visitors are anonymous, and that a revoked link's
 * figures are final.
 */
export function summarySentence(a: Pick<ShareAnalytics, "link" | "reach">): string {
  const { link, reach } = a;
  const people = reach.visitors;

  if (link.is_revoked) {
    return people === 0
      ? t("common.description.nobodyOpenedThisLinkBeforeItWasRevoked")
      : t("common.error.peoplePluralOnePersonOtherPeopleOpenedThisLinkBeforeItWasRevokedIt", { people });
  }
  if (people === 0) {
    return link.status === "expired"
      ? t("common.description.nobodyOpenedThisLinkBeforeItExpired")
      : t("common.description.nobodyHasOpenedThisLinkYet");
  }
  const downloads = link.download_count;
  if (link.access_mode === "restricted") {
    return t("common.description.peoplePluralOneOfTheInvitedPersonOtherOfTheInvitedPeopleOpenedThis", { people, downloads });
  }
  return t("common.description.peoplePluralOnePersonOtherPeopleOpenedThisLinkAndItHasDownloadsPlural", { people, downloads });
}

/** Tallest bar in the timeline, so the chart scales to its own data. */
export function timelinePeak(timeline: ShareAnalytics["timeline"]): number {
  return timeline.reduce((max, p) => Math.max(max, p.opens, p.downloads), 0);
}

/** ISO country code to a flag-free short label; the log column is narrow. */
export function countryLabel(code: string | null): string {
  return code ? code.toUpperCase() : "-";
}
