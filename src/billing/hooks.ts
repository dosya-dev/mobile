import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { queryClient } from "@/lib/queryClient";
import { getMe } from "@/profile/api";
import { ME_KEY } from "@/profile/hooks";
import { getEligibility, getCatalogPlans, getStoreStatus, refreshStore } from "./api";
import { fetchOfferings } from "./revenuecat";

export const ELIGIBILITY_KEY = ["store-eligibility"] as const;
export const CATALOG_KEY = ["billing-catalog"] as const;
export const STORE_STATUS_KEY = ["store-status"] as const;
export const OFFERINGS_KEY = ["store-offerings"] as const;

export function useEligibility() {
  return useQuery({ queryKey: ELIGIBILITY_KEY, queryFn: getEligibility, staleTime: 15_000 });
}

export function useCatalogPlans() {
  return useQuery({ queryKey: CATALOG_KEY, queryFn: getCatalogPlans, staleTime: 5 * 60_000 });
}

export function useStoreStatus() {
  return useQuery({ queryKey: STORE_STATUS_KEY, queryFn: getStoreStatus, staleTime: 15_000 });
}

/** The store's packages for the current offering; empty when the store could not be reached. */
export function useOfferings() {
  return useQuery({ queryKey: OFFERINGS_KEY, queryFn: fetchOfferings, staleTime: 5 * 60_000 });
}

const POLL_MS = 2000;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * After a store purchase the entitlement reaches our DB via RevenueCat's webhook, which
 * can lag. Ask the server to pull the state once (a 429 / 5xx / any failure just means
 * we fall back to waiting for the webhook), then poll /api/me until the plan flips.
 */
export async function awaitPlanActivation(
  expectedPlanId: string,
  opts: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<"active" | "timeout"> {
  const { timeoutMs = 15000, sleep = defaultSleep } = opts;
  try {
    await refreshStore();
  } catch (e) {
    const isTransient = e instanceof ApiError && (e.status === 429 || e.status >= 500);
    if (!isTransient) {
      console.warn("[billing] store refresh failed", e);
    }
  }
  // The last poll may land exactly on the timeout boundary.
  for (let elapsed = 0; ; elapsed += POLL_MS) {
    try {
      const user = await getMe();
      if (user.plan?.id === expectedPlanId) {
        await queryClient.invalidateQueries({ queryKey: ME_KEY });
        return "active";
      }
    } catch {
      // a failed poll is just a missed tick
    }
    if (elapsed + POLL_MS > timeoutMs) return "timeout";
    await sleep(POLL_MS);
  }
}
