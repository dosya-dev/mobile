import { apiRequest, ApiError } from "@/api";
import {
  flattenTree, pauseReason, resetContentSearchState, searchContent, searchContentWithRetry, updateErrorKind,
  fetchWorkspaceAiSearch, isImageHit, type AiSearchStatus,
} from "./api";

jest.mock("@/api", () => {
  const actual = jest.requireActual("@/api/errors");
  return { apiRequest: jest.fn(), ApiError: actual.ApiError };
});

const mockRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const LIMITS = { vectorBudget: 1, imagesMax: 100, documentsMax: 50, docChunksMax: 1, backfillUnits: 10, monthUnits: 5 };
const status = (over: Partial<AiSearchStatus> = {}): AiSearchStatus => ({
  files_total: 10, indexed: 5, pending: 0, partial: 0, unsupported: 0, capped: 0, failed: 0, images: 1, documents: 1, chunks: 1,
  limits: LIMITS, backfill_units_remaining: 5, month_units_remaining: 5, month_reset_at: null, estimated_finish_at: null, paused: false,
  ...over,
});

const ROW = { id: "f1", name: "invoice.pdf", size_bytes: 10, mime_type: "application/pdf", extension: "pdf", created_at: 1, score: 0.9, snippet: "total due", page: 2, source: "both" };

beforeEach(() => { mockRequest.mockReset(); resetContentSearchState(); });

describe("pauseReason", () => {
  it("is null while indexing can move", () => expect(pauseReason(status())).toBeNull());
  it("puts the platform pause first", () => expect(pauseReason(status({ paused: true, capped: 3 }))).toBe("maintenance"));
  it("reports a full image budget as the plan limit", () => expect(pauseReason(status({ images: 100 }))).toBe("planLimit"));
  it("reports spent units with work waiting as the monthly allowance", () =>
    expect(pauseReason(status({ pending: 4, backfill_units_remaining: 0, month_units_remaining: 0 }))).toBe("monthlyAllowance"));
  it("is null without a plan", () => expect(pauseReason(status({ limits: null, capped: 2 }))).toBeNull());
});

describe("flattenTree", () => {
  it("lists depth first with siblings by name and keeps orphans at the top", () => {
    const rows = flattenTree([
      { id: "b", name: "Beta", parent_id: null },
      { id: "a", name: "Alpha", parent_id: null },
      { id: "a2", name: "Zed", parent_id: "a" },
      { id: "a1", name: "Child", parent_id: "a" },
      { id: "o", name: "Orphan", parent_id: "gone" },
    ]);
    expect(rows.map((r) => `${r.depth}:${r.folder.id}`)).toEqual(["0:a", "1:a1", "1:a2", "0:b", "0:o"]);
  });
});

describe("updateErrorKind", () => {
  it("maps the server's codes", () => {
    expect(updateErrorKind(new ApiError("ai_search_not_in_plan", 402))).toBe("notInPlan");
    expect(updateErrorKind(new ApiError("ai_search_unavailable_for_vault", 409))).toBe("notForWorkspace");
    expect(updateErrorKind(new ApiError("rate_limited", 429))).toBe("rateLimited");
    expect(updateErrorKind(new Error("boom"))).toBeNull();
  });
});

describe("fetchWorkspaceAiSearch", () => {
  it("returns null for an unexpected shape", async () => {
    mockRequest.mockResolvedValueOnce({ ok: true });
    expect(await fetchWorkspaceAiSearch("w1")).toBeNull();
  });
  it("defaults can_edit to false and the exclusions to empty", async () => {
    mockRequest.mockResolvedValueOnce({ ok: true, settings: { enabled: true, index_existing: false }, status: status() });
    const r = await fetchWorkspaceAiSearch("w1");
    expect(r?.can_edit).toBe(false);
    expect(r?.settings.excluded_folders).toEqual([]);
  });
});

describe("searchContent", () => {
  it("normalizes hits into file rows", async () => {
    mockRequest.mockResolvedValueOnce({ ok: true, files: [ROW], partial: false });
    const r = await searchContent("w1", "invoice");
    expect(mockRequest.mock.calls[0][0]).toBe("/api/search/content?workspace_id=w1&q=invoice");
    expect(r).toMatchObject({ kind: "ok", partial: false, files: [{ id: "f1", lock_mode: "unknown", share_count: 0, snippet: "total due", page: 2 }] });
  });

  it("answers busy with the server's Retry-After on 429", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError("rate_limited", 429, undefined, 3));
    expect(await searchContent("w1", "x")).toEqual({ kind: "busy", retryAfterS: 3 });
  });

  it("remembers a workspace without AI search and does not ask again", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError("ai_search_off", 409));
    expect(await searchContent("w1", "x")).toEqual({ kind: "unavailable" });
    expect(await searchContent("w1", "y")).toEqual({ kind: "unavailable" });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("reports anything else as an error, never as no matches", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError("boom", 500));
    expect(await searchContent("w1", "x")).toEqual({ kind: "error" });
  });
});

describe("searchContentWithRetry", () => {
  afterEach(() => jest.useRealTimers());

  it("says busy, waits the Retry-After, then tries once more", async () => {
    jest.useFakeTimers();
    mockRequest
      .mockRejectedValueOnce(new ApiError("rate_limited", 429, undefined, 2))
      .mockResolvedValueOnce({ ok: true, files: [], partial: false });
    const onBusy = jest.fn();
    const p = searchContentWithRetry("w1", "x", { onBusy });
    await Promise.resolve(); await Promise.resolve();
    expect(onBusy).toHaveBeenCalledWith(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ kind: "ok", files: [], partial: false });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly when cancelled during the wait", async () => {
    jest.useFakeTimers();
    mockRequest.mockRejectedValueOnce(new ApiError("rate_limited", 429, undefined, 5));
    const ctrl = new AbortController();
    const p = searchContentWithRetry("w1", "x", { signal: ctrl.signal });
    await Promise.resolve(); await Promise.resolve();
    ctrl.abort();
    expect(await p).toEqual({ kind: "error" });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe("isImageHit", () => {
  it("goes by MIME type with the extension as fallback", () => {
    expect(isImageHit({ mime_type: "image/heic", name: "a" })).toBe(true);
    expect(isImageHit({ mime_type: "", name: "IMG_1.JPG" })).toBe(true);
    expect(isImageHit({ mime_type: "application/pdf", name: "a.pdf" })).toBe(false);
  });
});
