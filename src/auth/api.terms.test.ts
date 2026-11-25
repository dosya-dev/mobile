import { mobileSignup } from "./api";

/** Captures the outgoing request so the body can be asserted on. */
function captureFetch(status: number, body: unknown) {
  const fetchMock = jest.fn(async () => ({
    status,
    ok: status < 400,
    headers: new Headers(),
    json: async () => body,
  }));
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

describe("mobileSignup - terms acceptance", () => {
  afterEach(() => jest.restoreAllMocks());

  it("tells the API the terms were accepted", async () => {
    const fetchMock = captureFetch(202, {
      ok: true,
      requires_verification: true,
      email: "a@b.com",
    });

    await mobileSignup("Ada", "a@b.com", "Correct-Horse-99");

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The endpoint rejects a signup without this field, so an app that never
    // sends it cannot create an account at all.
    expect(JSON.parse(init.body as string)).toMatchObject({ terms: true });
  });
});
