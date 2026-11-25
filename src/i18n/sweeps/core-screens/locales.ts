import type { Locale } from "@/i18n/locales";

/**
 * The languages every core-screen sweep renders: Turkish (agglutinative, the
 * owner's language), German (long words), Polish (four plural forms) and
 * Simplified Chinese (no spaces, no plural). Each must be shipped.
 */
export const SWEEP_LOCALES = ["tr", "de", "pl", "zh-Hans"] as const satisfies readonly Locale[];
