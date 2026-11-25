import { t } from "@/lib/i18n";
import { parseIcal } from "@/lib/ical.generated";
import { MAX_INLINE_TEXT_BYTES } from "@/viewer/useFilePreview";
import { describeRule, ICS_INLINE_BYTES, isCalendarFile, readCalendar } from "./calendarRead";

const ics = (...lines: string[]) => ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");

describe("isCalendarFile", () => {
  it("knows a calendar by its extension or its mime", () => {
    expect(isCalendarFile("application/octet-stream", ".ics")).toBe(true);
    expect(isCalendarFile("application/octet-stream", "ICAL")).toBe(true);
    expect(isCalendarFile("application/octet-stream", ".icalendar")).toBe(true);
    expect(isCalendarFile("text/calendar", null)).toBe(true);
    expect(isCalendarFile("text/plain", ".txt")).toBe(false);
  });
});

describe("readCalendar", () => {
  it("returns the events and their occurrences", () => {
    const r = readCalendar(ics("BEGIN:VEVENT", "UID:a", "SUMMARY:Dentist", "DTSTART;VALUE=DATE:20990107", "END:VEVENT"));
    expect(r?.cal.events).toHaveLength(1);
    expect(r?.occ[0].event.summary).toBe("Dentist");
  });

  it("returns null for text with no events, so the text stage keeps it", () => {
    expect(readCalendar("just some text")).toBeNull();
    expect(readCalendar(ics("BEGIN:VTODO", "UID:x", "SUMMARY:Task", "END:VTODO"))).toBeNull();
  });

  it("knows the inline text preview cap", () => {
    expect(ICS_INLINE_BYTES).toBe(MAX_INLINE_TEXT_BYTES);
  });
});

describe("describeRule", () => {
  const rule = (rrule: string) => {
    const cal = parseIcal(ics("BEGIN:VEVENT", "UID:x", "SUMMARY:x", "DTSTART:20261102T090000Z", `RRULE:${rrule}`, "END:VEVENT"));
    const ev = cal.events[0];
    return describeRule(ev.rule!, ev.start, t);
  };
  it("says common repeats in words, as the web does", () => {
    expect(rule("FREQ=DAILY;INTERVAL=2")).toBe("Every 2 days");
    expect(rule("FREQ=WEEKLY;BYDAY=MO,TH")).toBe("Every week on Monday and Thursday");
    expect(rule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10")).toBe("Every weekday, 10 times");
    expect(rule("FREQ=MONTHLY;BYDAY=2TU")).toBe("Every month on the second Tuesday");
    expect(rule("FREQ=MONTHLY;BYDAY=-1FR")).toBe("Every month on the last Friday");
    expect(rule("FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("Every month on the last day");
    expect(rule("FREQ=YEARLY")).toBe("Every year on November 2");
    expect(rule("FREQ=HOURLY")).toBe("Repeats");
    expect(rule("FREQ=DAILY;UNTIL=20261218T235959Z")).toBe("Every day, until December 18, 2026");
  });

  it("joins weekdays with commas where the engine has no Intl.ListFormat (Hermes)", () => {
    const intl = Intl as unknown as { ListFormat?: unknown };
    const saved = intl.ListFormat;
    try {
      delete intl.ListFormat;
      expect(rule("FREQ=WEEKLY;BYDAY=MO,TH")).toBe("Every week on Monday, Thursday");
    } finally {
      intl.ListFormat = saved;
    }
  });
});
