import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/api/errors";
import { ME_KEY } from "@/profile/hooks";
import { getMe } from "@/profile/api";
import { queryClient } from "@/lib/queryClient";
import * as api from "./api";
import {
  ELIGIBILITY_KEY, STORE_STATUS_KEY, useEligibility, useCatalogPlans, useStoreStatus, awaitPlanActivation,
} from "./hooks";

jest.mock("./api");
jest.mock("@/profile/api", () => ({ getMe: jest.fn() }));
jest.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: jest.fn() } }));

const m = api as jest.Mocked<typeof api>;
const me = getMe as jest.Mock;
const invalidate = queryClient.invalidateQueries as jest.Mock;
const sleep = jest.fn(async () => {});
const user = (id: string) => ({ plan: { id, name: id } });

beforeEach(() => {
  jest.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("query hooks", () => {
  it("exports the keys", () => {
    expect(ELIGIBILITY_KEY).toEqual(["store-eligibility"]);
    expect(STORE_STATUS_KEY).toEqual(["store-status"]);
  });
  it("useEligibility / useCatalogPlans / useStoreStatus fetch via the api", async () => {
    m.getEligibility.mockResolvedValue({ can_purchase: true, reason: "ok", current_plan: { id: "free", name: "Free" } });
    m.getCatalogPlans.mockResolvedValue([]);
    m.getStoreStatus.mockResolvedValue(null);
    const a = renderHook(() => useEligibility(), { wrapper });
    const b = renderHook(() => useCatalogPlans(), { wrapper });
    const c = renderHook(() => useStoreStatus(), { wrapper });
    await waitFor(() => expect(a.result.current.data?.can_purchase).toBe(true));
    await waitFor(() => expect(b.result.current.data).toEqual([]));
    await waitFor(() => expect(c.result.current.isSuccess).toBe(true));
    expect(c.result.current.data).toBeNull();
  });
});

describe("awaitPlanActivation", () => {
  it("resolves active on the second poll and invalidates ME_KEY", async () => {
    m.refreshStore.mockResolvedValue({ store: null, plan: { id: "free", name: "Free" } });
    me.mockResolvedValueOnce(user("free")).mockResolvedValueOnce(user("pro"));
    await expect(awaitPlanActivation("pro", { sleep })).resolves.toBe("active");
    expect(m.refreshStore).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_KEY });
  });

  it("times out at the limit without invalidating", async () => {
    m.refreshStore.mockResolvedValue({ store: null, plan: { id: "free", name: "Free" } });
    me.mockResolvedValue(user("free"));
    await expect(awaitPlanActivation("pro", { sleep, timeoutMs: 6000 })).resolves.toBe("timeout");
    expect(me).toHaveBeenCalledTimes(4);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([429, 500])("tolerates a %s from refresh", async (status) => {
    m.refreshStore.mockRejectedValue(new ApiError("nope", status));
    me.mockResolvedValue(user("pro"));
    await expect(awaitPlanActivation("pro", { sleep })).resolves.toBe("active");
    expect(m.refreshStore).toHaveBeenCalledTimes(1);
    expect(me.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("tolerates other refresh errors and a failing poll", async () => {
    m.refreshStore.mockRejectedValue(new Error("network"));
    me.mockRejectedValueOnce(new Error("blip")).mockResolvedValue(user("pro"));
    await expect(awaitPlanActivation("pro", { sleep })).resolves.toBe("active");
    expect(m.refreshStore).toHaveBeenCalledTimes(1);
    expect(me.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("with the default timeout polls at t=0,2,...,14 s (8 polls) then times out", async () => {
    m.refreshStore.mockResolvedValue({ store: null, plan: { id: "free", name: "Free" } });
    me.mockResolvedValue(user("free"));
    await expect(awaitPlanActivation("pro", { sleep })).resolves.toBe("timeout");
    expect(me).toHaveBeenCalledTimes(8);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
