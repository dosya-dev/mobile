import { checkForUpdate, DOWNLOAD_PAGE_URL } from "./sideloadUpdate";

const BASE = "https://api.test";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const LATEST = { ok: true, version: "1.2.0", versionCode: 20, apk: { size: 68_000_000 } };

function deps(over: Partial<Parameters<typeof checkForUpdate>[0]> = {}) {
  return {
    channel: "direct" as const,
    installedVersionCode: 14,
    baseUrl: BASE,
    fetchImpl: jest.fn(async () => jsonResponse(LATEST)) as unknown as typeof fetch,
    ...over,
  };
}

describe("checkForUpdate", () => {
  describe("channels that must never check", () => {
    // The load-bearing case. A Play build that prompted for the sideload APK
    // would send the user to a download Android then REFUSES to install over
    // it, because Play App Signing gives the store build a different
    // signature. The user cannot act on the prompt at all.
    it("does nothing on a Play build", async () => {
      const fetchImpl = jest.fn();
      const res = await checkForUpdate(
        deps({ channel: "play", fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.status).toBe("not-applicable");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("does nothing when the installed version code is unknown", async () => {
      const fetchImpl = jest.fn();
      const res = await checkForUpdate(
        deps({ installedVersionCode: null, fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.status).toBe("not-applicable");
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("comparison", () => {
    it("reports an available update", async () => {
      const res = await checkForUpdate(deps());
      expect(res).toEqual({
        status: "available",
        version: "1.2.0",
        versionCode: 20,
        sizeBytes: 68_000_000,
        downloadPageUrl: DOWNLOAD_PAGE_URL,
      });
    });

    it("reports up-to-date on an equal version code", async () => {
      const res = await checkForUpdate(deps({ installedVersionCode: 20 }));
      expect(res.status).toBe("up-to-date");
    });

    // A rollback, or a user who sideloaded a build newer than what the
    // manifest advertises. Prompting them to "update" downgrades.
    it("reports up-to-date when the installed build is newer", async () => {
      const res = await checkForUpdate(deps({ installedVersionCode: 99 }));
      expect(res.status).toBe("up-to-date");
    });

    // Guards the "compare the marketing string" mistake: 1.0.9 -> 1.0.10 is
    // an upgrade by versionCode and a downgrade by string comparison.
    it("compares numerically, not lexicographically", async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse({ ok: true, version: "1.0.10", versionCode: 10, apk: { size: 1 } }),
      ) as unknown as typeof fetch;
      const res = await checkForUpdate(
        deps({ installedVersionCode: 9, fetchImpl }),
      );
      expect(res.status).toBe("available");
    });

    it("calls the android info endpoint", async () => {
      const fetchImpl = jest.fn(async () => jsonResponse(LATEST));
      await checkForUpdate(deps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
      expect(fetchImpl).toHaveBeenCalledWith(
        `${BASE}/api/android/info`,
        expect.objectContaining({ headers: { Accept: "application/json" } }),
      );
    });
  });

  describe("failures are silent, never actionable", () => {
    it("handles a 404 (nothing published yet)", async () => {
      const fetchImpl = jest.fn(async () => jsonResponse({ ok: false }, 404));
      const res = await checkForUpdate(
        deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.status).toBe("unavailable");
    });

    it("handles a network failure", async () => {
      const fetchImpl = jest.fn(async () => {
        throw new TypeError("Network request failed");
      });
      const res = await checkForUpdate(
        deps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.status).toBe("unavailable");
    });

    it("handles invalid JSON", async () => {
      const fetchImpl = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })) as unknown as typeof fetch;
      const res = await checkForUpdate(deps({ fetchImpl }));
      expect(res.status).toBe("unavailable");
    });

    it.each([
      ["a missing versionCode", { ok: true, version: "1.2.0", apk: { size: 1 } }],
      ["a string versionCode", { ok: true, version: "1.2.0", versionCode: "20", apk: { size: 1 } }],
      ["a fractional versionCode", { ok: true, version: "1.2.0", versionCode: 1.5, apk: { size: 1 } }],
      ["a missing version", { ok: true, versionCode: 20, apk: { size: 1 } }],
      ["a missing size", { ok: true, version: "1.2.0", versionCode: 20 }],
      ["an empty body", {}],
      ["a null body", null],
    ])("treats %s as unavailable rather than prompting", async (_label, body) => {
      const fetchImpl = jest.fn(async () => jsonResponse(body)) as unknown as typeof fetch;
      const res = await checkForUpdate(deps({ fetchImpl }));
      expect(res.status).toBe("unavailable");
    });

    it("gives up rather than hanging forever", async () => {
      // Never resolves on its own; only the abort signal ends it.
      const fetchImpl = jest.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      ) as unknown as typeof fetch;
      const res = await checkForUpdate(deps({ fetchImpl, timeoutMs: 10 }));
      expect(res.status).toBe("unavailable");
    });
  });
});
