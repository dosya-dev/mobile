const mockApiRequest = jest.fn();
jest.mock("@/api", () => ({
  apiRequest: (...a: unknown[]) => mockApiRequest(...a),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { initBatch, completeDirect, DirectUnavailableError, isInitBatchOutage } from "./directApi";
import { ApiError } from "@/api";

beforeEach(() => mockApiRequest.mockReset());

describe("initBatch", () => {
  it("posts the entries and returns uploads + refusals", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      uploads: [{ client_ref: "a", session_id: "upl_1", url: "u", headers: {}, expires_at: 1 }],
      refused: [],
    });
    const out = await initBatch("w1", [
      { client_ref: "a", file_name: "a.jpg", file_size: 1, mime_type: "image/jpeg", folder_id: null },
    ]);
    expect(mockApiRequest).toHaveBeenCalledWith("/api/upload/init-batch", {
      method: "POST",
      body: { workspace_id: "w1", files: [expect.objectContaining({ client_ref: "a" })] },
    });
    expect(out.uploads[0].session_id).toBe("upl_1");
  });

  it("slices the entry list to the 200 batch cap", async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, uploads: [], refused: [] });
    const files = Array.from({ length: 250 }, (_, i) => ({
      client_ref: `c${i}`,
      file_name: "a.jpg",
      file_size: 1,
      mime_type: "image/jpeg",
      folder_id: null,
    }));
    await initBatch("w1", files);
    const [, opts] = mockApiRequest.mock.calls[0] as [string, { body: { files: unknown[] } }];
    expect(opts.body.files).toHaveLength(200);
  });

  it("turns direct_unavailable into a typed error the transport can fall back on", async () => {
    mockApiRequest.mockRejectedValueOnce(
      new ApiError("Direct upload is not available for this workspace", 400, "direct_unavailable"),
    );
    await expect(initBatch("w1", [])).rejects.toBeInstanceOf(DirectUnavailableError);
  });

  it("does not mask a different ApiError as direct-unavailable", async () => {
    mockApiRequest.mockRejectedValueOnce(new ApiError("Network request failed", 0));
    await expect(initBatch("w1", [])).rejects.not.toBeInstanceOf(DirectUnavailableError);
  });

  // An app build whose API has not caught up with it (a TestFlight round
  // against an older deployment, a rollback) gets a 404 for the route itself.
  // Without this the transport read it as a per-asset failure and burned an
  // attempt on every photo in the library against an endpoint that was never
  // going to answer.
  it("treats a 404 as direct-unavailable, so the transport falls back instead of retrying", async () => {
    mockApiRequest.mockRejectedValueOnce(new ApiError("Not found", 404));
    await expect(initBatch("w1", [])).rejects.toBeInstanceOf(DirectUnavailableError);
  });
});

describe("isInitBatchOutage", () => {
  it("counts a 5xx and a network failure, but not a refusal or a fallback verdict", () => {
    expect(isInitBatchOutage(new ApiError("Server error", 503))).toBe(true);
    expect(isInitBatchOutage(new ApiError("Network request failed", 0))).toBe(true);
    expect(isInitBatchOutage(new TypeError("fetch blew up"))).toBe(true);
    expect(isInitBatchOutage(new ApiError("Bad request", 400, "bad_input"))).toBe(false);
    expect(isInitBatchOutage(new DirectUnavailableError())).toBe(false);
  });
});

describe("completeDirect", () => {
  it("posts up to 200 sessions per call and concatenates the answers", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      completed: [{ session_id: "s1", file_id: "f1", version: 1, size_bytes: 1 }],
      refused: [],
    });
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      completed: [],
      refused: [{ session_id: "s201", code: "not_uploaded", error: "x" }],
    });
    const entries = Array.from({ length: 201 }, (_, i) => ({ session_id: `s${i + 1}` }));
    const out = await completeDirect(entries);
    expect(mockApiRequest).toHaveBeenCalledTimes(2);
    expect(out.completed).toHaveLength(1);
    expect(out.refused[0].session_id).toBe("s201");
  });

  it("sends exactly one request when at or under the cap", async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, completed: [], refused: [] });
    const entries = Array.from({ length: 200 }, (_, i) => ({ session_id: `s${i + 1}` }));
    await completeDirect(entries);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });
});
