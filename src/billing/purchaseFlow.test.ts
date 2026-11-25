import { Platform } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { ApiError } from "@/api/errors";
import { getMe } from "@/profile/api";
import { refreshStore } from "./api";
import { awaitPlanActivation } from "./hooks";
import { checkForPlanChange, runPurchase, runRestore, type FlowDeps, type FlowState } from "./purchaseFlow";

jest.mock("./api", () => ({ refreshStore: jest.fn() }));
jest.mock("@/profile/api", () => ({ getMe: jest.fn() }));
jest.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));

const PKG = { identifier: "dosya_1tb_yearly" } as unknown as PurchasesPackage;
const PRO = { id: "pro", name: "Pro" };
const FREE = { id: "free", name: "Free" };
const STORE = { provider: "apple", plan_id: "pro" } as never;

function recorder() {
  const states: Array<[FlowState, string | undefined]> = [];
  const setState = (s: FlowState, detail?: string) => { states.push([s, detail]); };
  return { states, setState, names: () => states.map(([s]) => s) };
}

function deps(over: Partial<FlowDeps> = {}): FlowDeps {
  return {
    identifyBilling: jest.fn(async () => {}),
    purchase: jest.fn(async () => ({ ok: true as const })),
    restore: jest.fn(async () => ({ ok: true })),
    refreshStore: jest.fn(async () => ({ store: STORE, plan: PRO })),
    awaitPlanActivation: jest.fn(async () => "active" as const),
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("runPurchase", () => {
  it("success: paying -> confirming -> active, waiting for the bought plan", async () => {
    const r = recorder();
    const d = deps();
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.names()).toEqual(["paying", "confirming", "active"]);
    expect(d.purchase).toHaveBeenCalledWith(PKG);
    expect(d.awaitPlanActivation).toHaveBeenCalledWith("pro");
  });

  it("identifies the signed-in user with RevenueCat, and waits for it, before buying", async () => {
    const order: string[] = [];
    let finishIdentify: () => void = () => {};
    const d = deps({
      identifyBilling: jest.fn(() => new Promise<void>((res) => { finishIdentify = () => { order.push("identified"); res(); }; })),
      purchase: jest.fn(async () => { order.push("purchase"); return { ok: true as const }; }),
    });
    const run = runPurchase(PKG, "pro", "u1", recorder().setState, d);
    await Promise.resolve();
    expect(d.identifyBilling).toHaveBeenCalledWith("u1");
    expect(d.purchase).not.toHaveBeenCalled();
    finishIdentify();
    await run;
    expect(order).toEqual(["identified", "purchase"]);
  });

  it("no signed-in user: failed, never opens the store (anonymous ids never buy)", async () => {
    const r = recorder();
    const d = deps();
    await runPurchase(PKG, "pro", undefined, r.setState, d);
    expect(r.states).toEqual([["failed", undefined]]);
    expect(d.identifyBilling).not.toHaveBeenCalled();
    expect(d.purchase).not.toHaveBeenCalled();
  });

  it("identify throws: failed, never opens the store", async () => {
    const r = recorder();
    const d = deps({ identifyBilling: jest.fn(async () => { throw new Error("rc down"); }) });
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.states).toEqual([["paying", undefined], ["failed", undefined]]);
    expect(d.purchase).not.toHaveBeenCalled();
  });

  it("user cancelled: paying -> cancelled, no detail", async () => {
    const r = recorder();
    const d = deps({ purchase: jest.fn(async () => ({ ok: false as const, cancelled: true, message: "Purchase was cancelled.", code: "1" })) });
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.states).toEqual([["paying", undefined], ["cancelled", undefined]]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });

  it("payment pending (Ask to Buy): paying -> pending", async () => {
    const r = recorder();
    // RevenueCat's PAYMENT_PENDING_ERROR code ("20" in the real enum).
    const d = deps({ purchase: jest.fn(async () => ({ ok: false as const, cancelled: false, message: "pending", code: "20" })) });
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.names()).toEqual(["paying", "pending"]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });

  it("receipt owned by another app user id (RECEIPT_ALREADY_IN_USE): paying -> other_account", async () => {
    const r = recorder();
    const d = deps({ purchase: jest.fn(async () => ({ ok: false as const, cancelled: false, message: "in use", code: "7" })) });
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.states).toEqual([["paying", undefined], ["other_account", undefined]]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });

  it("store error: paying -> failed with the store's message", async () => {
    const r = recorder();
    const d = deps({ purchase: jest.fn(async () => ({ ok: false as const, cancelled: false, message: "The App Store is unavailable.", code: "2" })) });
    await runPurchase(PKG, "pro", "u1", r.setState, d);
    expect(r.states).toEqual([["paying", undefined], ["failed", "The App Store is unavailable."]]);
  });

  it("activation does not land in time: paying -> confirming -> timeout", async () => {
    const r = recorder();
    await runPurchase(PKG, "pro", "u1", r.setState, deps({ awaitPlanActivation: jest.fn(async () => "timeout" as const) }));
    expect(r.names()).toEqual(["paying", "confirming", "timeout"]);
  });

  it("a 429 from the store refresh keeps polling and still reaches active", async () => {
    (refreshStore as jest.Mock).mockRejectedValue(new ApiError("Too many requests", 429));
    (getMe as jest.Mock).mockResolvedValueOnce({ plan: FREE }).mockResolvedValue({ plan: PRO });
    const r = recorder();
    const sleep = jest.fn(async () => {});
    await runPurchase(PKG, "pro", "u1", r.setState, deps({ awaitPlanActivation: (id) => awaitPlanActivation(id, { sleep }) }));
    expect(refreshStore).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(r.names()).toEqual(["paying", "confirming", "active"]);
  });
});

describe("runRestore", () => {
  it("identifies the signed-in user with RevenueCat, and waits for it, before restoring", async () => {
    const order: string[] = [];
    let finishIdentify: () => void = () => {};
    const d = deps({
      identifyBilling: jest.fn(() => new Promise<void>((res) => { finishIdentify = () => { order.push("identified"); res(); }; })),
      restore: jest.fn(async () => { order.push("restore"); return { ok: true }; }),
    });
    const run = runRestore("free", "u1", recorder().setState, d);
    await Promise.resolve();
    expect(d.identifyBilling).toHaveBeenCalledWith("u1");
    expect(d.restore).not.toHaveBeenCalled();
    finishIdentify();
    await run;
    expect(order).toEqual(["identified", "restore"]);
  });

  it("no signed-in user: failed, never restores under an anonymous id", async () => {
    const r = recorder();
    const d = deps();
    await runRestore("free", undefined, r.setState, d);
    expect(r.states).toEqual([["failed", undefined]]);
    expect(d.identifyBilling).not.toHaveBeenCalled();
    expect(d.restore).not.toHaveBeenCalled();
  });

  it("identify throws: failed, never restores", async () => {
    const r = recorder();
    const d = deps({ identifyBilling: jest.fn(async () => { throw new Error("rc down"); }) });
    await runRestore("free", "u1", r.setState, d);
    expect(r.states).toEqual([["failed", undefined]]);
    expect(d.restore).not.toHaveBeenCalled();
  });

  it("restored a purchase for this account: confirming -> active with the plan name", async () => {
    const r = recorder();
    const d = deps({ refreshStore: jest.fn(async () => ({ store: STORE, plan: PRO })) });
    await runRestore("free", "u1", r.setState, d);
    expect(r.states).toEqual([["confirming", undefined], ["active", "Pro"]]);
    expect(d.awaitPlanActivation).toHaveBeenCalledWith("pro");
  });

  it("receipt owned by another app user id (RECEIPT_ALREADY_IN_USE): other_account, no refresh", async () => {
    const r = recorder();
    const d = deps({ restore: jest.fn(async () => ({ ok: false, message: "in use", code: "7" })) });
    await runRestore("free", "u1", r.setState, d);
    expect(r.states).toEqual([["other_account", undefined]]);
    expect(d.refreshStore).not.toHaveBeenCalled();
  });

  it("plan unchanged and the account holds the store subscription: active with the current plan", async () => {
    const r = recorder();
    const d = deps({ refreshStore: jest.fn(async () => ({ store: STORE, plan: PRO })) });
    await runRestore("pro", "u1", r.setState, d);
    expect(r.states).toEqual([["confirming", undefined], ["active", "Pro"]]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });

  it("plan unchanged and no store record: failed, nothing to restore", async () => {
    const r = recorder();
    const d = deps({ refreshStore: jest.fn(async () => ({ store: null, plan: FREE })) });
    await runRestore("free", "u1", r.setState, d);
    const store = Platform.OS === "android" ? "Google Play" : "App Store";
    expect(r.states).toEqual([["confirming", undefined], ["failed", `We found no purchases to restore for this ${store} account.`]]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });

  it("activation does not land in time: confirming -> timeout", async () => {
    const r = recorder();
    await runRestore("free", "u1", r.setState, deps({ awaitPlanActivation: jest.fn(async () => "timeout" as const) }));
    expect(r.names()).toEqual(["confirming", "timeout"]);
  });

  it("restore fails: failed with the store's message, no refresh", async () => {
    const r = recorder();
    const d = deps({ restore: jest.fn(async () => ({ ok: false, message: "Could not connect to the App Store." })) });
    await runRestore("free", "u1", r.setState, d);
    expect(r.states).toEqual([["failed", "Could not connect to the App Store."]]);
    expect(d.refreshStore).not.toHaveBeenCalled();
  });

  it("refresh rate-limited after a restore: timeout (support offered), never a guessed plan", async () => {
    const r = recorder();
    const d = deps({ refreshStore: jest.fn(async () => { throw new ApiError("Too many requests", 429); }) });
    await runRestore("free", "u1", r.setState, d);
    expect(r.states).toEqual([["confirming", undefined], ["timeout", undefined]]);
    expect(d.awaitPlanActivation).not.toHaveBeenCalled();
  });
});

describe("checkForPlanChange (after the App Store's redeem sheet)", () => {
  it("plan changed: invalidates me, eligibility and store status, reports the new plan", async () => {
    const invalidate = jest.fn();
    const out = await checkForPlanChange("free", { refreshStore: jest.fn(async () => ({ store: STORE, plan: PRO })), invalidate });
    expect(out).toEqual({ outcome: "changed", planName: "Pro" });
    expect(invalidate.mock.calls.map(([k]) => k)).toEqual([["me"], ["store-eligibility"], ["store-status"]]);
  });

  it("plan unchanged (redemption cancelled): unchanged, nothing invalidated", async () => {
    const invalidate = jest.fn();
    const out = await checkForPlanChange("free", { refreshStore: jest.fn(async () => ({ store: null, plan: FREE })), invalidate });
    expect(out).toEqual({ outcome: "unchanged" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refresh fails: unchanged, never a guessed plan", async () => {
    const invalidate = jest.fn();
    const out = await checkForPlanChange("free", { refreshStore: jest.fn(async () => { throw new ApiError("Too many requests", 429); }), invalidate });
    expect(out).toEqual({ outcome: "unchanged" });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
