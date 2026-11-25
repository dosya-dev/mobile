import { listActivity, hasAnyFilter, NO_FILTERS } from "./api";

function mockFetch(body: unknown, status = 200) {
  (globalThis as any).fetch = jest.fn(async (url: string) => {
    (mockFetch as any).lastUrl = url;
    return { status, ok: status < 400, headers: new Headers(), json: async () => body };
  });
}

const page = (over: Record<string, unknown> = {}) => ({
  ok: true,
  activities: [{
    id: "a1", action: "file_uploaded", category: "files",
    user_name: "Ada", entity_name: "x.pdf", created_at: 10,
  }],
  members: [{ id: "u1" }],
  pagination: { page: 1, per_page: 30, total: 40 },
  ...over,
});

describe("listActivity", () => {
  it("requests the workspace and page", async () => {
    mockFetch(page());
    await listActivity("w1", 2);
    expect((mockFetch as any).lastUrl).toContain("workspace_id=w1");
    expect((mockFetch as any).lastUrl).toContain("page=2");
  });

  it("returns the rows and the members the filter needs", async () => {
    mockFetch(page());
    const res = await listActivity("w1", 1);
    expect(res.activities).toHaveLength(1);
    expect(res.activities[0].id).toBe("a1");
    expect(res.members).toEqual([{ id: "u1" }]);
  });

  it("reports the filtered total, which is what the header counts", async () => {
    mockFetch(page({ pagination: { page: 1, per_page: 30, total: 40 } }));
    expect((await listActivity("w1", 1)).total).toBe(40);
  });

  it("sends no filter parameters at all when nothing is narrowed", async () => {
    // `category=` would parse to no valid categories - harmless today, and
    // wrong the moment the endpoint validates what it is handed.
    mockFetch(page());
    await listActivity("w1", 1, NO_FILTERS);
    const url = (mockFetch as any).lastUrl as string;
    expect(url).not.toContain("category=");
    expect(url).not.toContain("action=");
    expect(url).not.toContain("user_id=");
  });

  it("sends each filter comma-separated, the way the endpoint reads them", async () => {
    mockFetch(page());
    await listActivity("w1", 1, {
      categories: ["files", "folders"],
      actions: ["file_uploaded"],
      userIds: ["u1", "u2"],
    });
    const url = decodeURIComponent((mockFetch as any).lastUrl as string);
    expect(url).toContain("category=files,folders");
    expect(url).toContain("action=file_uploaded");
    expect(url).toContain("user_id=u1,u2");
  });

  it("stops at the endpoint's 50-member bind cap instead of losing the tail silently", async () => {
    mockFetch(page());
    const many = Array.from({ length: 60 }, (_, i) => `u${i}`);
    await listActivity("w1", 1, { ...NO_FILTERS, userIds: many });
    const url = decodeURIComponent((mockFetch as any).lastUrl as string);
    expect(url.split("user_id=")[1].split("&")[0].split(",")).toHaveLength(50);
  });

  it("knows whether anything is narrowed", () => {
    expect(hasAnyFilter(NO_FILTERS)).toBe(false);
    expect(hasAnyFilter({ ...NO_FILTERS, actions: ["file_uploaded"] })).toBe(true);
  });

  it("derives hasMore from the pagination totals", async () => {
    mockFetch(page({ pagination: { page: 1, per_page: 30, total: 40 } }));
    expect((await listActivity("w1", 1)).hasMore).toBe(true);

    mockFetch(page({ pagination: { page: 2, per_page: 30, total: 40 } }));
    expect((await listActivity("w1", 2)).hasMore).toBe(false);
  });

  it("says there is no more when the page exactly fills the total", async () => {
    // 30 of 30: an off-by-one here shows a Load older button that returns nothing.
    mockFetch(page({ pagination: { page: 1, per_page: 30, total: 30 } }));
    expect((await listActivity("w1", 1)).hasMore).toBe(false);
  });

  it("tolerates a response with no activities or pagination", async () => {
    mockFetch({ ok: true });
    const res = await listActivity("w1", 1);
    expect(res.activities).toEqual([]);
    expect(res.hasMore).toBe(false);
  });
});
