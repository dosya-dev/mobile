import { requestEmailChange, avatarUrl, getMe } from "./api";
import { API_BASE_URL } from "@/api";

function mockFetch(status: number, body: unknown) {
  (globalThis as any).fetch = jest.fn(async () => ({ status, ok: status < 400, headers: new Headers(), json: async () => body }));
}

afterEach(() => jest.restoreAllMocks());

it("maps a pending email change", async () => {
  mockFetch(200, { ok: true, pending: true, new_email: "new@x.com" });
  expect(await requestEmailChange("new@x.com", "pw")).toEqual({ kind: "pending", newEmail: "new@x.com" });
});

it("maps the same-email no-op (server omits `pending`) to `unchanged`", async () => {
  mockFetch(200, { ok: true, email: "same@x.com" });
  expect(await requestEmailChange("same@x.com", "pw")).toEqual({ kind: "unchanged", email: "same@x.com" });
});

it("surfaces a wrong-password error", async () => {
  mockFetch(401, { ok: false, error: "Incorrect password" });
  await expect(requestEmailChange("new@x.com", "bad")).rejects.toThrow("Incorrect password");
});

describe("avatarUrl", () => {
  it("builds the endpoint url", () => {
    expect(avatarUrl()).toBe(`${API_BASE_URL}/api/me/avatar`);
  });
  it("appends a cache-bust (the response is cached for an hour and the url is stable)", () => {
    expect(avatarUrl(42)).toBe(`${API_BASE_URL}/api/me/avatar?t=42`);
  });
});

it("unwraps the nested user from GET /api/me", async () => {
  const user = {
    id: "u1", email: "a@b.com", name: "A", initials: "AB", avatar_url: null,
    preferred_language: "en", ui_theme: "default", ui_mode: "system",
    created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
  };
  mockFetch(200, { ok: true, user });
  expect(await getMe()).toEqual(user);
});
