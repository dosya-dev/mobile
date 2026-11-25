import { mobileLogin, mobile2fa, mobileRefresh } from "./api";

function mockFetch(status: number, body: unknown) {
  (globalThis as any).fetch = jest.fn(async () => ({ status, ok: status < 400, headers: new Headers(), json: async () => body }));
}

describe("auth api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns tokens on a normal login", async () => {
    mockFetch(200, { ok: true, access_token: "dosm_a", refresh_token: "dosr_b", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 } });
    const r = await mobileLogin("a@b.com", "pw");
    expect(r.kind).toBe("tokens");
    if (r.kind === "tokens") { expect(r.access).toBe("dosm_a"); expect(r.user.email).toBe("a@b.com"); }
  });

  it("returns a 2fa challenge when required", async () => {
    mockFetch(200, { ok: true, requires_2fa: true, method: "totp", challenge_token: "chal_1" });
    const r = await mobileLogin("a@b.com", "pw");
    expect(r.kind).toBe("2fa");
    if (r.kind === "2fa") { expect(r.method).toBe("totp"); expect(r.challengeToken).toBe("chal_1"); }
  });

  it("throws ApiError with the server message on bad credentials", async () => {
    mockFetch(401, { ok: false, error: "Invalid email or password" });
    await expect(mobileLogin("a@b.com", "wrong")).rejects.toMatchObject({ name: "ApiError", message: "Invalid email or password" });
  });

  it("verifies a 2fa code and returns tokens", async () => {
    mockFetch(200, { ok: true, access_token: "dosm_a", refresh_token: "dosr_b", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 } });
    const r = await mobile2fa("chal_1", "123456", false);
    expect(r.access).toBe("dosm_a");
  });

  it("refreshes tokens", async () => {
    mockFetch(200, { ok: true, access_token: "dosm_new", refresh_token: "dosr_new" });
    const r = await mobileRefresh("dosr_old");
    expect(r.access).toBe("dosm_new");
    expect(r.refresh).toBe("dosr_new");
  });
});
