import { apiRequest } from "./client";
import { DEVICE_ID_HEADER, ensureDeviceId, __resetDeviceId } from "@/lib/deviceId";

const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "3f1a9c5e-3b6e-4a0e-9a2b-9d1f8a2c7e41") }));

function spyFetch() {
  const spy = jest.fn(async (_url: string, _init: { headers: Record<string, string> }) => ({
    status: 200, ok: true, headers: new Headers(), json: async () => ({ ok: true }),
  }));
  (globalThis as unknown as { fetch: unknown }).fetch = spy;
  return spy;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  __resetDeviceId();
});

describe("the device header on mobile requests", () => {
  it("travels once the id has resolved", async () => {
    const id = await ensureDeviceId();
    const spy = spyFetch();
    await apiRequest("/api/backup/alert", { method: "POST", body: {} });
    expect(spy.mock.calls[0][1].headers[DEVICE_ID_HEADER]).toBe(id);
  });

  /**
   * Omitted, never blank. `parseDeviceId` on the server ignores a value that
   * fails its shape check, so an empty header would be no better than none -
   * but a request that carries one is a request the server has to reason
   * about, and there is nothing to reason about here.
   */
  it("is absent, not empty, before the id has resolved", async () => {
    const spy = spyFetch();
    await apiRequest("/api/files");
    expect(DEVICE_ID_HEADER in spy.mock.calls[0][1].headers).toBe(false);
  });
});
