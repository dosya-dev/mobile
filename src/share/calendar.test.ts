import { createElement } from "react";
import { Text } from "react-native";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { __resetI18nForTests } from "@/lib/i18n";
import { dayLabel, startOfDay, startOfMonth, addMonths, monthGrid, expiryForDay, lastDayEndingBy, monthLabel, weekdayInitials } from "./calendar";

const at = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0, 0).getTime();

describe("startOfDay / startOfMonth", () => {
  it("drops the time of day", () => {
    expect(new Date(startOfDay(at(2026, 8, 15))).getHours()).toBe(0);
  });

  it("walks back to the first of the month", () => {
    const d = new Date(startOfMonth(at(2026, 8, 15)));
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(8);
  });
});

describe("addMonths", () => {
  it("steps forward and back", () => {
    expect(new Date(addMonths(at(2026, 8, 1), 1)).getMonth()).toBe(9);
    expect(new Date(addMonths(at(2026, 8, 1), -1)).getMonth()).toBe(7);
  });

  it("rolls the year over", () => {
    const d = new Date(addMonths(at(2026, 11, 1), 1));
    expect(d.getMonth()).toBe(0);
    expect(d.getFullYear()).toBe(2027);
  });

  // setMonth on the 31st of a month whose neighbour has 30 days rolls into the
  // month after that - January 31st + 1 month becomes March 3rd.
  it("does not overflow from a long month into the month after next", () => {
    const d = new Date(addMonths(at(2026, 0, 31), 1));
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(1);
  });
});

describe("monthGrid", () => {
  const min = at(2026, 8, 3);

  it("starts on a Sunday and holds whole weeks", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    expect(new Date(cells[0].at).getDay()).toBe(0);
    expect(cells.length % 7).toBe(0);
  });

  it("covers every day of the month", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    const inMonth = cells.filter((c) => c.inMonth).map((c) => c.day);
    // September 2026 has 30 days.
    expect(inMonth).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("pads with neighbouring days rather than blanks, so the week shape reads", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    expect(cells.some((c) => !c.inMonth)).toBe(true);
  });

  it("disables days before the minimum but still renders them", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    const second = cells.find((c) => c.inMonth && c.day === 2)!;
    const fourth = cells.find((c) => c.inMonth && c.day === 4)!;
    expect(second.disabled).toBe(true);
    expect(fourth.disabled).toBe(false);
  });

  it("leaves the minimum day itself selectable", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    expect(cells.find((c) => c.inMonth && c.day === 3)!.disabled).toBe(false);
  });

  it("handles a month starting on a Sunday without an empty leading week", () => {
    // 1 February 2026 is a Sunday.
    const cells = monthGrid(at(2026, 1, 10), at(2026, 1, 1));
    expect(cells[0].day).toBe(1);
    expect(cells[0].inMonth).toBe(true);
  });

  it("handles February in a leap year", () => {
    const cells = monthGrid(at(2028, 1, 10), at(2028, 1, 1));
    expect(cells.filter((c) => c.inMonth).length).toBe(29);
  });

  it("never emits a day twice", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    expect(new Set(cells.map((c) => c.at)).size).toBe(cells.length);
  });

  it("runs consecutively, one day at a time", () => {
    const cells = monthGrid(at(2026, 8, 15), min);
    for (let i = 1; i < cells.length; i++) {
      const prev = new Date(cells[i - 1].at);
      prev.setDate(prev.getDate() + 1);
      expect(new Date(cells[i].at).getDate()).toBe(prev.getDate());
    }
  });
});

describe("expiryForDay", () => {
  // Midnight would kill the link a day early - "expires on the 9th" means it
  // works through the 9th.
  it("lands at the END of the chosen day", () => {
    const d = new Date(expiryForDay(at(2026, 8, 9)) * 1000);
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("returns unix seconds, which is what the API takes", () => {
    const secs = expiryForDay(at(2026, 8, 9));
    expect(Number.isInteger(secs)).toBe(true);
    expect(String(secs).length).toBe(10);
  });
});

describe("labels", () => {
  it("names the month and year", () => {
    expect(monthLabel(at(2026, 8, 15))).toMatch(/2026/);
  });

  it("gives seven weekday initials starting on Sunday", () => {
    expect(weekdayInitials()).toHaveLength(7);
  });
});

describe("monthLabel in right-to-left languages", () => {
  afterEach(() => __resetI18nForTests());

  it("fa writes the Gregorian month, not the Solar Hijri one", async () => {
    await renderInLocale(createElement(Text, null, "x"), "fa");
    const want = new Intl.DateTimeFormat("fa-u-ca-gregory", { month: "long", year: "numeric" }).format(new Date(2026, 9, 15));
    expect(monthLabel(at(2026, 9, 15))).toBe(want);
    const jalali = new Intl.DateTimeFormat("fa", { month: "long", year: "numeric" }).format(new Date(2026, 9, 15));
    expect(monthLabel(at(2026, 9, 15))).not.toBe(jalali);
  });

  it("fa and ar ask Intl for the -u-ca-gregory tag", async () => {
    const spy = jest.spyOn(Date.prototype, "toLocaleDateString");
    await renderInLocale(createElement(Text, null, "x"), "fa");
    monthLabel(at(2026, 9, 15));
    expect(spy.mock.calls.at(-1)?.[0]).toBe("fa-u-ca-gregory");
    __resetI18nForTests();
    await renderInLocale(createElement(Text, null, "x"), "ar");
    monthLabel(at(2026, 9, 15));
    expect(String(spy.mock.calls.at(-1)?.[0])).toMatch(/-ca-gregory$/);
    spy.mockRestore();
  });

  it("en is unchanged", () => {
    expect(monthLabel(at(2026, 9, 15))).toBe(new Date(2026, 9, 15).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
  });
});

describe("dayLabel", () => {
  it("never groups digits", () => {
    expect(dayLabel(7)).toBe("7");
    expect(dayLabel(1234)).toBe("1234");
  });
});

// The Free cap: the API clamps a link to now + 7 days, so the calendar must
// stop on the last day whose end-of-day expiry still fits under it.
describe("monthGrid with a latest day", () => {
  it("disables days after the latest, keeping the ones between", () => {
    const cells = monthGrid(at(2026, 8, 15), at(2026, 8, 3), at(2026, 8, 9));
    const day = (n: number) => cells.find((c) => c.inMonth && c.day === n)!;
    expect(day(3).disabled).toBe(false);
    expect(day(9).disabled).toBe(false);
    expect(day(10).disabled).toBe(true);
  });
});

describe("lastDayEndingBy", () => {
  it("ends a day early when the cap falls inside a day", () => {
    const cap = Math.floor(at(2026, 8, 10) / 1000); // noon on the 10th
    expect(new Date(lastDayEndingBy(cap)).getDate()).toBe(9);
    expect(expiryForDay(lastDayEndingBy(cap))).toBeLessThanOrEqual(cap);
  });

  it("keeps the day when the cap is at its very end", () => {
    const cap = expiryForDay(at(2026, 8, 10));
    expect(new Date(lastDayEndingBy(cap)).getDate()).toBe(10);
  });
});
