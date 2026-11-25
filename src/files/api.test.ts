import { getWorkspaces, listFiles, getDownloadUrl, search, getTrash, getFavourites, createWorkspace, getRegions } from "./api";
import { mayPersistBytes } from "./cachePolicy";
import { isKnownLocked } from "./lock";

function mockFetch(body: unknown, status = 200) {
  (globalThis as any).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    (mockFetch as any).lastUrl = url;
    (mockFetch as any).lastBody = init?.body;
    return { status, ok: status < 400, headers: new Headers(), json: async () => body };
  });
}

/** The JSON actually put on the wire, so an omitted key is provably absent. */
function sentBody(): Record<string, unknown> {
  return JSON.parse(((mockFetch as any).lastBody as string) ?? "{}");
}

describe("files api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("lists workspaces", async () => {
    mockFetch({ ok: true, workspaces: [{ id: "w1", name: "Personal", slug: "personal", icon_initials: "P", icon_color: "#000", icon_image_url: null, role_id: "r" }] });
    const ws = await getWorkspaces();
    expect(ws[0].name).toBe("Personal");
  });

  it("lists files with query params", async () => {
    mockFetch({ ok: true, folders: [], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });
    const page = await listFiles({ workspaceId: "w1", folderId: null, filter: "all", sort: "newest", page: 1 });
    expect(page.pagination.page).toBe(1);
    expect((mockFetch as any).lastUrl).toContain("workspace_id=w1");
    expect((mockFetch as any).lastUrl).toContain("sort=newest");
  });

  it("gets a presigned download url", async () => {
    mockFetch({ ok: true, url: "https://r2.example/abc" });
    const url = await getDownloadUrl("f1");
    expect(url).toBe("https://r2.example/abc");
  });

  it("searches", async () => {
    mockFetch({ ok: true, files: [], folders: [] });
    const res = await search("w1", "report");
    expect(res.files).toEqual([]);
    expect((mockFetch as any).lastUrl).toContain("q=report");
  });

  // The server now selects lock_mode, but an app can outrun its API deploy. A
  // row without it must NOT be read as unrestricted: that is what let the disk
  // cache persist a view-only file reached through search.
  it("refuses to assume a search row is unrestricted when the server omits lock_mode", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "f1", name: "report.pdf", size_bytes: 100, mime_type: "application/pdf", extension: "pdf", created_at: 1000 }],
      folders: [{ id: "d1", name: "Reports", created_at: 1000 }],
    });
    const res = await search("w1", "report");
    expect(res.files[0]).toMatchObject({
      lock_mode: "unknown",
      share_count: 0,
      comment_count: 0,
      current_version: 1,
      updated_at: 1000,
    });
    expect(mayPersistBytes(res.files[0])).toBe(false);
    // ...but an unknown mode must not paint a padlock on every row either.
    expect(isKnownLocked(res.files[0])).toBe(false);
    expect(res.folders[0]).toMatchObject({ lock_mode: "none", file_count: 0 });
  });

  it("takes the server's lock mode for a search hit once it sends one", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "f1", name: "p.png", size_bytes: 100, mime_type: "image/png", extension: "png", created_at: 1000, lock_mode: "view_only" }],
      folders: [],
    });
    const res = await search("w1", "p");
    expect(res.files[0].lock_mode).toBe("view_only");
    expect(mayPersistBytes(res.files[0])).toBe(false);
    expect(isKnownLocked(res.files[0])).toBe(true);
  });

  it("lets real server values override the normalization defaults", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "f1", name: "report.pdf", size_bytes: 100, mime_type: "application/pdf", extension: "pdf", created_at: 1000, lock_mode: "full_lock", share_count: 3 }],
      folders: [{ id: "d1", name: "Reports", created_at: 1000, lock_mode: "view_only", file_count: 5 }],
    });
    const res = await search("w1", "report");
    expect(res.files[0]).toMatchObject({ lock_mode: "full_lock", share_count: 3 });
    expect(res.folders[0]).toMatchObject({ lock_mode: "view_only", file_count: 5 });
  });

  it("gets trash via deleted=1 (not filter=deleted)", async () => {
    mockFetch({ ok: true, files: [] });
    await getTrash("w1");
    expect((mockFetch as any).lastUrl).toContain("deleted=1");
    expect((mockFetch as any).lastUrl).not.toContain("filter=deleted");
  });

  it("normalizes favourite rows into FileItem/FolderItem shapes", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "fav1", file_id: "f1", file_name: "a.txt", size_bytes: 5, mime_type: "text/plain", extension: "txt", created_at: 1, lock_mode: "none", current_version: 2 }],
      folders: [{ id: "fav2", folder_id: "fo1", folder_name: "Docs", parent_id: null, created_at: 1 }],
    });
    const res = await getFavourites("w1");
    // `id` is the FILE id, not the favourite-row id - the row carries both.
    expect(res.files[0]).toMatchObject({ id: "f1", name: "a.txt", lock_mode: "none", current_version: 2 });
    expect(res.folders[0]).toMatchObject({ id: "fo1", name: "Docs" });
  });

  it("carries a favourited file's restriction through instead of flattening it", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "fav1", file_id: "f1", file_name: "payroll.png", size_bytes: 5, mime_type: "image/png", extension: "png", created_at: 1, lock_mode: "view_only", current_version: 1 }],
      folders: [],
    });
    const res = await getFavourites("w1");
    expect(res.files[0].lock_mode).toBe("view_only");
    expect(mayPersistBytes(res.files[0])).toBe(false);
  });

  // Same deploy-skew guard as search: an older server omits the column, and
  // "none" would tell the cache a view-only favourite is safe to keep.
  it("refuses to assume a favourite is unrestricted when the server omits lock_mode", async () => {
    mockFetch({
      ok: true,
      files: [{ id: "fav1", file_id: "f1", file_name: "a.txt", size_bytes: 5, mime_type: "text/plain", extension: "txt", created_at: 1 }],
      folders: [],
    });
    const res = await getFavourites("w1");
    expect(res.files[0].lock_mode).toBe("unknown");
    expect(mayPersistBytes(res.files[0])).toBe(false);
    expect(isKnownLocked(res.files[0])).toBe(false);
  });

  it("passes ttl to the download-url endpoint when asked", async () => {
    mockFetch({ ok: true, url: "https://r2.example/abc" });
    await getDownloadUrl("f1", undefined, 3600);
    expect((mockFetch as any).lastUrl).toContain("/api/files/f1/download-url?ttl=3600");
  });

  it("omits ttl by default and combines it with an unlock token", async () => {
    mockFetch({ ok: true, url: "https://r2.example/abc" });
    await getDownloadUrl("f1");
    expect((mockFetch as any).lastUrl).not.toContain("ttl=");
    mockFetch({ ok: true, url: "https://r2.example/abc" });
    await getDownloadUrl("f1", "tok en", 3600);
    expect((mockFetch as any).lastUrl).toContain("ut=tok+en");
    expect((mockFetch as any).lastUrl).toContain("ttl=3600");
  });
});

describe("listFiles filter translation", () => {
  it("sends filter=documents for an ordinary filter", async () => {
    mockFetch({ ok: true, files: [], folders: [] });
    await listFiles({ workspaceId: "w1", folderId: null, filter: "documents" });
    expect((mockFetch as any).lastUrl).toContain("filter=documents");
    expect((mockFetch as any).lastUrl).not.toContain("hidden=");
  });

  it("sends hidden=1 and NO filter key for the hidden view", async () => {
    // The API takes `hidden` as its own param, not as a filter value. Sending
    // filter=hidden fails silently - the API ignores the unknown value and
    // returns the unfiltered listing, so the screen would look like it worked.
    mockFetch({ ok: true, files: [], folders: [] });
    await listFiles({ workspaceId: "w1", folderId: null, filter: "hidden" });
    expect((mockFetch as any).lastUrl).toContain("hidden=1");
    expect((mockFetch as any).lastUrl).not.toContain("filter=");
  });

  it("sends neither when no filter is given", async () => {
    mockFetch({ ok: true, files: [], folders: [] });
    await listFiles({ workspaceId: "w1", folderId: null });
    expect((mockFetch as any).lastUrl).not.toContain("filter=");
    expect((mockFetch as any).lastUrl).not.toContain("hidden=");
  });
});

// A workspace's location is chosen once, at creation. The API refuses to move
// one afterwards and ignores a `region` on any upload, so this request is the
// only place the app ever names a location.
describe("createWorkspace", () => {
  const WS = { ok: true, workspace: { id: "w1", name: "A", slug: "a", icon_initials: "A", icon_color: "#000", icon_image_url: null, role_id: "r" } };

  it("sends the chosen location as default_region", async () => {
    mockFetch(WS);
    const ws = await createWorkspace("A", "eu-west-1");
    expect((mockFetch as any).lastUrl).toContain("/api/workspaces");
    expect(sentBody()).toEqual({ name: "A", default_region: "eu-west-1" });
    expect(ws.id).toBe("w1");
  });

  // Omitted rather than sent empty, so the request unambiguously asks the server
  // to suggest a location from its geography. ("" trims to nothing server-side
  // and takes the same path, so this is about the request saying what it means.)
  it("omits the key entirely when no location was chosen", async () => {
    mockFetch(WS);
    await createWorkspace("A");
    expect(sentBody()).toEqual({ name: "A" });
    expect((mockFetch as any).lastBody).not.toContain("default_region");
  });

  it("omits it for an empty string too, rather than sending a key that carries nothing", async () => {
    mockFetch(WS);
    await createWorkspace("A", "");
    expect(sentBody()).toEqual({ name: "A" });
  });
});

describe("getRegions", () => {
  it("reads the catalog and the server's nearest-location suggestion", async () => {
    mockFetch({
      ok: true,
      regions: [{ code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" }],
      suggested: "eu-west-1",
    });
    const res = await getRegions();
    expect((mockFetch as any).lastUrl).toContain("/api/regions");
    expect(res.regions.map((r) => r.code)).toEqual(["eu-west-1"]);
    expect(res.suggested).toBe("eu-west-1");
  });

  // An app can outrun its API deploy. A response without a suggestion must
  // still yield a usable catalog rather than an undefined preselection.
  it("survives a response that carries no suggestion or no catalog", async () => {
    mockFetch({ ok: true });
    const res = await getRegions();
    expect(res.regions).toEqual([]);
    expect(res.suggested).toBe("");
  });
});
