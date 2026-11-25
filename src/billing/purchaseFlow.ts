import { Platform } from "react-native";
import { PURCHASES_ERROR_CODE, type PurchasesPackage } from "react-native-purchases";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import { ME_KEY } from "@/profile/hooks";
import { refreshStore } from "./api";
import { awaitPlanActivation, ELIGIBILITY_KEY, STORE_STATUS_KEY } from "./hooks";
import { identifyBilling, purchase, restore } from "./revenuecat";

/**
 * Purchase and restore, as plain async steps that report a state. No React:
 * the screen hands in a setter, tests hand in fake deps. We never grant a plan
 * locally; "active" only follows the server reporting the plan.
 */

export type FlowState =
  | "idle" | "paying" | "confirming" | "active" | "pending" | "cancelled" | "failed" | "timeout" | "other_account";

/** `detail`: the store's message for "failed", the plan name for a restored "active". */
export type SetFlowState = (s: FlowState, detail?: string) => void;

export type FlowDeps = {
  identifyBilling: (userId: string) => Promise<void>;
  purchase: typeof purchase;
  restore: typeof restore;
  refreshStore: typeof refreshStore;
  awaitPlanActivation: (planId: string) => Promise<"active" | "timeout">;
};

const defaultDeps: FlowDeps = {
  identifyBilling,
  purchase,
  restore,
  refreshStore,
  awaitPlanActivation: (planId) => awaitPlanActivation(planId),
};

async function settle(planId: string, setState: SetFlowState, deps: FlowDeps, detail?: string): Promise<void> {
  let outcome: "active" | "timeout";
  try {
    outcome = await deps.awaitPlanActivation(planId);
  } catch {
    outcome = "timeout";
  }
  setState(outcome, outcome === "active" ? detail : undefined);
}

/** Tell RevenueCat who is signed in, and wait for it; false when nobody is or it failed. */
async function identified(userId: string | null | undefined, deps: FlowDeps): Promise<boolean> {
  if (!userId) return false;
  try {
    await deps.identifyBilling(userId);
    return true;
  } catch {
    return false;
  }
}

export async function runPurchase(
  pkg: PurchasesPackage,
  planId: string,
  userId: string | null | undefined,
  setState: SetFlowState,
  deps: FlowDeps = defaultDeps,
): Promise<void> {
  // A purchase made under RevenueCat's anonymous id would belong to no dosya
  // account, so nobody buys before we have told RevenueCat who they are.
  if (!userId) {
    setState("failed");
    return;
  }
  setState("paying");
  if (!(await identified(userId, deps))) {
    setState("failed");
    return;
  }
  const result = await deps.purchase(pkg);
  if (!result.ok) {
    if (result.cancelled) setState("cancelled");
    else if (result.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) setState("pending");
    // The store account's subscription already belongs to another dosya account.
    else if (result.code === String(PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR)) setState("other_account");
    else setState("failed", result.message);
    return;
  }
  setState("confirming");
  await settle(planId, setState, deps);
}

/**
 * Restore, then ask the server what this account now has. RevenueCat keeps a
 * purchase with the account that bought it ("Keep with original App User ID")
 * and says so with RECEIPT_ALREADY_IN_USE.
 */
export async function runRestore(
  currentPlanId: string,
  userId: string | null | undefined,
  setState: SetFlowState,
  deps: FlowDeps = defaultDeps,
): Promise<void> {
  // Restoring under RevenueCat's anonymous id would attach an unused receipt
  // to no dosya account, and make the rightful owner's receipt look foreign.
  if (!(await identified(userId, deps))) {
    setState("failed");
    return;
  }
  const restored = await deps.restore();
  if (!restored.ok) {
    if (restored.code === String(PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR)) setState("other_account");
    else setState("failed", restored.message);
    return;
  }
  setState("confirming");
  let refreshed: Awaited<ReturnType<typeof refreshStore>>;
  try {
    refreshed = await deps.refreshStore();
  } catch {
    // 429 / 5xx / offline: the store restored, but we cannot tell the plan
    // yet. The timeout state says we're still on it and offers support.
    setState("timeout");
    return;
  }
  const { store, plan } = refreshed;
  if (plan.id !== currentPlanId) {
    await settle(plan.id, setState, deps, plan.name);
  } else if (store !== null) {
    // This account already holds the subscription; nothing to change.
    setState("active", plan.name);
  } else {
    const storeName = Platform.OS === "android" ? "Google Play" : "App Store";
    setState("failed", t("upgrade.status.nothingToRestore", { store: storeName }));
  }
}

export type PlanChange = { outcome: "changed"; planName: string } | { outcome: "unchanged" };

export type PlanChangeDeps = {
  refreshStore: typeof refreshStore;
  invalidate: (queryKey: readonly string[]) => unknown;
};

const defaultPlanChangeDeps: PlanChangeDeps = {
  refreshStore,
  invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
};

/**
 * After the App Store's redeem sheet closes. The sheet tells us nothing (it
 * resolves the same way whether a code was redeemed or the user cancelled),
 * so we ask the server once whether the plan moved. Any failure reads as
 * "unchanged": we say nothing rather than guess, and the webhook still lands.
 */
export async function checkForPlanChange(
  previousPlanId: string,
  deps: PlanChangeDeps = defaultPlanChangeDeps,
): Promise<PlanChange> {
  let plan: { id: string; name: string };
  try {
    ({ plan } = await deps.refreshStore());
  } catch {
    return { outcome: "unchanged" };
  }
  if (plan.id === previousPlanId) return { outcome: "unchanged" };
  void deps.invalidate(ME_KEY);
  void deps.invalidate(ELIGIBILITY_KEY);
  void deps.invalidate(STORE_STATUS_KEY);
  return { outcome: "changed", planName: plan.name };
}
