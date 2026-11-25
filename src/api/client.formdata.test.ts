import { apiRequest } from "./client";

function captureFetch(body: unknown = { ok: true }) {
  // Typed args so `spy.mock.calls[0][1]` (the RequestInit) is reachable.
  const spy = jest.fn(async (_url: string, _init?: RequestInit) => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    json: async () => body,
  }));
  (globalThis as any).fetch = spy;
  return spy;
}

afterEach(() => jest.restoreAllMocks());

it("passes a FormData body through untouched and sets no Content-Type", async () => {
  const spy = captureFetch();
  const form = new FormData();
  form.append("avatar", "x");

  await apiRequest("/api/me/avatar", { method: "POST", body: form });

  const init = spy.mock.calls[0][1] as any;
  // Must be the FormData itself - not JSON.stringify'd into "{}".
  expect(init.body).toBe(form);
  // RN must set Content-Type itself so the multipart boundary is included.
  expect(init.headers["Content-Type"]).toBeUndefined();
});

it("still JSON-encodes a plain object body with a JSON Content-Type", async () => {
  const spy = captureFetch();
  await apiRequest("/api/me/name", { method: "PUT", body: { name: "A" } });

  const init = spy.mock.calls[0][1] as any;
  expect(init.body).toBe(JSON.stringify({ name: "A" }));
  expect(init.headers["Content-Type"]).toBe("application/json");
});
