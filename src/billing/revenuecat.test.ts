const mockExtra: { revenueCat?: { ios?: string; android?: string }; distributionChannel?: string } = {};
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { get expoConfig() { return { extra: mockExtra }; } },
}));

import { Platform } from "react-native";
import { PURCHASES_ERROR_CODE } from "react-native-purchases";

type Billing = typeof import("./revenuecat");
// The module registry is reset per load(), so the SDK mock the wrapper sees is
// a fresh instance; keep a handle on that one.
let Purchases: typeof import("react-native-purchases").default;

function load(os: "ios" | "android", extra: typeof mockExtra): Billing {
  Platform.OS = os;
  mockExtra.revenueCat = extra.revenueCat;
  mockExtra.distributionChannel = extra.distributionChannel;
  let mod!: Billing;
  jest.isolateModules(() => {
    Purchases = require("react-native-purchases").default;
    mod = require("./revenuecat");
  });
  return mod;
}


describe("storeBillingAvailable", () => {
  it("is false on the direct Android channel even with a key", () => {
    const b = load("android", { revenueCat: { android: "goog_x" }, distributionChannel: "direct" });
    expect(b.storeBillingAvailable()).toBe(false);
  });
  it("is false when the key for this platform is empty", () => {
    const b = load("ios", { revenueCat: { ios: "", android: "goog_x" } });
    expect(b.storeBillingAvailable()).toBe(false);
  });
  it("is true on iOS and on Play Android with a key", () => {
    expect(load("ios", { revenueCat: { ios: "appl_x" } }).storeBillingAvailable()).toBe(true);
    expect(load("android", { revenueCat: { android: "goog_x" }, distributionChannel: "play" }).storeBillingAvailable()).toBe(true);
  });
});

describe("configureBilling", () => {
  it("configures once, anonymously, however often it is called", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    await b.configureBilling();
    await b.configureBilling();
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "appl_x", appUserID: undefined }));
  });
  it("does nothing when unavailable", async () => {
    const b = load("ios", { revenueCat: { ios: "" } });
    await b.configureBilling();
    expect(Purchases.configure).not.toHaveBeenCalled();
  });
});

describe("identity", () => {
  it("logIn and logOut go through when configured", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    await b.identifyBilling("u1");
    await b.resetBilling();
    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.logIn).toHaveBeenCalledWith("u1");
    expect(Purchases.logOut).toHaveBeenCalledTimes(1);
  });
  it("resetBilling ignores an already-anonymous error", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.logOut as jest.Mock).mockRejectedValueOnce(new Error("Called logOut but current user is anonymous"));
    await expect(b.resetBilling()).resolves.toBeUndefined();
  });
  it("is a no-op when unavailable", async () => {
    const b = load("ios", { revenueCat: { ios: "" } });
    await b.identifyBilling("u1");
    await b.resetBilling();
    expect(Purchases.logIn).not.toHaveBeenCalled();
    expect(Purchases.logOut).not.toHaveBeenCalled();
  });
});

describe("fetchOfferings", () => {
  it("returns [] when unavailable", async () => {
    const b = load("android", { revenueCat: { android: "goog_x" }, distributionChannel: "direct" });
    expect(await b.fetchOfferings()).toEqual([]);
    expect(Purchases.getOfferings).not.toHaveBeenCalled();
  });
  it("returns the current offering's packages", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    const pkgs = [{ identifier: "a" }, { identifier: "b" }];
    (Purchases.getOfferings as jest.Mock).mockResolvedValueOnce({ current: { availablePackages: pkgs }, all: {} });
    expect(await b.fetchOfferings()).toEqual(pkgs);
  });
  it("returns [] when the SDK throws", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.getOfferings as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    expect(await b.fetchOfferings()).toEqual([]);
  });
});

describe("purchase", () => {
  const pkg = { identifier: "p" } as never;
  it("succeeds", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    expect(await b.purchase(pkg)).toEqual({ ok: true });
  });
  it("maps userCancelled to cancelled", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.purchasePackage as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("cancelled"), { userCancelled: true }));
    expect(await b.purchase(pkg)).toMatchObject({ ok: false, cancelled: true, message: "cancelled" });
  });
  it("maps the cancelled code to cancelled", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.purchasePackage as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("c"), { code: PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR }));
    expect(await b.purchase(pkg)).toMatchObject({ ok: false, cancelled: true });
  });
  it("exposes the pending code on other failures", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.purchasePackage as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("pending"), { code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR }));
    expect(await b.purchase(pkg)).toEqual({ ok: false, cancelled: false, message: "pending", code: PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR });
  });
});

describe("restore and code redemption", () => {
  it("restore reports failure", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    expect(await b.restore()).toEqual({ ok: true });
    (Purchases.restorePurchases as jest.Mock).mockRejectedValueOnce(new Error("nope"));
    expect(await b.restore()).toEqual({ ok: false, message: "nope" });
  });
  it("restore exposes the store's error code", async () => {
    const b = load("ios", { revenueCat: { ios: "appl_x" } });
    (Purchases.restorePurchases as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("in use"), { code: "7" }));
    expect(await b.restore()).toEqual({ ok: false, message: "in use", code: "7" });
  });
  it("code sheet is iOS only", async () => {
    await load("android", { revenueCat: { android: "goog_x" } }).presentCodeRedemption();
    expect(Purchases.presentCodeRedemptionSheet).not.toHaveBeenCalled();
    await load("ios", { revenueCat: { ios: "appl_x" } }).presentCodeRedemption();
    expect(Purchases.presentCodeRedemptionSheet).toHaveBeenCalledTimes(1);
  });
});
