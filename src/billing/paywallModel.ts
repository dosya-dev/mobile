import type { PurchasesPackage } from "react-native-purchases";
import type { MessageKey } from "@/i18n/keys";
import { formatBytes } from "@/lib/format";
import { formatNumberWith } from "@/lib/format-locale";
import type { CatalogPlan, Eligibility } from "./api";

/**
 * Pure paywall logic: which plans to offer and at what saving. Prices are only
 * ever the store's own `priceString`; the catalog supplies names and sizes.
 */

export type Interval = "month" | "year";

export type PaywallRow = {
  planId: string;
  name: string;
  storageLabel: string;
  features: string[];
  /** Catalog Smart Search limits, null when the plan has none. */
  aiImagesMax: number | null;
  aiDocumentsMax: number | null;
  monthly?: PurchasesPackage;
  yearly?: PurchasesPackage;
  yearlySavingPct: number | null;
};

const SIZE_TO_PLAN: Record<string, string> = {
  "100gb": "starter",
  "500gb": "plus",
  "1tb": "pro",
  "2tb": "business",
  "4tb": "tb4",
  "6tb": "tb6",
  "8tb": "tb8",
  "10tb": "tb10",
  "20tb": "tb20",
};

const PRODUCT_ID = /^dosya_([0-9a-z]+)_(monthly|yearly)$/;

/** `dosya_<size>_<monthly|yearly>`; Play appends `:<basePlan>`, which is ignored. */
/** Store name shown to people for a subscription's provider. */
export function storeDisplayName(provider: "apple" | "google"): string {
  return provider === "google" ? "Google Play" : "App Store";
}

export function productToPlan(productId: string): { planId: string; interval: Interval } | null {
  const match = PRODUCT_ID.exec(productId.split(":")[0] ?? "");
  if (!match) return null;
  const planId = SIZE_TO_PLAN[match[1]!];
  if (!planId) return null;
  return { planId, interval: match[2] === "monthly" ? "month" : "year" };
}

export function yearlySavingPct(monthlyPrice: number, yearlyPrice: number): number | null {
  if (!(monthlyPrice > 0) || !Number.isFinite(yearlyPrice)) return null;
  const pct = Math.round((1 - yearlyPrice / (12 * monthlyPrice)) * 100);
  return pct > 0 ? pct : null;
}

export function buildPaywallRows(
  plans: CatalogPlan[],
  packages: PurchasesPackage[],
  toPlan: (productId: string) => { planId: string; interval: Interval } | null,
): PaywallRow[] {
  const byPlan = new Map<string, { monthly?: PurchasesPackage; yearly?: PurchasesPackage }>();
  for (const pkg of packages) {
    const parsed = toPlan(pkg.product.identifier);
    if (!parsed) continue;
    const slot = byPlan.get(parsed.planId) ?? {};
    if (parsed.interval === "month") slot.monthly ??= pkg;
    else slot.yearly ??= pkg;
    byPlan.set(parsed.planId, slot);
  }

  return plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.active !== false && byPlan.has(plan.id))
    .sort((a, b) => (a.plan.sort_order ?? a.index) - (b.plan.sort_order ?? b.index) || a.index - b.index)
    .map(({ plan }) => {
      const { monthly, yearly } = byPlan.get(plan.id)!;
      const row: PaywallRow = {
        planId: plan.id,
        name: plan.name,
        storageLabel: plan.storage_label ?? formatBytes(plan.storage_bytes),
        features: plan.features,
        aiImagesMax: plan.ai_images_max ?? null,
        aiDocumentsMax: plan.ai_documents_max ?? null,
        yearlySavingPct: monthly && yearly ? yearlySavingPct(monthly.product.price, yearly.product.price) : null,
      };
      if (monthly) row.monthly = monthly;
      if (yearly) row.yearly = yearly;
      return row;
    });
}

/**
 * The yearly price as a per-month figure, in the store's currency. Only ever a
 * secondary "≈ … / month" line under the full yearly price; null when the
 * store gave no usable price or currency.
 */
export function perMonthEquivalent(yearlyPrice: number, currencyCode: string, enTag?: string): string | null {
  if (!(yearlyPrice > 0) || !currencyCode) return null;
  try {
    return formatNumberWith(yearlyPrice / 12, { style: "currency", currency: currencyCode }, enTag);
  } catch {
    return null;
  }
}

export type FeatureLine = { key: MessageKey; params?: Record<string, string> };

/**
 * "What you get": at most four lines. Storage and devices always; then Smart
 * Search (when the plan has it and the catalog sent its limits) or own
 * branding; then support. `enTag` pins the English number format (tests).
 */
export function featureLines(row: PaywallRow, enTag?: string): FeatureLine[] {
  const lines: FeatureLine[] = [
    { key: "upgrade.feature.encryptedStorage", params: { storage: row.storageLabel } },
    { key: "upgrade.feature.allDevices" },
  ];
  if (row.features.includes("ai_search") && row.aiImagesMax !== null && row.aiDocumentsMax !== null) {
    lines.push({
      key: "upgrade.feature.smartSearch",
      params: { images: formatNumberWith(row.aiImagesMax, undefined, enTag), documents: formatNumberWith(row.aiDocumentsMax, undefined, enTag) },
    });
  } else if (row.features.includes("white_label")) {
    lines.push({ key: "upgrade.feature.whiteLabel" });
  }
  lines.push({ key: "upgrade.feature.prioritySupport" });
  return lines;
}

/** One tier up or down, never past either end. */
export function stepTier(index: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index + delta));
}

/** Which tiers get a label under the picker: first, third, fifth and last (by position, whatever their sizes). */
export function tickLabelIndexes(count: number): number[] {
  return [...new Set([0, 2, 4, count - 1])].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
}

/** The tier the paywall opens on: the first sold yearly, else the first. */
export function defaultTierIndex(rows: PaywallRow[]): number {
  return Math.max(0, rows.findIndex((r) => r.yearly));
}

/** The wanted billing period if this tier sells it, else the one it does. */
export function intervalFor(row: PaywallRow, wanted: Interval): Interval {
  if (wanted === "year") return row.yearly ? "year" : "month";
  return row.monthly ? "month" : "year";
}

const NOT_ELIGIBLE: Record<Eligibility["reason"], MessageKey> = {
  // "ok" never pairs with can_purchase=false; the web line is the safe fallback.
  ok: "upgrade.label.managedOnWeb",
  web_subscription: "upgrade.label.managedOnWeb",
  family_member: "upgrade.label.managedByFamily",
  family_payer: "upgrade.label.familyPayer",
  store_other_platform: "upgrade.label.managedByOtherStore",
};

export function notEligibleKey(reason: Eligibility["reason"]): MessageKey {
  return NOT_ELIGIBLE[reason];
}
