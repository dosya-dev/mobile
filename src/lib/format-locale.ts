/**
 * Locale-aware dates, numbers, sizes and relative times for the mobile app.
 * Ported from apps/web/src/lib/format-locale.ts.
 *
 * Every function reads the CURRENT language at call time (lib/i18n.tsx) and
 * keeps no text: callers store timestamps, counts and byte sizes, and format
 * them while rendering, so a language switch never leaves a stale sentence.
 *
 * English stays as it was before i18n. For "en" Intl gets `undefined` (the
 * device locale), or the explicit tag a call site used to hard-code
 * ("en-US"): pass that tag as `enTag` and English output does not
 * move. Other languages get their own locale. One Intl formatter is cached per
 * locale and per option set.
 */
import { currentLocale, t } from '@/lib/i18n';
import { intlTag, type Locale } from '@/i18n/locales';
import { formatBytes as translatorBytes } from '@/i18n/translator';

/** Numbers are Unix seconds (as the API sends them), strings are ISO dates. */
export type DateInput = number | string | Date;

const toDate = (value: DateInput): Date =>
  value instanceof Date ? value : typeof value === 'number' ? new Date(value * 1000) : new Date(value);

/** The tag for Intl: "en" keeps what the call site used before (undefined = device locale). */
const tagFor = (locale: Locale, enTag?: string): string | undefined => (locale === 'en' ? enTag : intlTag(locale));

/**
 * Arabic writes Western digits in the app (the "ar-u-nu-latn" tag is ignored by
 * some Hermes builds, and Node's ICU may differ from the device). While the
 * language is `ar`, Arabic-Indic digits (U+0660 to U+0669) become ASCII in every
 * output. Persian (fa) keeps its own digits on purpose.
 */
const latinDigits = (s: string): string =>
  currentLocale() === 'ar' ? s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)) : s;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: Locale, opts: Intl.DateTimeFormatOptions, enTag?: string): Intl.DateTimeFormat {
  const key = `${locale}|${enTag ?? ''}|${JSON.stringify(opts)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tagFor(locale, enTag), opts);
    dateFormatters.set(key, f);
  }
  return f;
}

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(locale: Locale, opts: Intl.NumberFormatOptions | undefined, enTag?: string): Intl.NumberFormat {
  const key = `${locale}|${enTag ?? ''}|${opts ? JSON.stringify(opts) : ''}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(tagFor(locale, enTag), opts);
    numberFormatters.set(key, f);
  }
  return f;
}

export type DateStyle = 'short' | 'medium' | 'long' | 'datetime';

const STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  medium: { month: 'short', day: 'numeric', year: 'numeric' },
  long: { month: 'long', day: 'numeric', year: 'numeric' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
};

/** What a bare toLocaleString() prints: every date and time field, numeric. */
export const DATE_TIME_NUMERIC: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
};

/** A date in one of four standard shapes, in the current language. */
export function formatDate(value: DateInput, style: DateStyle): string {
  return latinDigits(dateFormatter(currentLocale(), STYLE_OPTIONS[style]).format(toDate(value)));
}

/** A date with explicit Intl options, for the shapes the standard styles do not cover. */
export function formatDateWith(value: DateInput, opts: Intl.DateTimeFormatOptions, enTag?: string): string {
  const locale = currentLocale();
  // A date-only shape goes through toLocaleDateString, exactly as the call
  // sites did before (their tests watch that call; the engine caches the
  // formatter per locale and options). Anything with a time field uses the
  // cached Intl.DateTimeFormat, since toLocaleDateString would add a date.
  if (!TIME_FIELDS.some((k) => k in opts)) return latinDigits(toDate(value).toLocaleDateString(tagFor(locale, enTag), opts));
  return latinDigits(dateFormatter(locale, opts, enTag).format(toDate(value)));
}

const TIME_FIELDS = ['hour', 'minute', 'second', 'dateStyle', 'timeStyle', 'dayPeriod', 'fractionalSecondDigits'];

/**
 * A date in the Gregorian calendar whatever the language's default is (fa
 * defaults to Solar Hijri). Asks twice: the `-u-ca-gregory` tag extension
 * (proven on Hermes) and the `calendar` option. English output is unchanged.
 */
export function formatDateGregorian(value: DateInput, opts: Intl.DateTimeFormatOptions): string {
  const locale = currentLocale();
  const base = tagFor(locale);
  const tag = base === undefined ? undefined : base.includes('-u-') ? `${base}-ca-gregory` : `${base}-u-ca-gregory`;
  return latinDigits(toDate(value).toLocaleDateString(tag, { ...opts, calendar: 'gregory' }));
}

/** The parts of a date, for call sites that assemble their own layout. */
export function formatDateParts(value: DateInput, opts: Intl.DateTimeFormatOptions, enTag?: string): Intl.DateTimeFormatPart[] {
  const parts = dateFormatter(currentLocale(), opts, enTag).formatToParts(toDate(value));
  return currentLocale() === 'ar' ? parts.map((p) => ({ ...p, value: latinDigits(p.value) })) : parts;
}

export function formatNumber(n: number): string {
  return latinDigits(numberFormatter(currentLocale(), undefined).format(n));
}

/** A number with explicit Intl options (currency, fraction digits), in the current language. */
export function formatNumberWith(n: number, opts?: Intl.NumberFormatOptions, enTag?: string): string {
  return latinDigits(numberFormatter(currentLocale(), opts, enTag).format(n));
}

/**
 * A whole count, index or percentage for a t() value, in the language's own
 * digits and never grouped (fa: "۱۲۳۴", ar: "1234"). English is exactly
 * String(n): Intl there would follow the device locale (Persian digits on a
 * Persian phone), and English output must not move. Not for identifiers,
 * status codes, ports or years used as data.
 */
export function localDigits(n: number): string {
  return currentLocale() === 'en' ? String(n) : formatNumberWith(n, { useGrouping: false });
}

/** Sizes as packages/shared writes them (KB with one decimal), in the current language. */
export function formatBytes(n: number): string {
  return translatorBytes(currentLocale(), n);
}

/** `n.toFixed(digits)` in English (unchanged), the language's own separator elsewhere. */
export function fixedNumber(n: number, digits: number): string {
  return currentLocale() === 'en'
    ? n.toFixed(digits)
    : latinDigits(numberFormatter(currentLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n));
}

/** Unit names: French writes octets, every other language keeps B, KB, MB, GB, TB. */
export function sizeUnits(): { B: string; KB: string; MB: string; GB: string; TB: string } {
  return currentLocale() === 'fr'
    ? { B: 'o', KB: 'Ko', MB: 'Mo', GB: 'Go', TB: 'To' }
    : { B: 'B', KB: 'KB', MB: 'MB', GB: 'GB', TB: 'TB' };
}

/** A whole byte count: unchanged in English, grouped in the language otherwise. */
export function byteCount(n: number): string {
  return currentLocale() === 'en' ? String(n) : formatNumber(n);
}

/**
 * "just now", "5m ago", "3h ago", "2d ago", then a short date ("Jul 23", with
 * the year only when it is not this year). `unixSeconds` and `now` are both
 * Unix seconds. `utc` reads the calendar date in UTC for wall-clock values
 * (an EXIF capture date has no zone).
 */
export function formatRelative(unixSeconds: number, now: number = Math.floor(Date.now() / 1000), opts: { utc?: boolean } = {}): string {
  const diff = now - unixSeconds;
  if (diff < 60) return t('common.label.justNow');
  if (diff < 3600) return t('common.label.minutesMAgo', { minutes: Math.floor(diff / 60) });
  if (diff < 86400) return t('common.label.hoursHAgo', { hours: Math.floor(diff / 3600) });
  if (diff < 604800) return t('common.label.daysDAgo', { days: Math.floor(diff / 86400) });
  return formatShortDate(unixSeconds, now, opts);
}

/** "Jul 23", or "Jul 23, 2024" when the year is not the current one. */
export function formatShortDate(unixSeconds: number, now: number = Math.floor(Date.now() / 1000), opts: { utc?: boolean } = {}): string {
  const d = new Date(unixSeconds * 1000);
  const nowDate = new Date(now * 1000);
  // Same year in the language's own calendar (fa counts Solar Hijri years).
  const yearOf = (date: Date): string | undefined =>
    formatDateParts(date, opts.utc ? { year: 'numeric', timeZone: 'UTC' } : { year: 'numeric' }, 'en').find((p) => p.type === 'year')?.value;
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (yearOf(d) !== yearOf(nowDate)) o.year = 'numeric';
  if (opts.utc) o.timeZone = 'UTC';
  // Explicit 'en' keeps the English month names the hand-written table used.
  return latinDigits(dateFormatter(currentLocale(), o, 'en').format(d));
}
