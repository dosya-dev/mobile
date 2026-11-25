import { API_BASE_URL } from "@/api";
import type { MessageKey } from "@/i18n/keys";
import { t } from "@/lib/i18n";

// Keys, not text: the label is produced when roleLabel is called.
const ROLE_LABELS: Record<string, MessageKey> = {
  role_owner: "common.label.owner",
  role_admin: "common.label.admin",
  role_member: "common.label.member",
  role_viewer: "common.label.viewer",
};

// The fallback below is "Custom role", not "Member": a workspace-defined role
// has an id like `role_a1b2c3` that is not in this map, and calling it
// "Member" asserted a builtin role the person does not hold. Where the custom
// role's real NAME is available (the team screen fetches /api/roles), that
// screen resolves it instead of calling this.

/**
 * Human label for a workspace role id. Ids are `role_owner`-style - not `owner`.
 * (The web profile and create-workspace pages compared against `'owner'`, which
 * never matched, so every workspace there read "Member" including ones you own.
 * Both now call web's roleLabel instead.)
 */
export function roleLabel(roleId: string): string {
  return t(Object.prototype.hasOwnProperty.call(ROLE_LABELS, roleId) ? ROLE_LABELS[roleId] : "common.label.customRole");
}

/**
 * The authenticated endpoint that streams a workspace's custom icon. Only request
 * it when the workspace's `icon_image_url` is non-null - that column is an R2 key
 * used as a presence flag, and the endpoint 404s when no custom icon is set.
 */
export function workspaceIconUrl(workspaceId: string): string {
  return `${API_BASE_URL}/api/workspaces/${workspaceId}/icon`;
}

const UNITS: [seconds: number, key: MessageKey][] = [
  [31_536_000, "common.label.countPluralOneYearAgoOtherYearsAgo"],
  [2_592_000, "common.label.countPluralOneMonthAgoOtherMonthsAgo"],
  [86_400, "common.label.countPluralOneDayAgoOtherDaysAgo"],
  [3_600, "common.label.countPluralOneHourAgoOtherHoursAgo"],
  [60, "common.label.countPluralOneMinuteAgoOtherMinutesAgo"],
];

/** Relative time, e.g. "3 months ago". `now` is injectable for tests. */
export function timeAgo(unixSeconds: number, now: number = Math.floor(Date.now() / 1000)): string {
  const diff = Math.max(0, now - unixSeconds);
  for (const [secs, key] of UNITS) {
    const count = Math.floor(diff / secs);
    if (count >= 1) return t(key, { count });
  }
  return t("common.label.justNow");
}
