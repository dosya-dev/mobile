jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

import { apiRequest } from "@/api/client";
import { offlineRequest, __setRequestTimeoutForTests } from "./http";

afterEach(() => __setRequestTimeoutForTests(null));

describe("offlineRequest", () => {
  it("passes through an answer, with an abort signal attached", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true });
    expect(await offlineRequest("/x", { method: "POST", body: { a: 1 } })).toEqual({ ok: true });
    const opts = (apiRequest as jest.Mock).mock.calls[0][1];
    expect(opts).toMatchObject({ method: "POST", body: { a: 1 } });
    expect(opts.signal).toBeDefined();
  });

  it("a request that never answers fails as a transport error and is aborted", async () => {
    __setRequestTimeoutForTests(20);
    let signal: AbortSignal | undefined;
    (apiRequest as jest.Mock).mockImplementation((_p: string, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => {});
    });
    await expect(offlineRequest("/hang")).rejects.toMatchObject({ status: 0 });
    expect(signal?.aborted).toBe(true);
  });

  it("server errors pass through unchanged", async () => {
    (apiRequest as jest.Mock).mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    await expect(offlineRequest("/x")).rejects.toMatchObject({ status: 403 });
  });
});
