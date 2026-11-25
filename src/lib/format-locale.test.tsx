import { Text } from "react-native";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { __resetI18nForTests, stripBidi } from "./i18n";
import type { Locale } from "@/i18n/locales";
import {
  byteCount, fixedNumber, formatBytes, formatDate, formatDateParts, formatDateWith, formatNumber,
  formatNumberWith, formatRelative, formatShortDate, localDigits, sizeUnits,
} from "./format-locale";
import { formatDuration } from "./format";

async function useLocale(locale: Locale) {
  await renderInLocale(<Text>x</Text>, locale);
}
afterEach(() => {
  __resetI18nForTests();
});

const TS = 1718445600; // 2024-06-15T10:00:00Z
const sp = (s: string): string => s.replace(/ /g, " ");

describe("formatBytes", () => {
  it("en: as the shared formatter writes them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1073741824)).toBe("5.0 GB");
  });
  it("de: decimal comma", async () => {
    await useLocale("de");
    expect(formatBytes(1536)).toBe("1,5 KB");
  });
  it("fr: octets", async () => {
    await useLocale("fr");
    expect(formatBytes(1536)).toContain("Ko");
    expect(sizeUnits().KB).toBe("Ko");
  });
});

describe("formatDate", () => {
  it("en passes undefined to Intl", () => {
    expect(formatDate(TS, "medium")).toBe(new Date(TS * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
  });
  it("tr writes the Turkish month", async () => {
    await useLocale("tr");
    expect(formatDate(TS, "long")).toContain("Haziran");
    expect(formatDate(TS, "medium")).toContain("Haz");
  });
  it("accepts a Date and an ISO string", () => {
    expect(formatDate(new Date(TS * 1000), "medium")).toBe(formatDate(TS, "medium"));
    expect(formatDate("2024-06-15T10:00:00Z", "medium")).toBe(formatDate(TS, "medium"));
  });
  it("formatDateWith: enTag pins English only", async () => {
    expect(formatDateWith(TS, { month: "long", day: "numeric", year: "numeric" }, "en-US")).toBe("June 15, 2024");
    await useLocale("tr");
    expect(formatDateWith(TS, { month: "long", day: "numeric", year: "numeric" }, "en-US")).toBe("15 Haziran 2024");
  });
  it("formatDateWith: a time field goes through the cached formatter, same text", () => {
    const opts = { hour: "numeric", minute: "2-digit" } as const;
    expect(formatDateWith(TS, opts)).toBe(new Intl.DateTimeFormat(undefined, opts).format(new Date(TS * 1000)));
  });
  it("formatDateParts returns the parts", () => {
    const parts = formatDateParts(TS, { year: "numeric", month: "long" });
    expect(parts.map((p) => p.type)).toContain("month");
  });
});

describe("formatNumber", () => {
  it("follows the language", async () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
    await useLocale("de");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumberWith(1.5, { minimumFractionDigits: 2 })).toBe("1,50");
  });
  it("ar keeps Western digits, fa writes Persian digits, th is unchanged", async () => {
    await useLocale("ar");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    await useLocale("fa");
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("fa").format(1234.5));
    await useLocale("th");
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("th").format(1234.5));
  });
  it("byteCount and fixedNumber: unchanged in English, the language's own elsewhere", async () => {
    expect(byteCount(12345)).toBe("12345");
    expect(fixedNumber(1.25, 1)).toBe((1.25).toFixed(1));
    await useLocale("de");
    expect(byteCount(12345)).toBe("12.345");
    expect(fixedNumber(1.5, 1)).toBe("1,5");
  });
});

describe("formatRelative", () => {
  const NOW = Date.UTC(2026, 9, 19, 12) / 1000;
  it("en buckets", () => {
    const cases: [number, string][] = [[30, "just now"], [300, "5m ago"], [3 * 3600, "3h ago"], [2 * 86400, "2d ago"]];
    for (const [ago, text] of cases) expect(formatRelative(NOW - ago, NOW)).toBe(text);
    expect(formatRelative(NOW - 40 * 86400, NOW)).toBe(formatShortDate(NOW - 40 * 86400, NOW));
  });
  it("the words come from the catalog (the three keys the runtime calls exist)", async () => {
    await useLocale("de");
    expect(sp(formatRelative(NOW - 300, NOW))).toBe("vor 5 Min.");
    expect(sp(formatRelative(NOW - 3 * 3600, NOW))).toBe("vor 3 Std.");
    expect(formatRelative(NOW - 2 * 86400, NOW)).toBe("vor 2 Tagen");
    await useLocale("zh-Hans");
    expect(sp(formatRelative(NOW - 300, NOW))).toBe("5 分钟前");
    await useLocale("sk");
    expect(sp(formatRelative(NOW - 300, NOW))).toBe("pred 5 min");
  });
});

describe("state holds raw values, never a sentence", () => {
  it("an entry read under tr reads German after the switch to de", async () => {
    const entry = { createdAt: TS, bytes: 1572864 };
    const render = () => `${formatDate(entry.createdAt, "long")} | ${formatBytes(entry.bytes)}`;
    await useLocale("tr");
    const inTurkish = render();
    expect(inTurkish).toContain("Haziran");
    await useLocale("de");
    const inGerman = render();
    expect(inGerman).toContain("Juni");
    expect(inGerman).toContain("1,5 MB");
    expect(inGerman).not.toBe(inTurkish);
  });
});

describe("rtl", () => {
  it("ar: Western digits in numbers and dates, and the vendored ICU number agrees", async () => {
    await useLocale("ar");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    expect(formatNumberWith(7, { minimumIntegerDigits: 2 })).toBe("07");
    expect(fixedNumber(1.5, 1)).toMatch(/^1[.,]5$/);
    expect(formatDate(TS, "short")).not.toMatch(/[٠-٩]/);
    expect(formatShortDate(TS, TS)).not.toMatch(/[٠-٩]/);
    expect(formatDateWith(TS, { day: "numeric", month: "long" })).not.toMatch(/[٠-٩]/);
    expect(formatDateParts(TS, { year: "numeric", day: "numeric" }).map((p) => p.value).join("")).not.toMatch(/[٠-٩]/);
    expect(formatBytes(1536)).not.toMatch(/[٠-٩]/);
    expect(formatRelative(TS - 300, TS)).not.toMatch(/[٠-٩]/);
  });
  it("fa: Persian digits stay", async () => {
    await useLocale("fa");
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("fa").format(1234.5));
    expect(formatNumber(1234.5)).toMatch(/[۰-۹]/);
  });
  it("formatShortDate counts years in the language's own calendar (fa: Solar Hijri)", async () => {
    // 2026-03-15 is in Solar Hijri 1404; 2026-04-10 is in 1405.
    const past = Date.UTC(2026, 2, 15, 12) / 1000;
    const now = Date.UTC(2026, 3, 10, 12) / 1000;
    await useLocale("fa");
    expect(formatShortDate(past, now)).toMatch(/[۰-۹]{4}/);
    await useLocale("en");
    expect(formatShortDate(past, now)).toBe("Mar 15");
  });
  it("en outputs are unchanged", () => {
    expect(formatShortDate(TS, TS)).toBe("Jun 15");
    expect(formatShortDate(TS, TS + 400 * 86400)).toBe("Jun 15, 2024");
  });
});

describe("localDigits", () => {
  it("en: exactly String(n), never grouped", () => {
    expect(localDigits(1234)).toBe("1234");
    expect(localDigits(1234)).toBe(String(1234));
    expect(localDigits(0)).toBe("0");
  });
  it("fa: Persian digits, never grouped", async () => {
    await useLocale("fa");
    expect(localDigits(1234)).toBe("۱۲۳۴");
  });
  it("ar: Western digits (the app's Arabic normaliser), never grouped", async () => {
    await useLocale("ar");
    expect(localDigits(1234)).toBe("1234");
  });
  it("a converted t() call site writes Persian digits in fa and is unchanged in en", async () => {
    expect(formatDuration(5)).toBe("5s");
    await useLocale("fa");
    expect(stripBidi(formatDuration(5))).toBe("۵\u00a0ثانیه");
    expect(stripBidi(formatDuration(1500 * 60))).toBe("۲۵\u00a0ساعت ۰\u00a0دقیقه");
  });
});
