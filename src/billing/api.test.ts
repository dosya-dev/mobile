import { Platform } from "react-native";
import { apiRequest } from "@/api";
import { getEligibility, getCatalogPlans, refreshStore, validateCode, getStoreStatus } from "./api";

jest.mock("@/api", () => ({ apiRequest: jest.fn() }));
const req = apiRequest as jest.Mock;

const originalOS = Platform.OS;
beforeEach(() => req.mockReset());
afterEach(() => { Platform.OS = originalOS; });

describe("getEligibility", () => {
  it.each([["ios", "ios"], ["android", "android"]])("sends platform=%s on %s", async (os, expected) => {
    Platform.OS = os as "ios" | "android";
    const body = { can_purchase: true, reason: "ok", current_plan: { id: "free", name: "Free" } };
    req.mockResolvedValue(body);
    await expect(getEligibility()).resolves.toEqual(body);
    expect(req).toHaveBeenCalledWith(`/api/billing/store/eligibility?platform=${expected}`);
  });
});

describe("getCatalogPlans", () => {
  it("unwraps plans[]", async () => {
    req.mockResolvedValue({ plans: [{ id: "pro", name: "Pro" }] });
    await expect(getCatalogPlans()).resolves.toEqual([{ id: "pro", name: "Pro" }]);
    expect(req).toHaveBeenCalledWith("/api/billing/catalog");
  });
});

describe("refreshStore", () => {
  it("POSTs and returns the body", async () => {
    const body = { store: null, plan: { id: "free", name: "Free" } };
    req.mockResolvedValue(body);
    await expect(refreshStore()).resolves.toEqual(body);
    expect(req).toHaveBeenCalledWith("/api/billing/store/refresh", { method: "POST" });
  });
});

describe("validateCode", () => {
  it("POSTs code and platform", async () => {
    Platform.OS = "ios";
    const body = { ok: true, platforms: ["ios"], store_code: "X", store_terms: null };
    req.mockResolvedValue(body);
    await expect(validateCode("SAVE")).resolves.toEqual(body);
    expect(req).toHaveBeenCalledWith("/api/billing/coupon/validate", {
      method: "POST",
      body: { code: "SAVE", platform: "ios" },
    });
  });
});

describe("getStoreStatus", () => {
  it("returns status.store", async () => {
    req.mockResolvedValue({ store: { provider: "apple" } });
    await expect(getStoreStatus()).resolves.toEqual({ provider: "apple" });
    expect(req).toHaveBeenCalledWith("/api/billing/status");
  });
  it("returns null when absent", async () => {
    req.mockResolvedValue({});
    await expect(getStoreStatus()).resolves.toBeNull();
  });
});
