import { currentLocale, type useT } from "@/lib/i18n";
import { intlTag } from "@/i18n/locales";
import { formatDateWith } from "@/lib/format-locale";
import { normalizeExt } from "@/files/format";
import {
  dayKey, expandCalendar, parseIcal,
  type IcalCalendar, type IcalEvent, type IcalOccurrence, type IcalRule,
} from "@/lib/ical.generated";

/**
 * Reading a .ics for the calendar stage and route, and saying its repeats in
 * the UI language. Ported from apps/web/src/lib/calendar-read.ts; the parser
 * itself is the shared one (packages/shared/src/files/ical.ts, copied in as
 * ical.generated.ts), so a calendar reads the same here as on the web.
 */

export type ParsedCalendar = { cal: IcalCalendar; occ: IcalOccurrence[] };

/**
 * Calendars up to this size are read on the calendar route. Google Takeout
 * calendars are usually 1-10 MB. Parsing runs on the JS thread, after the
 * loading state has painted; a few seconds at the top end is accepted for now.
 */
export const MAX_ICS_PARSE_BYTES = 15 * 1024 * 1024;

/**
 * The inline text cap (MAX_INLINE_TEXT_BYTES in viewer/useFilePreview, kept
 * equal by a test). Under it the viewer already holds the body and peeks at
 * the events; over it the viewer shows an unparsed calendar card, and the
 * route's source tab shows the too-large card instead of every line.
 */
export const ICS_INLINE_BYTES = 200 * 1024;

const ICS_EXTS = new Set(["ics", "ical", "icalendar"]);

export function isCalendarFile(mime: string, ext: string | null): boolean {
  return ICS_EXTS.has(normalizeExt(ext)) || (mime || "").toLowerCase() === "text/calendar";
}

/** Parse and expand. Null when the text holds no events, so callers fall back to the text stage. */
export function readCalendar(text: string, now = Date.now()): ParsedCalendar | null {
  try {
    const cal = parseIcal(text);
    const occ = expandCalendar(cal, now);
    return occ.length ? { cal, occ } : null;
  } catch {
    return null;
  }
}

export const DAY_MS = 86_400_000;

/** The device's zone, which day keys and times are read in. */
export const viewerZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
})();
export const todayKey = () => dayKey(Date.now(), false, viewerZone);
export const keyParts = (k: string) => k.split("-").map(Number) as [number, number, number];

/** First occurrence that has not ended before the viewer's day `key` begins. */
export function firstOnOrAfter(occ: IcalOccurrence[], key: string): number {
  const [y, m, d] = keyParts(key);
  const floor = Date.UTC(y, m - 1, d) - 63 * DAY_MS;
  let lo = 0, hi = occ.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (occ[mid].start < floor) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < occ.length; i++) {
    const o = occ[i];
    if (dayKey(Math.max(o.start, o.end - 1), o.allDay, viewerZone) >= key) return i;
  }
  return occ.length;
}

/** A calendar counts its events, not the occurrences a repeat expands into. */
export const eventCount = (cal: IcalCalendar) => cal.events.filter((e) => !e.recurrenceId).length;

/** A file with one event that does not repeat (an invite, a booking) shows as one card. */
export const isSingleEvent = (cal: IcalCalendar) => cal.events.length === 1 && !cal.events[0].rule;

export const isCancelled = (ev: IcalEvent) => ev.status === "cancelled";

type Tr = ReturnType<typeof useT>;

/** The select keys of repeatMonthlyNth; anything else (last) takes the other branch. */
const ORDINAL_KEYS = ["first", "second", "third", "fourth", "fifth"];

const WEEKDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** A weekday name in the UI language: 2024-01-07 was a Sunday. */
const weekdayName = (wd: string) => formatDateWith(new Date(Date.UTC(2024, 0, 7 + WEEKDAY_INDEX[wd])), { weekday: "long", timeZone: "UTC" });

/**
 * "Monday and Thursday". Hermes has no Intl.ListFormat, so on a phone the
 * names are joined with a comma instead of the language's own "and".
 */
function joinNames(names: string[]): string {
  const ListFormat = (Intl as unknown as { ListFormat?: new (l?: string, o?: object) => { format: (x: string[]) => string } }).ListFormat;
  if (typeof ListFormat === "function") {
    try {
      return new ListFormat(intlTag(currentLocale()), { type: "conjunction", style: "long" }).format(names);
    } catch {
      // Falls through to the plain join.
    }
  }
  return names.join(", ");
}

/** A repeat rule as one sentence ("Every weekday, until December 18, 2026"), or "Repeats" for shapes too odd to say. */
export function describeRule(rule: IcalRule, start: IcalEvent["start"], tr: Tr): string {
  if (rule.unsupported) return tr("common.description.repeatCustom");
  const interval = rule.interval;
  const every = rule.byDay.filter((b) => b.n === 0).map((b) => b.wd);
  let base: string | null = null;
  if (rule.freq === "DAILY" && !rule.byDay.length && !rule.byMonthDay.length && !rule.byMonth.length) {
    base = tr("common.description.repeatDaily", { interval });
  } else if (rule.freq === "WEEKLY" && !rule.byMonth.length) {
    if (interval === 1 && every.length === 5 && (["MO", "TU", "WE", "TH", "FR"] as const).every((d) => every.includes(d))) base = tr("common.description.repeatWeekdays");
    else {
      const days = every.length ? every : [Object.keys(WEEKDAY_INDEX)[new Date(Date.UTC(start.y, start.mo - 1, start.d)).getUTCDay()]];
      base = tr("common.description.repeatWeekly", { interval, days: joinNames(days.map(weekdayName)) });
    }
  } else if (rule.freq === "MONTHLY" && !rule.byMonth.length && !rule.bySetPos.length) {
    const nth = rule.byDay.length === 1 && rule.byDay[0].n !== 0 ? rule.byDay[0] : null;
    if (nth && !rule.byMonthDay.length && nth.n >= -1 && nth.n <= 5) {
      base = tr("common.description.repeatMonthlyNth", { interval, position: nth.n === -1 ? "last" : ORDINAL_KEYS[nth.n - 1], weekday: weekdayName(nth.wd) });
    } else if (!rule.byDay.length && rule.byMonthDay.length <= 1) {
      const day = rule.byMonthDay[0] ?? start.d;
      base = day === -1 ? tr("common.description.repeatMonthlyLastDay", { interval }) : day > 0 ? tr("common.description.repeatMonthlyDay", { interval, day }) : null;
    }
  } else if (rule.freq === "YEARLY" && !rule.byDay.length && rule.byMonth.length <= 1 && rule.byMonthDay.length <= 1) {
    const mo = rule.byMonth[0] ?? start.mo;
    const d = rule.byMonthDay[0] ?? start.d;
    if (d > 0) base = tr("common.description.repeatYearly", { interval, date: formatDateWith(new Date(Date.UTC(2024, mo - 1, d)), { day: "numeric", month: "long", timeZone: "UTC" }) });
  }
  if (!base) return tr("common.description.repeatCustom");
  if (rule.until) {
    return tr("common.description.repeatUntil", { rule: base, date: formatDateWith(new Date(Date.UTC(rule.until.y, rule.until.mo - 1, rule.until.d)), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) });
  }
  if (rule.count) return tr("common.description.repeatTimes", { rule: base, count: rule.count });
  return base;
}
