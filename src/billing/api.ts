import { Platform } from "react-native";
import { apiRequest } from "@/api";

export type StoreStatus = {
  provider: "apple" | "google";
  plan_id: string;
  product_id: string;
  expires_at: number | null;
  grace_until: number | null;
  will_renew: boolean;
  period_type: string;
  environment: "production" | "sandbox";
  conflict: boolean;
  manage_url: string;
} | null;

export type Eligibility = {
  can_purchase: boolean;
  reason: "ok" | "web_subscription" | "family_member" | "family_payer" | "store_other_platform";
  current_plan: { id: string; name: string };
};

export type CatalogPlan = {
  id: string;
  name: string;
  storage_bytes: number;
  /** Server-formatted size ("1 TB"); the catalog sends it, older responses may not. */
  storage_label?: string;
  features: string[];
  /** The live catalog returns only active plans and omits this flag; absent means active. */
  active?: boolean;
  sort_order?: number;
  /** Smart Search limits; null or absent when the plan has no Smart Search. */
  ai_images_max?: number | null;
  ai_documents_max?: number | null;
};

export type CouponCheck = {
  ok: boolean;
  platforms: string[];
  store_code: string | null;
  store_terms: string | null;
  error?: string;
};

const platform = (): "ios" | "android" => (Platform.OS === "ios" ? "ios" : "android");

export function getEligibility(): Promise<Eligibility> {
  return apiRequest<Eligibility>(`/api/billing/store/eligibility?platform=${platform()}`);
}

export async function getCatalogPlans(): Promise<CatalogPlan[]> {
  const res = await apiRequest<{ plans: CatalogPlan[] }>("/api/billing/catalog");
  return res.plans;
}

export function refreshStore(): Promise<{ store: StoreStatus; plan: { id: string; name: string } }> {
  return apiRequest("/api/billing/store/refresh", { method: "POST" });
}

export function validateCode(code: string): Promise<CouponCheck> {
  return apiRequest<CouponCheck>("/api/billing/coupon/validate", {
    method: "POST",
    body: { code, platform: platform() },
  });
}

export async function getStoreStatus(): Promise<StoreStatus> {
  const res = await apiRequest<{ store?: StoreStatus }>("/api/billing/status");
  return res.store ?? null;
}
