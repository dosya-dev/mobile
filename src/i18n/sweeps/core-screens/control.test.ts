/**
 * Control for the core-screen sweeps: the leftover-English check must really
 * flag English in each swept language, or "no leftover English" proves nothing.
 */
import { LOCALES } from "@/i18n/locales";
import { leftoverEnglish } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";

describe.each(SWEEP_LOCALES)("sweep control in %s", (locale) => {
  it("is shipped", () => {
    expect(LOCALES).toContain(locale);
  });

  it("flags English catalog text and passes the language's own text", () => {
    expect(leftoverEnglish(["Cancel", "Delete"], locale)).toEqual(["Cancel", "Delete"]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const own = require(`@/i18n/messages/${locale}.json`) as Record<string, string>;
    expect(leftoverEnglish([own["common.cancel"]], locale)).toEqual([]);
  });
});
