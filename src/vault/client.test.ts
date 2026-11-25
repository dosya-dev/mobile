jest.mock("@/auth/authStore", () => ({
  getAccessToken: jest.fn(() => "dosm_token1"),
  refreshSession: jest.fn(async () => "refreshed"),
}));
jest.mock("@/lib/deviceId", () => ({ DEVICE_ID_HEADER: "X-Dosya-Device", currentDeviceId: () => "dev-1" }));

import { getAccessToken, refreshSession } from "@/auth/authStore";
import { authedFetch, chunkFetch, buildVaultClient, __setVaultFetchForTests, CHUNK_RETRY_DELAYS_MS } from "./client";

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (code: number) => new Response("", { status: code });

describe("authedFetch", () => {
  afterEach(() => {
    __setVaultFetchForTests(null);
    (getAccessToken as jest.Mock).mockImplementation(() => "dosm_token1");
    (refreshSession as jest.Mock).mockImplementation(async () => "refreshed");
    jest.clearAllMocks();
  });

  it("sends the bearer token and the device header", async () => {
    const seen: RequestInit[] = [];
    __setVaultFetchForTests(async (_u, init) => { seen.push(init ?? {}); return ok(); });
    await authedFetch("https://api.test/x", { method: "POST" });
    const headers = seen[0].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer dosm_token1");
    expect(headers["X-Dosya-Device"]).toBe("dev-1");
  });

  it("refreshes once on 401 and retries with the new token; a second 401 is returned as is", async () => {
    (getAccessToken as jest.Mock).mockReturnValueOnce("old").mockReturnValue("new");
    const tokens: string[] = [];
    let calls = 0;
    __setVaultFetchForTests(async (_u, init) => {
      calls += 1;
      tokens.push((init?.headers as Record<string, string>).Authorization);
      return calls === 1 ? status(401) : ok();
    });
    const res = await authedFetch("https://api.test/x");
    expect(res.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(["Bearer old", "Bearer new"]);

    (refreshSession as jest.Mock).mockResolvedValueOnce("rejected");
    __setVaultFetchForTests(async () => status(401));
    expect((await authedFetch("https://api.test/y")).status).toBe(401);
  });

  it("surfaces a 401 whose refresh never reached the server as a network failure", async () => {
    (refreshSession as jest.Mock).mockResolvedValueOnce("unavailable");
    __setVaultFetchForTests(async () => status(401));
    await expect(authedFetch("https://api.test/z")).rejects.toThrow("Network request failed");
  });
});

describe("chunkFetch", () => {
  afterEach(() => __setVaultFetchForTests(null));

  it("retries network errors and 5xx with the documented delays, then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    __setVaultFetchForTests(async () => { calls += 1; if (calls === 1) throw new TypeError("Network request failed"); if (calls === 2) return status(503); return ok(); });
    const res = await chunkFetch("https://r2.test/obj", { method: "PUT", body: new Uint8Array(3) }, async (ms) => { delays.push(ms); });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    expect(delays).toEqual([CHUNK_RETRY_DELAYS_MS[0], CHUNK_RETRY_DELAYS_MS[1]]);
  });

  it("never retries a 4xx (a 403 means the declared length was wrong)", async () => {
    let calls = 0;
    __setVaultFetchForTests(async () => { calls += 1; return status(403); });
    expect((await chunkFetch("https://r2.test/obj", { method: "PUT" }, async () => {})).status).toBe(403);
    expect(calls).toBe(1);
  });

  it("gives up after the last delay and throws the final error", async () => {
    __setVaultFetchForTests(async () => { throw new TypeError("Network request failed"); });
    await expect(chunkFetch("https://r2.test/obj", {}, async () => {})).rejects.toThrow("Network request failed");
  });
});

describe("buildVaultClient", () => {
  it("binds the ApiClient to API_BASE_URL with auth, and the transport sends no auth", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    __setVaultFetchForTests(async (u, init) => { seen.push({ url: String(u), init }); return ok({ ok: true, publicKey: "00" }); });
    const { api, transport } = buildVaultClient();
    await api.oprfPublicKey().catch(() => {});
    expect(seen[0].url).toMatch(/\/api\/e2ee\/oprf-public-key$/);
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer dosm_token1");
    __setVaultFetchForTests(async (_u, init) => { seen.push({ url: "chunk", init }); return ok(); });
    await transport.putChunk("https://r2.test/c", new Uint8Array(2));
    const h = (seen[seen.length - 1].init?.headers ?? {}) as Record<string, string>;
    expect(h.Authorization).toBeUndefined();
    __setVaultFetchForTests(null);
  });
});

describe("chunkFetch declares a content type for binary bodies", () => {
  afterEach(() => __setVaultFetchForTests(null));

  // Android refuses a base64-converted body that carries no Content-Type and
  // reports it to JavaScript as a bare network failure, so an upload that
  // passes every test and works on both desktop platforms never leaves the
  // phone. This is the one header that makes chunk uploads work there.
  it("adds application/octet-stream to a PUT that carries bytes", async () => {
    const seen: RequestInit[] = [];
    __setVaultFetchForTests(async (_u, init) => { seen.push(init ?? {}); return status(200); });
    await chunkFetch("https://r2.test/obj", { method: "PUT", body: new Uint8Array([1, 2, 3]) }, async () => {});
    expect((seen[0].headers as Record<string, string>)["Content-Type"]).toBe("application/octet-stream");
  });

  it("leaves a caller's own content type alone, and adds none to a bodyless request", async () => {
    const seen: RequestInit[] = [];
    __setVaultFetchForTests(async (_u, init) => { seen.push(init ?? {}); return status(200); });
    await chunkFetch("https://r2.test/obj", { method: "PUT", body: new Uint8Array([1]), headers: { "content-type": "image/png" } }, async () => {});
    expect((seen[0].headers as Record<string, string>)["content-type"]).toBe("image/png");
    expect((seen[0].headers as Record<string, string>)["Content-Type"]).toBeUndefined();

    await chunkFetch("https://r2.test/obj", {}, async () => {});
    expect(seen[1].headers).toBeUndefined();
  });

  it("the real transport's putChunk carries it, which is what the phone needs", async () => {
    const seen: RequestInit[] = [];
    __setVaultFetchForTests(async (_u, init) => { seen.push(init ?? {}); return status(200); });
    const { transport } = buildVaultClient();
    await transport.putChunk("https://r2.test/c", new Uint8Array(4));
    expect((seen[0].headers as Record<string, string>)["Content-Type"]).toBe("application/octet-stream");
  });
});
