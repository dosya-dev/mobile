/** Dev-only: logs once what this JS engine's Intl actually does, to prove the fallbacks on a device. */
import { getLocales } from "expo-localization";
import { installIntlFallbacks } from "./intl-setup";

let logged = false;

export function logIntlProbe(): void {
  if (logged) return;
  logged = true;
  const safe = (f: () => unknown): string => {
    try {
      return String(f());
    } catch (e) {
      return `threw ${String(e)}`;
    }
  };
  const lines = [
    `typeof Intl.PluralRules = ${typeof Intl?.PluralRules}`,
    `installIntlFallbacks = ${JSON.stringify(installIntlFallbacks())}`,
    `NumberFormat(de) 1234.5 = ${safe(() => new Intl.NumberFormat("de").format(1234.5))}`,
    `NumberFormat(fr) 1234567 = ${safe(() => new Intl.NumberFormat("fr").format(1234567))}`,
    `tr month = ${safe(() => new Date(0).toLocaleDateString("tr", { month: "long" }))}`,
    `zh-Hans month = ${safe(() => new Date(0).toLocaleDateString("zh-Hans", { month: "long" }))}`,
    `el month = ${safe(() => new Date(0).toLocaleDateString("el", { month: "long" }))}`,
    `th month = ${safe(() => new Date(0).toLocaleDateString("th", { month: "long" }))}`,
    `getLocales()[0] = ${safe(() => JSON.stringify(getLocales()[0]))}`,
  ];
  for (const l of lines) console.log(`[intl-probe] ${l}`);
}
