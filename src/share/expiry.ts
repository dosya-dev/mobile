/**
 * The expiry picker's options and the arithmetic behind them.
 *
 * Mobile offered four choices - Never / 1 / 7 / 30 days - with "Never" first,
 * so the default every sheet opened on was the one setting that means "this
 * link outlives the conversation". Web has offered 1 hour through 90 days plus
 * a picked date for as long as the API has taken an absolute `expires_at`.
 *
 * "Pick a date" is the seventh, matching web. Its picker is hand-built
 * (calendar.ts + DatePickerSheet.tsx) rather than a native module, so it needed
 * no new dependency and no EAS build; it resolves to an absolute `expires_at`,
 * which is what the API has always taken.
 */

import type { MessageKey } from "@/i18n/keys";
import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export interface ExpiryChoice {
  key: string;
  /** Read at render: a getter over `t`, so the text follows the current language. */
  readonly label: string;
  /** Fractional days are fine: the API floors to the second. */
  days: number | null;
}

/** 0 days is the API's spelling of never, not an expiry of zero length. */
export const NEVER: ExpiryChoice = {
  key: "never",
  get label() { return t("common.label.never"); },
  days: 0,
};

/**
 * The chip that opens the calendar. `days: null` marks it as "not a duration" -
 * `daysForKey` returns undefined for it, so a caller that forgets to read the
 * picked date sends no expiry at all rather than a wrong one.
 */
export const CUSTOM: ExpiryChoice = {
  key: "custom",
  get label() { return t("common.action.pickADate"); },
  days: null,
};

/** A preset whose label is looked up when it is read, never stored. */
function preset(key: string, days: number, labelKey: MessageKey): ExpiryChoice {
  return { key, days, get label() { return t(labelKey); } };
}

export const EXPIRY_CHOICES: ExpiryChoice[] = [
  preset("1h", 1 / 24, "common.label.oneHour"),
  preset("24h", 1, "common.label.24Hours"),
  preset("7d", 7, "common.label.sevenDays"),
  preset("30d", 30, "common.label.thirtyDays"),
  preset("90d", 90, "common.label.ninetyDays"),
  CUSTOM,
  NEVER,
];

/** Product-wide fallback when a workspace names no default. Matches web. */
export const FALLBACK_EXPIRY_DAYS = 7;

/**
 * The API clamps a Free creator's links to 7 days (create.ts
 * FREE_SHARE_LINK_MAX_EXPIRY_DAYS, and apply-update.ts on edits) without
 * refusing, so a longer pick used to come back as 7 days with nothing said.
 * The picker locks those choices instead. Same constant as web's share modal.
 */
export const FREE_MAX_EXPIRY_DAYS = 7;

/**
 * True when `choice` is closed to a Free creator: anything that outlives the
 * cap, and "Pick a date" too, since a picked date is a paid-plan choice.
 */
export function isExpiryLockedOnFree(choice: ExpiryChoice): boolean {
  if (choice.key === NEVER.key || choice.key === CUSTOM.key) return true;
  if (choice.days == null) return false;
  return choice.days > FREE_MAX_EXPIRY_DAYS;
}

/** The latest `expires_at` (unix seconds) a Free creator's link can carry. */
export function freeMaxExpiryAt(nowSeconds: number): number {
  return nowSeconds + FREE_MAX_EXPIRY_DAYS * 86400;
}

/**
 * Which chip a sheet should open on, given the workspace's default.
 *
 * A default that matches a preset selects it. A default that does not (say 14
 * days) is added as its own chip rather than silently rounded to a preset the
 * admin did not choose. `maxDays` (the Free cap, when it applies) clamps the
 * default before any of that.
 */
export function choicesForDefault(defaultDays: number | null | undefined, maxDays?: number): {
  choices: ExpiryChoice[];
  selectedKey: string;
} {
  const wanted = defaultDays != null && Number.isFinite(defaultDays) && defaultDays > 0
    ? defaultDays
    : FALLBACK_EXPIRY_DAYS;
  // A Free creator's sheet opens on what the link will actually get, never on
  // a locked chip the server would quietly cut down.
  const days = maxDays != null && wanted > maxDays ? maxDays : wanted;

  const match = EXPIRY_CHOICES.find((c) => c.days === days);
  if (match) return { choices: EXPIRY_CHOICES, selectedKey: match.key };

  const wsChoice: ExpiryChoice = {
    key: `ws-${days}`,
    get label() { return t("common.label.daysDays", { days: localDigits(days) }); },
    days,
  };
  // Sorted by duration, so the row still reads shortest to longest. "Pick a
  // date" and "Never" are not durations, so they are held out of the sort and
  // put back at the end where they belong.
  const durations = EXPIRY_CHOICES.filter((c) => c.key !== NEVER.key && c.key !== CUSTOM.key);
  const merged = [...durations, wsChoice].sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  return { choices: [...merged, CUSTOM, NEVER], selectedKey: wsChoice.key };
}

/** The `expiresInDays` value to send for a chosen key, or undefined if unknown. */
export function daysForKey(choices: ExpiryChoice[], key: string): number | undefined {
  return choices.find((c) => c.key === key)?.days ?? undefined;
}

/**
 * Which chip an EXISTING link's expiry corresponds to, for the edit sheet.
 *
 * Returns the nearest preset at or above the remaining time so the sheet opens
 * showing something true; a link with 40 days left shows the 90-day chip
 * unselected and gets its own "40 days left" chip instead.
 */
export function choicesForExisting(expiresAt: number | null, now: number): {
  choices: ExpiryChoice[];
  selectedKey: string;
} {
  if (expiresAt == null) return { choices: EXPIRY_CHOICES, selectedKey: NEVER.key };
  const secondsLeft = expiresAt - now;
  if (secondsLeft <= 0) return { choices: EXPIRY_CHOICES, selectedKey: "" };

  const daysLeft = secondsLeft / 86400;
  const match = EXPIRY_CHOICES.find((c) => c.days != null && c.days > 0 && Math.abs(c.days - daysLeft) < 0.02);
  if (match) return { choices: EXPIRY_CHOICES, selectedKey: match.key };

  const rounded = Math.max(1, Math.round(daysLeft));
  const current: ExpiryChoice = {
    key: "current",
    get label() { return t("common.label.roundedDaysLeft", { rounded: localDigits(rounded) }); },
    days: rounded,
  };
  const durations = EXPIRY_CHOICES.filter((c) => c.key !== NEVER.key && c.key !== CUSTOM.key);
  const merged = [...durations, current].sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  return { choices: [...merged, CUSTOM, NEVER], selectedKey: current.key };
}
