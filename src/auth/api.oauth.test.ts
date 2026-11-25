import { mobileOAuthExchange } from "./api";

function mockFetch(status: number, body: unknown) {
  (globalThis as any).fetch = jest.fn(async () => ({ status, ok: status < 400, headers: new Headers(), json: async () => body }));
}

afterEach(() => jest.restoreAllMocks());

it("maps a token response to a tokens result", async () => {
  mockFetch(200, { ok: true, access_token: "a", refresh_token: "r", user: { id: "u", email: "e", name: "n", created_at: 1 } });
  expect(await mobileOAuthExchange("dmoc_x")).toEqual({
    kind: "tokens", access: "a", refresh: "r", user: { id: "u", email: "e", name: "n", created_at: 1 },
  });
});

it("maps a 2fa response to a 2fa result", async () => {
  mockFetch(200, { ok: true, requires_2fa: true, method: "totp", challenge_token: "c" });
  expect(await mobileOAuthExchange("dmoc_x")).toEqual({ kind: "2fa", method: "totp", challengeToken: "c" });
});
