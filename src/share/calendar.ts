import { formatDateGregorian, formatDateWith, formatNumberWith } from "@/lib/format-locale";

/**
 * Month arithmetic for the expiry date picker.
 *
 * Pure and dependency-free on purpose. A native picker
 * (@react-native-community/datetimepicker) would mean a new native module and
 * therefore a new EAS build before anyone could use the feature; the API takes
 * an absolute `expires_at`, so a small calendar built from these functions
 * produces exactly the same value with nothing to rebuild.
 */

export interface DayCell {
  /** Unix seconds at the START of this day, local time. */
  at: number;
  day: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  /** Before the earliest selectable day, or after the latest. */
  disabled: boolean;
}

const MS_PER_DAY = 86_400_000;

/** Local midnight for the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The first of the month containing `ms`, at local midnight. */
export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Step whole months without the classic overflow bug: `setMonth` on the 31st
 * of a month with a 30-day neighbour rolls into the following month. Anchoring
 * to the 1st first makes that impossible.
 */
export function addMonths(ms: number, delta: number): number {
  const d = new Date(startOfMonth(ms));
  d.setMonth(d.getMonth() + delta);
  return d.getTime();
}

export function monthLabel(ms: number): string {
  // The grid is Gregorian in every language (fa would otherwise name a Solar Hijri month over it).
  return formatDateGregorian(new Date(ms), { month: "long", year: "numeric" });
}

/** A day number for a grid cell: no grouping separators, the language's own digits. */
export function dayLabel(n: number): string {
  return formatNumberWith(n, { useGrouping: false });
}

/** Su..Sa initials in the current language, starting on Sunday. */
export function weekdayInitials(): string[] {
  const out: string[] = [];
  // 2023-01-01 was a Sunday, so this walks one full week from a known start.
  const base = new Date(2023, 0, 1);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * MS_PER_DAY);
    out.push(formatDateWith(d, { weekday: "narrow" }));
  }
  return out;
}

/**
 * A whole-weeks grid for the month containing `monthMs`.
 *
 * `minMs` is the earliest selectable instant - anything before it is rendered
 * but not tappable, so the shape of the month stays readable rather than having
 * holes punched in it. `maxMs`, when given, is any instant inside the latest
 * selectable day, and days after it are drawn the same way.
 */
export function monthGrid(monthMs: number, minMs: number, maxMs?: number): DayCell[] {
  const first = new Date(startOfMonth(monthMs));
  const leading = first.getDay();
  const minDay = startOfDay(minMs);
  const maxDay = maxMs == null ? Infinity : startOfDay(maxMs);

  const cells: DayCell[] = [];
  // Start on the Sunday on or before the 1st, then emit whole weeks until the
  // month is covered - six rows at most, five for most months.
  const gridStart = first.getTime() - leading * MS_PER_DAY;
  const month = first.getMonth();

  for (let i = 0; i < 42; i++) {
    // Rebuilt from a Date rather than added in milliseconds, so a DST change
    // inside the month cannot shift the grid by an hour and drop a day.
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const at = d.getTime();
    const inMonth = d.getMonth() === month;

    cells.push({ at, day: d.getDate(), inMonth, disabled: at < minDay || at > maxDay });

    // Stop at the end of the week that completes the month.
    if (i >= 27 && (i + 1) % 7 === 0 && new Date(at + MS_PER_DAY).getMonth() !== month) break;
  }
  return cells;
}

/**
 * The unix-seconds instant a picked day should expire at.
 *
 * End of the chosen day, not its start: "expires on the 9th" means the link
 * works through the 9th. Choosing midnight would kill it a day early, which is
 * the reading no user has ever meant.
 */
export function expiryForDay(dayMs: number): number {
  const d = new Date(dayMs);
  d.setHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Local midnight of the latest day whose expiry (expiryForDay) still falls at
 * or before `maxSeconds`.
 *
 * For the Free cap: a link picked for "7 days from today" would expire at
 * 23:59:59 that day, hours past now + 7 days, and the API would cut it back
 * without a word. Ending the calendar one day earlier keeps every date it
 * offers one the server will honour as picked.
 */
export function lastDayEndingBy(maxSeconds: number): number {
  const d = new Date(startOfDay(maxSeconds * 1000));
  if (expiryForDay(d.getTime()) > maxSeconds) {
    // Stepped with setDate, not 86_400_000 ms, for the same DST reason as monthGrid.
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
  }
  return d.getTime();
}
