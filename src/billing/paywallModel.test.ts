import type { PurchasesPackage } from "react-native-purchases";
import type { CatalogPlan } from "./api";
import {
  buildPaywallRows,
  defaultTierIndex,
  featureLines,
  intervalFor,
  notEligibleKey,
  perMonthEquivalent,
  productToPlan,
  stepTier,
  tickLabelIndexes,
  yearlySavingPct,
  type PaywallRow,
} from "./paywallModel";

const pkg = (identifier: string, price: number, priceString: string) =>
  ({ identifier, product: { identifier, price, priceString } }) as unknown as PurchasesPackage;

const plan = (id: string, over: Partial<CatalogPlan> = {}): CatalogPlan => ({
  id, name: id.toUpperCase(), storage_bytes: 1, storage_label: `${id} label`, features: ["f"], active: true, ...over,
});

describe("productToPlan", () => {
  it.each([
    ["dosya_100gb_monthly", "starter", "month"],
    ["dosya_500gb_yearly", "plus", "year"],
    ["dosya_1tb_monthly", "pro", "month"],
    ["dosya_2tb_yearly", "business", "year"],
    ["dosya_4tb_monthly", "tb4", "month"],
    ["dosya_6tb_monthly", "tb6", "month"],
    ["dosya_8tb_monthly", "tb8", "month"],
    ["dosya_10tb_yearly", "tb10", "year"],
    ["dosya_20tb_monthly", "tb20", "month"],
  ])("%s -> %s / %s", (id, planId, interval) => {
    expect(productToPlan(id)).toEqual({ planId, interval });
  });

  it("reads a Play product id that carries the base plan after a colon", () => {
    expect(productToPlan("dosya_1tb_yearly:yearly")).toEqual({ planId: "pro", interval: "year" });
  });

  it.each(["dosya_3tb_monthly", "dosya_1tb_weekly", "other_1tb_monthly", "dosya_1tb", ""])("unknown %p -> null", (id) => {
    expect(productToPlan(id)).toBeNull();
  });
});

describe("yearlySavingPct", () => {
  it("rounds the saving against twelve monthly payments", () => {
    expect(yearlySavingPct(10, 100)).toBe(17);
    expect(yearlySavingPct(9.99, 99.99)).toBe(17);
  });
  it("is null when there is no saving or the yearly price is higher", () => {
    expect(yearlySavingPct(10, 120)).toBeNull();
    expect(yearlySavingPct(10, 130)).toBeNull();
  });
  it("is null for a zero or missing monthly price", () => {
    expect(yearlySavingPct(0, 100)).toBeNull();
    expect(yearlySavingPct(Number.NaN, 100)).toBeNull();
  });
  it("is null when the rounded saving is zero", () => {
    expect(yearlySavingPct(10, 119.5)).toBeNull();
  });
});

describe("buildPaywallRows", () => {
  const m1 = pkg("dosya_1tb_monthly", 10, "$10.00");
  const y1 = pkg("dosya_1tb_yearly", 100, "$100.00");
  const m100 = pkg("dosya_100gb_monthly", 3, "$3.00");

  it("pairs monthly and yearly per plan and computes the saving", () => {
    const rows = buildPaywallRows([plan("pro")], [m1, y1], productToPlan);
    expect(rows).toEqual([
      { planId: "pro", name: "PRO", storageLabel: "pro label", features: ["f"], aiImagesMax: null, aiDocumentsMax: null, monthly: m1, yearly: y1, yearlySavingPct: 17 },
    ]);
  });

  it("has no saving when only one interval is offered", () => {
    const rows = buildPaywallRows([plan("pro")], [m1], productToPlan);
    expect(rows[0]).toMatchObject({ monthly: m1, yearlySavingPct: null });
    expect(rows[0]!.yearly).toBeUndefined();
  });

  it("drops a plan the catalog no longer marks active, even though the store still sells it", () => {
    const rows = buildPaywallRows([plan("pro", { active: false }), plan("starter")], [m1, y1, m100], productToPlan);
    expect(rows.map((r) => r.planId)).toEqual(["starter"]);
  });

  it("drops a store package whose plan is missing from the catalog", () => {
    expect(buildPaywallRows([plan("starter")], [m1, m100], productToPlan).map((r) => r.planId)).toEqual(["starter"]);
  });

  it("drops plans without packages and packages with unknown product ids", () => {
    const odd = pkg("dosya_3tb_monthly", 1, "$1.00");
    expect(buildPaywallRows([plan("pro"), plan("tb3")], [odd], productToPlan)).toEqual([]);
  });

  it("treats a plan without an active flag as active (the catalog only lists live plans)", () => {
    const { active: _drop, ...bare } = plan("pro");
    expect(buildPaywallRows([bare as CatalogPlan], [m1], productToPlan)).toHaveLength(1);
  });

  it("sorts by sort_order, keeping catalog order where it is absent", () => {
    const rows = buildPaywallRows(
      [plan("pro", { sort_order: 2 }), plan("starter", { sort_order: 1 })],
      [m1, m100],
      productToPlan,
    );
    expect(rows.map((r) => r.planId)).toEqual(["starter", "pro"]);
    expect(buildPaywallRows([plan("pro"), plan("starter")], [m100, m1], productToPlan).map((r) => r.planId)).toEqual(["pro", "starter"]);
  });

  it("carries the catalog's Smart Search limits", () => {
    const rows = buildPaywallRows([plan("pro", { ai_images_max: 50000, ai_documents_max: 10000 })], [m1], productToPlan);
    expect(rows[0]).toMatchObject({ aiImagesMax: 50000, aiDocumentsMax: 10000 });
  });
});

describe("perMonthEquivalent", () => {
  it("divides the store's yearly price by twelve in the store's currency", () => {
    expect(perMonthEquivalent(120, "USD", "en-US")).toBe("$10.00");
    expect(perMonthEquivalent(99.99, "USD", "en-US")).toBe("$8.33");
  });
  it("is null for a missing price or an unknown currency", () => {
    expect(perMonthEquivalent(Number.NaN, "USD", "en-US")).toBeNull();
    expect(perMonthEquivalent(0, "USD", "en-US")).toBeNull();
    expect(perMonthEquivalent(120, "", "en-US")).toBeNull();
    expect(perMonthEquivalent(120, "not a currency", "en-US")).toBeNull();
  });
});

describe("featureLines", () => {
  const row = (over: Partial<PaywallRow> = {}): PaywallRow => ({
    planId: "pro", name: "Pro", storageLabel: "1 TB", features: [], aiImagesMax: null, aiDocumentsMax: null, yearlySavingPct: null, ...over,
  });
  const keys = (r: PaywallRow) => featureLines(r, "en-US").map((l) => l.key);

  it("storage, devices and support for a plan without extras", () => {
    expect(featureLines(row(), "en-US")).toEqual([
      { key: "upgrade.feature.encryptedStorage", params: { storage: "1 TB" } },
      { key: "upgrade.feature.allDevices" },
      { key: "upgrade.feature.prioritySupport" },
    ]);
  });
  it("Smart Search with the catalog's limits, formatted, when the plan has ai_search", () => {
    const lines = featureLines(row({ features: ["ai_search"], aiImagesMax: 50000, aiDocumentsMax: 10000 }), "en-US");
    expect(lines[2]).toEqual({ key: "upgrade.feature.smartSearch", params: { images: "50,000", documents: "10,000" } });
    expect(lines).toHaveLength(4);
  });
  it("no Smart Search line when the catalog sent no limits", () => {
    expect(keys(row({ features: ["ai_search"] }))).not.toContain("upgrade.feature.smartSearch");
  });
  it("own branding when the plan has white_label", () => {
    expect(keys(row({ features: ["white_label"] }))).toEqual([
      "upgrade.feature.encryptedStorage", "upgrade.feature.allDevices", "upgrade.feature.whiteLabel", "upgrade.feature.prioritySupport",
    ]);
  });
  it("never more than four lines: Smart Search wins over branding", () => {
    expect(keys(row({ features: ["ai_search", "white_label"], aiImagesMax: 1, aiDocumentsMax: 1 }))).toEqual([
      "upgrade.feature.encryptedStorage", "upgrade.feature.allDevices", "upgrade.feature.smartSearch", "upgrade.feature.prioritySupport",
    ]);
  });
});

describe("tier navigation", () => {
  it("stepTier moves one tier and stops at both ends", () => {
    expect(stepTier(0, -1, 9)).toBe(0);
    expect(stepTier(0, 1, 9)).toBe(1);
    expect(stepTier(8, 1, 9)).toBe(8);
    expect(stepTier(4, -1, 9)).toBe(3);
  });
  it("tickLabelIndexes: first, 1 TB (2), 4 TB (4) and last, without repeats or gaps past the end", () => {
    expect(tickLabelIndexes(9)).toEqual([0, 2, 4, 8]);
    expect(tickLabelIndexes(5)).toEqual([0, 2, 4]);
    expect(tickLabelIndexes(3)).toEqual([0, 2]);
    expect(tickLabelIndexes(1)).toEqual([0]);
    expect(tickLabelIndexes(0)).toEqual([]);
  });
  it("defaultTierIndex is the first tier sold yearly, else the first", () => {
    const m = pkg("dosya_100gb_monthly", 3, "$3.00");
    const y = pkg("dosya_1tb_yearly", 100, "$100.00");
    const base = { name: "", storageLabel: "", features: [], aiImagesMax: null, aiDocumentsMax: null, yearlySavingPct: null };
    expect(defaultTierIndex([{ ...base, planId: "a", monthly: m }, { ...base, planId: "b", yearly: y }])).toBe(1);
    expect(defaultTierIndex([{ ...base, planId: "a", monthly: m }])).toBe(0);
  });
  it("intervalFor keeps the wanted period when the tier sells it, else the one it has", () => {
    const m = pkg("dosya_100gb_monthly", 3, "$3.00");
    const y = pkg("dosya_100gb_yearly", 30, "$30.00");
    const base = { planId: "a", name: "", storageLabel: "", features: [], aiImagesMax: null, aiDocumentsMax: null, yearlySavingPct: null };
    expect(intervalFor({ ...base, monthly: m, yearly: y }, "year")).toBe("year");
    expect(intervalFor({ ...base, monthly: m, yearly: y }, "month")).toBe("month");
    expect(intervalFor({ ...base, monthly: m }, "year")).toBe("month");
    expect(intervalFor({ ...base, yearly: y }, "month")).toBe("year");
  });
});

describe("notEligibleKey", () => {
  it.each([
    ["web_subscription", "upgrade.label.managedOnWeb"],
    ["family_member", "upgrade.label.managedByFamily"],
    ["family_payer", "upgrade.label.familyPayer"],
    ["store_other_platform", "upgrade.label.managedByOtherStore"],
  ] as const)("%s -> %s", (reason, key) => {
    expect(notEligibleKey(reason)).toBe(key);
  });
});
