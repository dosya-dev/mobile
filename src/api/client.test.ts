import { apiRequest, setTokenProvider, setRefreshHandler } from "./client";

function mockFetchOnce(status: number, body: unknown) {
  (globalThis as any).fetch = jest.fn(async () => ({
    status,
    ok: status < 400,
    headers: new Headers(),
    json: async () => body,
  }));
}

describe("apiRequest", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the payload on { ok: true }", async () => {
    mockFetchOnce(200, { ok: true, value: 42 });
    const data = await apiRequest<{ value: number }>("/api/thing");
    expect(data.value).toBe(42);
  });

  it("throws ApiError with the server message on { ok: false }", async () => {
    mockFetchOnce(401, { ok: false, error: "Invalid or expired API key" });
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid or expired API key",
    });
  });

  it("carries the refusal's body on the ApiError (a 409's max_gb)", async () => {
    mockFetchOnce(409, { ok: false, error: "You can reserve up to 250 GB for this person", code: "reservation_too_large", max_gb: 250 });
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ status: 409, code: "reservation_too_large", data: { max_gb: 250 } });
  });

  it("carries a 429's Retry-After seconds on the ApiError", async () => {
    (globalThis as any).fetch = jest.fn(async () => ({
      status: 429, ok: false, headers: new Headers({ "Retry-After": "4" }), json: async () => ({ ok: false, error: "rate_limited" }),
    }));
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ status: 429, message: "rate_limited", retryAfterS: 4 });
  });

  it("attaches the bearer token from the registered provider", async () => {
    const spy = jest.fn(
      async (_url: string, _init: { headers: Record<string, string> }) => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => ({ ok: true }),
      }),
    );
    (globalThis as any).fetch = spy;
    setTokenProvider(() => "tok_123");
    await apiRequest("/api/thing");
    const headers = spy.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer tok_123");
    setTokenProvider(() => null);
  });

  // The refresh call authenticates by the refresh token in its body. The
  // access token this would otherwise attach is expired by definition when a
  // refresh happens, and the server middleware used to validate that stale
  // bearer and answer 401 before the refresh handler ran - ending every
  // session at exactly access-token expiry.
  it("sends no bearer when omitAuth is set (the refresh call)", async () => {
    const spy = jest.fn(
      async (_url: string, _init: { headers: Record<string, string> }) => ({
        status: 200,
        ok: true,
        headers: new Headers(),
        json: async () => ({ ok: true }),
      }),
    );
    (globalThis as any).fetch = spy;
    setTokenProvider(() => "tok_expired");
    await apiRequest("/api/auth/mobile/refresh", { method: "POST", body: {}, skipRefresh: true, omitAuth: true });
    const headers = spy.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    setTokenProvider(() => null);
  });

});

describe("apiRequest network + refresh", () => {
  afterEach(() => { jest.restoreAllMocks(); setRefreshHandler(null); setTokenProvider(() => null); });

  it("throws ApiError with status 0 on a network failure", async () => {
    (globalThis as any).fetch = jest.fn(async () => { throw new TypeError("Network request failed"); });
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });

  it("refreshes once on 401 then retries with the new token", async () => {
    let token = "old";
    setTokenProvider(() => token);
    setRefreshHandler(async () => { token = "new"; return "refreshed"; });
    const calls: string[] = [];
    (globalThis as any).fetch = jest.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      calls.push(init.headers.Authorization);
      const ok = init.headers.Authorization === "Bearer new";
      return { status: ok ? 200 : 401, ok, headers: new Headers(), json: async () => (ok ? { ok: true, v: 1 } : { ok: false, error: "expired" }) };
    });
    const data = await apiRequest<{ v: number }>("/api/thing");
    expect(data.v).toBe(1);
    expect(calls).toEqual(["Bearer old", "Bearer new"]);
  });

  it("does not retry when the server rejects the refresh token", async () => {
    setTokenProvider(() => "old");
    setRefreshHandler(async () => "rejected");
    (globalThis as any).fetch = jest.fn(async () => ({ status: 401, ok: false, headers: new Headers(), json: async () => ({ ok: false, error: "expired" }) }));
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ status: 401 });
  });

  // The 401 is unproven if the refresh never reached the server, and callers key
  // off status 401 to decide the session is dead. Report the transport failure
  // instead, so a blip between the two calls cannot masquerade as a rejection.
  it("reports a transport failure, not the original 401, when the refresh could not be completed", async () => {
    setTokenProvider(() => "old");
    setRefreshHandler(async () => "unavailable");
    (globalThis as any).fetch = jest.fn(async () => ({ status: 401, ok: false, headers: new Headers(), json: async () => ({ ok: false, error: "expired" }) }));
    await expect(apiRequest("/api/thing")).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });

  it("skips refresh when skipRefresh is set (auth endpoints)", async () => {
    const refresh = jest.fn(async () => "refreshed" as const);
    setRefreshHandler(refresh);
    (globalThis as any).fetch = jest.fn(async () => ({ status: 401, ok: false, headers: new Headers(), json: async () => ({ ok: false, error: "bad creds" }) }));
    await expect(apiRequest("/api/auth/mobile/login", { method: "POST", body: {}, skipRefresh: true })).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("apiRequest edge challenge", () => {
  afterEach(() => jest.restoreAllMocks());

  // QA MOB-REG-014: the zone's leaked-password WAF rule answers the reset and
  // sign-in doors with Cloudflare's own HTML challenge page. res.json() threw
  // and the user read "Malformed server response" for a password they chose.
  it("names the security check instead of 'Malformed server response' when Cloudflare answers with a challenge", async () => {
    (globalThis as any).fetch = jest.fn(async () => ({
      status: 403,
      ok: false,
      headers: new Headers({ "cf-mitigated": "challenge", "content-type": "text/html" }),
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    }));
    await expect(apiRequest("/api/auth/reset-password-code", { method: "POST", body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "edge_challenge",
      message: "Our security check blocked this request. Wait a few minutes and try again.",
    });
  });
});
