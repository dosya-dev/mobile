import { apiRequest, setTokenProvider, setRefreshHandler } from "./client";
import { useMaintenanceStore } from "@/ui/maintenanceStore";

function mockFetchOnce(status: number, body: unknown) {
  (globalThis as any).fetch = jest.fn(async () => ({
    status,
    ok: status < 400,
    headers: new Headers(),
    json: async () => body,
  }));
}

describe("apiRequest maintenance gate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setRefreshHandler(null);
    setTokenProvider(() => null);
    useMaintenanceStore.setState({ maintenance: null });
  });

  it("rejects with ApiError (503, surface_disabled) and records the maintenance state", async () => {
    mockFetchOnce(503, { ok: false, code: "surface_disabled", surface: "mobile", message: "brb" });

    await expect(apiRequest("/api/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "surface_disabled",
    });
    expect(useMaintenanceStore.getState().maintenance).toEqual({ surface: "mobile", message: "brb" });
  });

  it("records a null message when the server sends none", async () => {
    mockFetchOnce(503, { ok: false, code: "surface_disabled", surface: "mobile", message: null });

    await expect(apiRequest("/api/me")).rejects.toMatchObject({ status: 503, code: "surface_disabled" });
    expect(useMaintenanceStore.getState().maintenance).toEqual({ surface: "mobile", message: null });
  });

  it("does not touch the maintenance store for a 503 without the surface_disabled code", async () => {
    mockFetchOnce(503, { ok: false, error: "Service unavailable" });

    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ status: 503 });
    expect(useMaintenanceStore.getState().maintenance).toBeNull();
  });

  it("does not touch the maintenance store on an unrelated error", async () => {
    mockFetchOnce(401, { ok: false, error: "Invalid or expired API key" });

    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ status: 401 });
    expect(useMaintenanceStore.getState().maintenance).toBeNull();
  });
});
